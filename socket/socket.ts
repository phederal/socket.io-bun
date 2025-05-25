import { EventEmitter } from 'events';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketId,
	Room,
	AckCallback,
	DisconnectReason,
	Handshake,
	SocketData as DefaultSocketData,
	EventsMap,
	DefaultEventsMap,
} from '../shared/types/socket.types';
import { SocketParser } from './parser';
import { BinaryProtocol } from './object-pool';

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

	private heartbeatTimer?: NodeJS.Timeout;
	private readonly heartbeatInterval = 30000; // 30 секунд
	private _connected: boolean = true;
	private _sessionId: string;

	public readonly ws: ServerWebSocket<WSContext>;
	private namespace: any;

	// ЕДИНАЯ система ACK callbacks
	private ackCallbacks = new Map<
		string,
		{
			callback: AckCallback;
			timeoutId: NodeJS.Timeout;
			createdAt: number;
		}
	>();

	// Batch обработка ACK для производительности
	private ackBatchQueue: Array<{ ackId: string; data: any }> = [];
	private ackBatchTimer?: NodeJS.Timeout;

	// Rate limiting
	private messageRateLimit = {
		count: 0,
		lastReset: Date.now(),
		maxPerSecond: 10000, // Увеличено с 1000 до 10000
		maxBurst: 1000, // Увеличено с 100 до 1000
	};

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
			if (this._connected && this.ws.readyState === 1) {
				if (this.checkRateLimit(1)) {
					try {
						this.ws.send('2'); // Engine.IO ping
					} catch (error) {
						console.error(`[Socket] ${this.id} heartbeat error:`, error);
						this._handleClose('transport error');
					}
				}
			}
		}, this.heartbeatInterval);

		if (!isProduction) {
			console.log(
				`[Socket] ${this.id} heartbeat started with ${this.heartbeatInterval}ms interval`
			);
		}
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	private checkRateLimit(messageCount: number = 1): boolean {
		// Отключаем rate limiting в production для тестов
		if (process.env.NODE_ENV === 'production') {
			return true;
		}

		const now = Date.now();

		// Сброс счетчика каждую секунду
		if (now - this.messageRateLimit.lastReset >= 1000) {
			this.messageRateLimit.count = 0;
			this.messageRateLimit.lastReset = now;
		}

		// Проверяем лимиты
		if (this.messageRateLimit.count + messageCount > this.messageRateLimit.maxPerSecond) {
			console.warn(
				`[Socket] ${this.id} rate limit exceeded: ${this.messageRateLimit.count}/sec`
			);
			return false;
		}

		if (messageCount > this.messageRateLimit.maxBurst) {
			console.warn(`[Socket] ${this.id} burst limit exceeded: ${messageCount}`);
			return false;
		}

		this.messageRateLimit.count += messageCount;
		return true;
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

				const timeoutId = setTimeout(() => {
					const callback = this.ackCallbacks.get(ackId!);
					if (callback) {
						this.ackCallbacks.delete(ackId!);
						ack!(new Error('Acknowledgement timeout'));
					}
				}, 10000);

				this.ackCallbacks.set(ackId, {
					callback: ack,
					timeoutId,
					createdAt: Date.now(),
				});
			}

			const packet = SocketParser.encode(event as any, data, ackId, this.nsp);

			if (!isProduction) {
				console.log(`[Socket] Sending packet to ${this.id} for event '${event}':`, packet);
			}

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
	 * ЕДИНСТВЕННЫЙ метод для emit с ACK и настройками
	 */
	emitWithAck(
		event: string,
		data: any,
		callback: AckCallback,
		options: {
			timeout?: number;
			priority?: 'low' | 'normal' | 'high';
			binary?: boolean;
			batch?: boolean;
		} = {}
	): boolean {
		if (!this._connected || this.ws.readyState !== 1) {
			callback(new Error('Socket not connected'));
			return false;
		}

		if (!this.checkRateLimit(1)) {
			callback(new Error('Rate limit exceeded'));
			return false;
		}

		const ackId = SocketParser.generateAckId();

		// Настраиваемый timeout в зависимости от приоритета
		let timeout = options.timeout;
		if (!timeout) {
			switch (options.priority) {
				case 'high':
					timeout = 1000;
					break;
				case 'low':
					timeout = 15000;
					break;
				default:
					timeout = 5000;
					break;
			}
		}

		const timeoutId = setTimeout(() => {
			const ack = this.ackCallbacks.get(ackId);
			if (ack) {
				this.ackCallbacks.delete(ackId);
				callback(new Error(`Acknowledgement timeout after ${timeout}ms`));
			}
		}, timeout);

		this.ackCallbacks.set(ackId, {
			callback,
			timeoutId,
			createdAt: Date.now(),
		});

		try {
			let packet: string | Uint8Array;

			// Бинарное кодирование если запрошено
			if (options.binary && BinaryProtocol.supportsBinaryEncoding(event)) {
				const binaryPacket = BinaryProtocol.encodeBinaryEvent(event, data);
				if (binaryPacket) {
					packet = binaryPacket;
				} else {
					packet = SocketParser.encode(event as any, data, ackId, this.nsp);
				}
			} else {
				packet = SocketParser.encode(event as any, data, ackId, this.nsp);
			}

			const success = this.ws.send(packet) > 0;

			if (!success) {
				this.cleanupAck(ackId);
				callback(new Error('Failed to send packet'));
			}

			return success;
		} catch (error) {
			this.cleanupAck(ackId);
			callback(error as Error);
			return false;
		}
	}

	/**
	 * Бинарный emit
	 */
	emitBinary<Ev extends keyof EmitEvents>(
		event: Ev,
		data?: Parameters<EmitEvents[Ev]>[0]
	): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		// ДОБАВЛЯЕМ проверку rate limit
		if (!this.checkRateLimit(1)) return false;

		const binaryPacket = SocketParser.encodeBinary(event, data, this.nsp);
		if (binaryPacket) {
			try {
				return this.ws.send(binaryPacket) > 0;
			} catch {
				return false;
			}
		}

		return this.emit(event, data as any);
	}

	/**
	 * Быстрый emit для простых случаев
	 */
	emitFast(event: string, data?: string): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		// ДОБАВЛЯЕМ проверку rate limit
		if (!this.checkRateLimit(1)) return false;

		let packet: string;
		if (data) {
			packet = SocketParser.encodeStringEvent(event, data, this.nsp);
		} else {
			packet = SocketParser.encodeSimpleEvent(event, this.nsp);
		}

		return this.ws.send(packet) > 0;
	}

	/**
	 * Batch emit
	 */
	emitBatch(events: Array<{ event: string; data?: any; binary?: boolean }>): number {
		if (!this._connected || this.ws.readyState !== 1) return 0;

		// ДОБАВЛЯЕМ проверку rate limit для всего batch
		if (!this.checkRateLimit(events.length)) return 0;

		let successful = 0;

		for (const { event, data, binary } of events) {
			try {
				let packet: string | Uint8Array;

				if (binary && BinaryProtocol.supportsBinaryEncoding(event)) {
					const binaryPacket = BinaryProtocol.encodeBinaryEvent(event, data);
					if (binaryPacket) {
						packet = binaryPacket;
					} else {
						packet = SocketParser.encode(event as any, data, undefined, this.nsp);
					}
				} else {
					packet = SocketParser.encode(event as any, data, undefined, this.nsp);
				}

				if (this.ws.send(packet) > 0) {
					successful++;
				}
			} catch {
				continue;
			}
		}

		return successful;
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
		// Очищаем все pending ACKs
		for (const [ackId, ack] of this.ackCallbacks) {
			clearTimeout(ack.timeoutId);
			try {
				ack.callback(new Error('Socket disconnected'));
			} catch (error) {
				// Ignore callback errors during disconnect
			}
		}
		this.ackCallbacks.clear();

		if (this.ackBatchTimer) {
			clearTimeout(this.ackBatchTimer);
			this.ackBatchTimer = undefined;
		}

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
		this.namespace.removeSocket(this);
		this.emit('disconnect' as any, 'server namespace disconnect');

		if (close && this.ws.readyState === 1) {
			this.ws.close();
		}

		return this;
	}

	/**
	 * Обработка входящих пакетов
	 */
	_handlePacket(packet: any): void {
		if (!packet || !packet.event) return;

		if (!isProduction) {
			console.log(
				`[Socket] Handling packet: ${packet.event} from ${this.id}, ackId: ${packet.ackId}`
			);
		}

		try {
			if (packet.event === '__connect') return;
			if (packet.event === '__disconnect') {
				this._handleClose('client namespace disconnect');
				return;
			}

			if (packet.event === '__ack' && packet.ackId) {
				if (!isProduction) {
					console.log(`[Socket] Received ACK response: ${packet.ackId} from ${this.id}`);
				}
				this._handleAck(packet.ackId, packet.data);
				return;
			}

			if (packet.event === 'ping') {
				this.ws.send('3');
				return;
			}
			if (packet.event === 'pong') return;

			// Обработка событий с ACK запросом от клиента
			if (packet.ackId && typeof packet.ackId === 'string') {
				if (!isProduction) {
					console.log(
						`[Socket] Event ${packet.event} requires ACK response: ${packet.ackId}`
					);
				}

				const listeners = this.listeners(packet.event);

				if (listeners.length > 0) {
					const listener = listeners[0] as Function;

					const ackWrapper = (...args: any[]) => {
						try {
							if (!isProduction) {
								console.log(`[Socket] Sending ACK response: ${packet.ackId}`, args);
							}

							const ackResponse = SocketParser.encodeAckResponseFast(
								packet.ackId!,
								args.length === 1 ? args[0] : args
							);

							const success = this.ws.send(ackResponse);

							if (!isProduction) {
								console.log(
									`[Socket] ACK sent successfully: ${success > 0}, ID: ${
										packet.ackId
									}`
								);
							}
						} catch (error) {
							if (!isProduction) {
								console.error(`[Socket] Failed to send ACK response:`, error);
							}
						}
					};

					try {
						const listenerLength = listener.length;

						if (packet.data !== undefined) {
							if (listenerLength > 1) {
								listener.call(this, packet.data, ackWrapper);
							} else {
								const result = listener.call(this, packet.data);
								ackWrapper(result);
							}
						} else {
							if (listenerLength > 0) {
								listener.call(this, ackWrapper);
							} else {
								const result = listener.call(this);
								ackWrapper(result);
							}
						}
					} catch (error) {
						if (!isProduction) {
							console.error(
								`[Socket] Error in ACK event handler for ${packet.event}:`,
								error
							);
						}
						ackWrapper({ error: 'Internal server error' });
					}
					return;
				} else {
					if (!isProduction) {
						console.warn(`[Socket] No handler for ACK event: ${packet.event}`);
					}

					try {
						const ackResponse = SocketParser.encodeAckResponseFast(packet.ackId!, {
							error: `No handler for event: ${packet.event}`,
						});
						this.ws.send(ackResponse);
					} catch (error) {
						if (!isProduction) {
							console.error(`[Socket] Failed to send error ACK:`, error);
						}
					}
					return;
				}
			}

			// Обычное событие без ACK
			if (!isProduction) {
				console.log(`[Socket] Emitting regular event: ${packet.event}`);
			}

			if (packet.data !== undefined) {
				this.emit(packet.event as any, packet.data);
			} else {
				this.emit(packet.event as any);
			}
		} catch (error) {
			if (!isProduction) {
				console.error(`[Socket] Error handling packet ${packet.event}:`, error);
			}
		}
	}

	/**
	 * ЕДИНАЯ обработка ACK ответов
	 */
	_handleAck(ackId: string, data: any): void {
		if (!isProduction) {
			console.log(`[Socket] _handleAck called with ackId: ${ackId}, data:`, data);
		}

		this.ackBatchQueue.push({ ackId, data });

		if (!this.ackBatchTimer) {
			this.ackBatchTimer = setTimeout(() => this.processAckBatch(), 1);
		}
	}

	private processAckBatch(): void {
		if (this.ackBatchTimer) {
			clearTimeout(this.ackBatchTimer);
			this.ackBatchTimer = undefined;
		}

		if (this.ackBatchQueue.length === 0) return;

		const batch = this.ackBatchQueue.splice(0);

		for (const { ackId, data } of batch) {
			const ack = this.ackCallbacks.get(ackId);
			if (ack) {
				clearTimeout(ack.timeoutId);
				this.ackCallbacks.delete(ackId);

				try {
					ack.callback(null, data);
				} catch (error) {
					if (!isProduction) {
						console.error(`[Socket] ACK callback error:`, error);
					}
				}
			} else {
				if (!isProduction) {
					console.warn(`[Socket] No callback found for ackId: ${ackId}`);
				}
			}
		}
	}

	private cleanupAck(ackId: string): void {
		const ack = this.ackCallbacks.get(ackId);
		if (ack) {
			clearTimeout(ack.timeoutId);
			this.ackCallbacks.delete(ackId);
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

	private sanitizeData(data: any, seen = new WeakSet()): any {
		if (data === null || data === undefined) return data;

		if (typeof data === 'function') return undefined;

		if (typeof data === 'object' && seen.has(data)) {
			return '[Circular]';
		}

		if (Array.isArray(data)) {
			seen.add(data);
			const result = data.map((item) => this.sanitizeData(item, seen));
			seen.delete(data);
			return result;
		}

		if (typeof data === 'object') {
			seen.add(data);
			const sanitized: any = {};
			for (const [key, value] of Object.entries(data)) {
				if (typeof value !== 'function') {
					sanitized[key] = this.sanitizeData(value, seen);
				}
			}
			seen.delete(data);
			return sanitized;
		}

		return data;
	}

	/**
	 * Статистика для отладки
	 */
	getAckStats() {
		const now = Date.now();
		const pending = Array.from(this.ackCallbacks.values());

		return {
			total: pending.length,
			oldestAge: pending.length > 0 ? Math.max(...pending.map((a) => now - a.createdAt)) : 0,
			batchQueueSize: this.ackBatchQueue.length,
		};
	}
}

/**
 * Warm-up функция для инициализации pools и кешей
 */
export function warmupPerformanceOptimizations(): void {
	if (!isProduction) {
		console.log('🔥 Warming up performance optimizations...');
	}

	// Прогреваем кеши парсера
	SocketParser.encodeSimpleEvent('test', '/');
	SocketParser.encodeStringEvent('test', 'warmup', '/');

	// Прогреваем binary protocol
	BinaryProtocol.encodeBinaryEvent('ping');
	BinaryProtocol.encodeBinaryEvent('message', 'test');

	if (!isProduction) {
		console.log('✅ Performance optimizations warmed up!');
	}
}
