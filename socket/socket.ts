import { EventEmitter } from 'events';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketId,
	Room,
	AckCallback,
	AckMap,
	DisconnectReason,
	Handshake,
	SocketData as DefaultSocketData,
	EventsMap,
	DefaultEventsMap,
} from '../shared/types/socket.types';
import { BinaryProtocol, SocketParser } from './parser';
import { packetPool } from './object-pool';

const isProduction = process.env.NODE_ENV === 'production';

export class Socket<
	ListenEvents extends EventsMap = ClientToServerEvents,
	EmitEvents extends EventsMap = ServerToClientEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData
> extends EventEmitter {
	public readonly id: SocketId;
	public readonly handshake: Handshake;
	public readonly rooms: Set<Room> = new Set();
	public readonly data: SocketData = {} as SocketData;
	public readonly ackCallbacks: AckMap = new Map();

	private heartbeatTimer?: NodeJS.Timeout;
	private readonly heartbeatInterval = 25000;
	private _connected: boolean = true;
	private _sessionId: string;

	public readonly ws: ServerWebSocket<WSContext>;
	private namespace: any;

	/**
	 * Батчинг ACK ответов для минимизации WebSocket фреймов
	 */
	private ackResponseBatch: string[] = [];
	private ackBatchTimer?: NodeJS.Timeout;
	private readonly ACK_BATCH_SIZE = 10; // Группируем по 10 ACK
	private readonly ACK_BATCH_TIMEOUT = 0; // Мгновенная отправка при накоплении

	// Предварительно скомпилированные регулярные выражения
	private static readonly ACK_ID_REGEX = /^(\d+)/;
	private static readonly NAMESPACE_REGEX = /^(\/[^,]*)/;

	// Inline константы для избежания поиска в объектах
	private static readonly WS_READY_STATE_OPEN = 1;
	private static readonly ENGINE_MESSAGE_TYPE = 4;

	/**
	 * Оптимизированная обработка ACK с использованием Object вместо Map для частых операций
	 */
	private fastAckCallbacks = Object.create(null);

	constructor(
		id: SocketId,
		ws: ServerWebSocket<WSContext>,
		namespace: any,
		handshake: Handshake
	) {
		super();
		this.id = id;
		this.ws = ws;
		this.namespace = namespace;
		this.handshake = handshake;
		this._sessionId = SocketParser.generateSessionId();

		// Join default room (socket's own ID)
		this.rooms.add(this.id);
		this.startHeartbeat();
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this.connected) {
				this.ws.send('2'); // Engine.IO ping packet
			}
		}, this.heartbeatInterval);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	get nsp(): string {
		return this.namespace.name;
	}

	get connected(): boolean {
		return this._connected && this.ws.readyState === 1;
	}

	get sessionId(): string {
		return this._sessionId;
	}

	// ИСПРАВЛЕНИЕ: Упрощаем override методы для лучшей совместимости
	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	override removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.removeListener(event, listener);
	}

	override off(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.off(event, listener);
	}

	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg?: Parameters<EmitEvents[Ev]>[0],
		ack?: AckCallback
	): boolean {
		if (!this._connected) return false;

		try {
			let ackId: string | undefined;
			let data: any;

			// Handle different call signatures
			if (typeof dataOrArg === 'function') {
				ack = dataOrArg;
				data = undefined;
			} else if (typeof ack === 'function') {
				data = dataOrArg;
			} else {
				data = dataOrArg;
				if (data && typeof data === 'object') {
					data = this.sanitizeData(data);
				}
			}

			// Handle acknowledgement callback
			if (typeof ack === 'function') {
				ackId = SocketParser.generateAckId();
				this.ackCallbacks.set(ackId, ack);

				// Clean up callback after timeout
				setTimeout(() => {
					if (this.ackCallbacks.has(ackId!)) {
						this.ackCallbacks.delete(ackId!);
						ack!(new Error('Acknowledgement timeout'));
					}
				}, 10000);
			}

			const packet = SocketParser.encode(event as any, data, ackId, this.nsp);

			// Логирование только в development
			if (!isProduction) {
				console.log(`[Socket] Sending packet to ${this.id} for event '${event}':`, packet);
			}

			// Проверяем что пакет корректный
			if (!packet || typeof packet !== 'string') {
				console.error(`[Socket] Invalid packet generated for ${this.id}:`, packet);
				return false;
			}

			const result = this.ws.send(packet);

			return result !== 0 && result !== -1;
		} catch (error) {
			console.error('[Socket] Emit error:', error);
			return false;
		}
	}

	/**
	 * Ultra-fast emit с минимальными проверками
	 */
	emitUltraFast(event: string, data?: string | number): boolean {
		// Inline проверка состояния для максимальной скорости
		if (!this._connected | (this.ws.readyState !== Socket.WS_READY_STATE_OPEN)) {
			return false;
		}

		let packet: Uint8Array | string;

		// Попытка бинарного кодирования
		if (typeof data === 'string' || typeof data === 'number') {
			const binaryPacket = SocketParser.tryEncodeBinary(event as any, data, this.nsp);
			if (binaryPacket) {
				packet = binaryPacket;
			} else {
				packet = SocketParser.encodeStringEvent(event, String(data), this.nsp);
			}
		} else {
			packet = SocketParser.encodeSimpleEvent(event, this.nsp);
		}

		try {
			return this.ws.send(packet) > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Сверх-быстрый emit для простых событий без данных (без ACK)
	 */
	emitFast(event: string): boolean {
		// Самая быстрая проверка подключения
		if (!this._connected || this.ws.readyState !== 1) return false;

		const packet = SocketParser.encodeSimpleEvent(event, this.nsp);
		return this.ws.send(packet) > 0;
	}

	/**
	 * Сверх-быстрый emit для строковых данных (без ACK)
	 */
	emitString(event: string, data: string): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		const packet = SocketParser.encodeStringEvent(event, data, this.nsp);
		return this.ws.send(packet) > 0;
	}

	/**
	 * Batch операции с использованием object pooling
	 */
	emitBatchPooled(events: Array<{ event: string; data?: any }>): number {
		if (!this._connected || this.ws.readyState !== Socket.WS_READY_STATE_OPEN) {
			return 0;
		}

		let successful = 0;
		const packets: (string | Uint8Array)[] = [];

		// Формируем batch пакетов
		for (const { event, data } of events) {
			try {
				// Используем object pooling для пакетов
				const pooledPacket = packetPool.acquire();
				pooledPacket.event = event;
				pooledPacket.data = data;
				pooledPacket.namespace = this.nsp;

				let packet: string | Uint8Array;

				// Попытка бинарного кодирования
				if (
					BinaryProtocol.supportsBinaryEncoding(event) &&
					(typeof data === 'string' || typeof data === 'number')
				) {
					const binaryPacket = BinaryProtocol.encodeBinaryEvent(event, data);
					if (binaryPacket) {
						packet = binaryPacket;
					} else {
						packet = SocketParser.encode(event as any, data, undefined, this.nsp);
					}
				} else {
					packet = SocketParser.encode(event as any, data, undefined, this.nsp);
				}

				packets.push(packet);
				packetPool.release(pooledPacket);
			} catch (error) {
				// Продолжаем обработку остальных
				continue;
			}
		}

		// Отправляем все пакеты
		for (const packet of packets) {
			try {
				if (this.ws.send(packet) > 0) {
					successful++;
				}
			} catch {
				// Ignore individual failures
			}
		}

		return successful;
	}

	/**
	 * Batch emit для массовой отправки (оптимизация для множественных emit)
	 */
	emitBatch(events: Array<{ event: string; data?: any }>): number {
		if (!this._connected || this.ws.readyState !== 1) return 0;

		let successful = 0;

		for (const { event, data } of events) {
			try {
				let packet: string;

				if (data === undefined) {
					packet = SocketParser.encodeSimpleEvent(event, this.nsp);
				} else if (typeof data === 'string') {
					packet = SocketParser.encodeStringEvent(event, data, this.nsp);
				} else {
					packet = SocketParser.encode(event as any, data, undefined, this.nsp);
				}

				if (this.ws.send(packet) > 0) {
					successful++;
				}
			} catch (error) {
				// Продолжаем отправку остальных
				continue;
			}
		}

		return successful;
	}

	/**
	 * Memory-efficient ACK с использованием typed arrays
	 */
	private ackResponseBuffer = new ArrayBuffer(1024);
	private ackResponseView = new DataView(this.ackResponseBuffer);

	emitWithTypedAck(event: string, data: any, callback: AckCallback): boolean {
		if (!this._connected || this.ws.readyState !== Socket.WS_READY_STATE_OPEN) {
			return false;
		}

		const ackId = SocketParser.generateAckId();

		// Используем typed callback для лучшей производительности
		this.fastAckCallbacks[ackId] = callback;

		// Установка timeout с использованием pool
		const timeoutId = setTimeout(() => {
			if (this.fastAckCallbacks[ackId]) {
				delete this.fastAckCallbacks[ackId];
				callback(new Error('Timeout'));
			}
		}, 3000); // Уменьшенный timeout для стресс-тестов

		try {
			const packet = SocketParser.encode(event as any, data, ackId, this.nsp);
			const success = this.ws.send(packet) > 0;

			if (!success) {
				clearTimeout(timeoutId);
				delete this.fastAckCallbacks[ackId];
			}

			return success;
		} catch (error) {
			clearTimeout(timeoutId);
			delete this.fastAckCallbacks[ackId];
			return false;
		}
	}

	/**
	 * Fast ACK для высокочастотных операций
	 */
	emitWithFastAck(event: string, data: any, callback: AckCallback): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		const ackId = SocketParser.generateAckId();
		this.fastAckCallbacks[ackId] = callback;

		// Простая cleanup через setTimeout (можно заменить на batch cleanup)
		setTimeout(() => {
			if (this.fastAckCallbacks[ackId]) {
				delete this.fastAckCallbacks[ackId];
				callback(new Error('Acknowledgement timeout'));
			}
		}, 5000); // Уменьшенный timeout для стресс-тестов

		const packet = SocketParser.encode(event as any, data, ackId, this.nsp);
		return this.ws.send(packet) > 0;
	}

	/**
	 * Добавить ACK ответ в batch
	 */
	private batchAckResponse(ackResponse: string): void {
		this.ackResponseBatch.push(ackResponse);

		// Отправляем немедленно если batch заполнен
		if (this.ackResponseBatch.length >= this.ACK_BATCH_SIZE) {
			this.flushAckBatch();
		} else if (!this.ackBatchTimer) {
			// Micro-timeout для отправки оставшихся
			this.ackBatchTimer = setTimeout(() => this.flushAckBatch(), this.ACK_BATCH_TIMEOUT);
		}
	}

	/**
	 * Отправка всех накопленных ACK в одном фрейме
	 */
	private flushAckBatch(): void {
		if (this.ackBatchTimer) {
			clearTimeout(this.ackBatchTimer);
			this.ackBatchTimer = undefined;
		}

		if (this.ackResponseBatch.length === 0) return;

		if (this.ackResponseBatch.length === 1) {
			// Если только один ACK, отправляем напрямую
			this.ws.send(this.ackResponseBatch[0]);
		} else {
			// Объединяем множественные ACK в один фрейм с разделителем
			const batchedResponse = this.ackResponseBatch.join('\n');
			this.ws.send(batchedResponse);
		}

		this.ackResponseBatch = [];
	}

	join(room: Room | Room[]): this {
		const rooms = Array.isArray(room) ? room : [room];

		for (const r of rooms) {
			if (!this.rooms.has(r)) {
				this.rooms.add(r);
				this.namespace.adapter.addSocket(this.id, r);
				this.ws.subscribe(`room:${this.nsp}:${r}`);
			}
		}

		return this;
	}

	leave(room: Room): this {
		if (this.rooms.has(room) && room !== this.id) {
			this.rooms.delete(room);
			this.namespace.adapter.removeSocket(this.id, room);
			this.ws.unsubscribe(`room:${this.nsp}:${room}`);
		}

		return this;
	}

	leaveAll(): this {
		const roomsToLeave = Array.from(this.rooms).filter((room) => room !== this.id);
		roomsToLeave.forEach((room) => this.leave(room));
		return this;
	}

	get broadcast(): any {
		return this.namespace.except(this.id);
	}

	to(room: Room | Room[]): any {
		return this.namespace.to(room);
	}

	in(room: Room | Room[]): any {
		return this.to(room);
	}

	timeout(timeout: number): any {
		return this.namespace.timeout(timeout);
	}

	disconnect(close: boolean = false): this {
		this.flushAckBatch(); // Отправляем оставшиеся ACK
		this.stopHeartbeat();
		if (!this._connected) return this;

		this._connected = false;
		this.emit('disconnecting' as any, 'server namespace disconnect');

		try {
			const disconnectPacket = SocketParser.encodeDisconnect(this.nsp);
			this.ws.send(disconnectPacket);
		} catch (error) {
			console.warn('[Socket] Failed to send disconnect packet:', error);
		}

		this.leaveAll();
		this.ackCallbacks.clear();
		this.namespace.removeSocket(this);
		this.emit('disconnect' as any, 'server namespace disconnect');

		if (close && this.ws.readyState === 1) {
			this.ws.close();
		}

		return this;
	}

	/**
	 * ИСПРАВЛЕНИЕ: Улучшенная обработка входящих пакетов
	 */
	_handlePacket(packet: any): void {
		if (!packet || !packet.event) return;

		if (!isProduction) {
			console.log(`[Socket] Handling packet: ${packet.event} from ${this.id}`);
		}

		// Handle special Socket.IO events
		if (packet.event === '__connect') return;
		if (packet.event === '__disconnect') {
			this._handleClose('client namespace disconnect');
			return;
		}

		// Handle acknowledgement response
		if (packet.event === '__ack' && packet.ackId && this.ackCallbacks.has(packet.ackId)) {
			const callback = this.ackCallbacks.get(packet.ackId)!;
			this.ackCallbacks.delete(packet.ackId);
			const responseData = Array.isArray(packet.data) ? packet.data[0] : packet.data;
			callback(null, responseData);
			return;
		}

		// Handle Engine.IO ping/pong
		if (packet.event === 'ping') {
			this.ws.send('3');
			return;
		}
		if (packet.event === 'pong') return;

		// ИСПРАВЛЕНИЕ: Улучшенная обработка ACK запросов с батчингом
		if (packet.ackId && typeof packet.ackId === 'string') {
			const originalListeners = this.listeners(packet.event);

			if (originalListeners.length > 0) {
				const listener = originalListeners[0] as Function;

				// Создаем ACK wrapper с батчингом
				const ackWrapper = (...args: any[]) => {
					const ackResponse = SocketParser.encodeAckResponse(
						packet.ackId!,
						args,
						this.nsp
					);
					this.batchAckResponse(ackResponse); // Используем батчинг
				};

				try {
					if (packet.data !== undefined) {
						if (listener.length > 1) {
							listener.call(this, packet.data, ackWrapper);
						} else {
							listener.call(this, packet.data);
							ackWrapper();
						}
					} else {
						if (listener.length > 0) {
							listener.call(this, ackWrapper);
						} else {
							listener.call(this);
							ackWrapper();
						}
					}
				} catch (error) {
					if (!isProduction) {
						console.error(
							`[Socket] Error in event handler for ${packet.event}:`,
							error
						);
					}
					ackWrapper([{ error: 'Internal server error' }]);
				}
				return;
			} else {
				// Нет обработчиков, отправляем ошибку в ACK через батчинг
				const ackResponse = SocketParser.encodeAckResponse(
					packet.ackId!,
					[{ error: `No handler for event: ${packet.event}` }],
					this.nsp
				);
				this.batchAckResponse(ackResponse);
				return;
			}
		}

		// Обычное событие без ACK
		try {
			if (packet.data !== undefined) {
				this.emit(packet.event as any, packet.data);
			} else {
				this.emit(packet.event as any);
			}
		} catch (error) {
			console.error(`[Socket] Error emitting event ${packet.event}:`, error);
		}
	}

	/**
	 * Обновленный _handleAck с поддержкой fastAckCallbacks
	 */
	_handleAck(ackId: string, data: any): void {
		// Сначала проверяем быстрые callbacks
		if (this.fastAckCallbacks[ackId]) {
			const callback = this.fastAckCallbacks[ackId];
			delete this.fastAckCallbacks[ackId];
			callback(null, data);
			return;
		}

		// Затем обычные Map callbacks
		const callback = this.ackCallbacks.get(ackId);
		if (callback) {
			this.ackCallbacks.delete(ackId);
			callback(null, data);
		}
	}

	_handleClose(reason: DisconnectReason): void {
		this.stopHeartbeat();
		if (this._connected) {
			this._connected = false;
			this.leaveAll();
			this.ackCallbacks.clear();
			this.namespace.removeSocket(this);
			this.emit('disconnect' as any, reason);
		}
	}

	_handleError(error: Error): void {
		this.emit('error' as any, error);
	}
}
