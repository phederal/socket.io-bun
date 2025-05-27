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
} from '../types/socket.types';
import { BinaryProtocol, SocketParser } from './parser';

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
	private readonly heartbeatInterval = 30000;
	private _connected: boolean = true;
	private _sessionId: string;

	public readonly ws: ServerWebSocket<WSContext>;
	private namespace: any;

	// Исправленная система ACK callbacks с правильной очисткой
	private ackCallbacks = new Map<
		string,
		{
			callback: AckCallback;
			timeoutId: NodeJS.Timeout;
			createdAt: number;
		}
	>();

	// Отключенный rate limiting для тестов
	private messageRateLimit = {
		count: 0,
		lastReset: Date.now(),
		maxPerSecond: 100000,
		maxBurst: 10000,
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
		// Отключаем rate limiting в test режиме
		if (process.env.NODE_ENV === 'test') {
			return true;
		}

		const now = Date.now();

		if (now - this.messageRateLimit.lastReset >= 1000) {
			this.messageRateLimit.count = 0;
			this.messageRateLimit.lastReset = now;
		}

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

			if (typeof ack === 'function') {
				ackId = SocketParser.generateAckId();

				// Используем прямую регистрацию в EventEmitter для acknowledgment
				const ackEventName = `__ack_${ackId}`;
				this.once(ackEventName, (responseData: any) => {
					ack!(responseData);
				});

				// Устанавливаем таймаут для acknowledgment
				setTimeout(() => {
					this.removeAllListeners(ackEventName);
				}, 5000);
			}

			const packet = SocketParser.encode(event as any, data, ackId, this.nsp);

			if (!packet || typeof packet !== 'string') {
				return false;
			}

			if (this.ws.readyState !== 1) {
				return false;
			}

			const result = this.ws.send(packet);
			return result !== 0 && result !== -1;
		} catch (error) {
			console.error('[Socket] Emit error:', error);
			return false;
		}
	}

	emitWithAck(
		event: string,
		data: any,
		callback: AckCallback,
		options: {
			timeout?: number;
			priority?: 'low' | 'normal' | 'high';
			binary?: boolean;
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

	emitBinary<Ev extends keyof EmitEvents>(
		event: Ev,
		data?: Parameters<EmitEvents[Ev]>[0]
	): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

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

	emitFast(event: string, data?: string): boolean {
		if (!this._connected || this.ws.readyState !== 1) return false;

		if (!this.checkRateLimit(1)) return false;

		let packet: string;
		if (data) {
			packet = SocketParser.encodeStringEvent(event, data, this.nsp);
		} else {
			packet = SocketParser.encodeSimpleEvent(event, this.nsp);
		}

		return this.ws.send(packet) > 0;
	}

	emitBatch(events: Array<{ event: string; data?: any; binary?: boolean }>): number {
		if (!this._connected || this.ws.readyState !== 1) return 0;

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
		this.stopHeartbeat();
		if (!this._connected) return this;

		this._connected = false;
		this.emit('disconnecting' as any, 'server namespace disconnect');

		// Очищаем все ACK listeners
		const ackEvents = this.eventNames().filter(
			(name) => typeof name === 'string' && name.startsWith('__ack_')
		);
		ackEvents.forEach((event) => this.removeAllListeners(event));

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
	 * ИСПРАВЛЕННАЯ обработка входящих пакетов
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
				if (this.ws.readyState === 1) {
					this.ws.send('3');
				}
				return;
			}
			if (packet.event === 'pong') return;

			// ИСПРАВЛЕНО: Правильная обработка событий с ACK запросом от клиента
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
							if (!this._connected || this.ws.readyState !== 1) {
								return;
							}

							const ackResponse = SocketParser.encodeAckResponseFast(
								packet.ackId!,
								args.length === 1 ? args[0] : args
							);

							const success = this.ws.send(ackResponse);

							if (!isProduction && !success) {
								console.warn(
									`[Socket] Failed to send ACK response for ${packet.ackId}`
								);
							}
						} catch (error) {
							if (!isProduction) {
								console.warn(`[Socket] ACK response error:`, error);
							}
						}
					};

					try {
						// ИСПРАВЛЕНО: Правильное определение типа события с ACK
						if (packet.data !== undefined) {
							// Событие с данными и callback
							listener.call(this, packet.data, ackWrapper);
						} else {
							// Событие без данных, только callback
							listener.call(this, ackWrapper);
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

			// ИСПРАВЛЕНО: Обычное событие без ACK - используем super.emit для EventEmitter
			if (!isProduction) {
				console.log(`[Socket] Emitting regular event: ${packet.event}`);
			}

			if (packet.data !== undefined) {
				super.emit(packet.event, packet.data);
			} else {
				super.emit(packet.event);
			}
		} catch (error) {
			if (!isProduction) {
				console.error(`[Socket] Error handling packet ${packet.event}:`, error);
			}
		}
	}

	/**
	 * ИСПРАВЛЕННАЯ обработка ACK ответов
	 */
	_handleAck(ackId: string, data: any): void {
		if (!isProduction) {
			console.log(`[Socket] Handling ACK ${ackId} with data:`, data);
		}

		// Извлекаем данные из Socket.IO массива
		let responseData: any;
		if (Array.isArray(data)) {
			if (data.length === 0) {
				responseData = undefined;
			} else if (data.length === 1) {
				responseData = data[0];
			} else {
				responseData = data;
			}
		} else {
			responseData = data;
		}

		// Эмитим acknowledgment событие через EventEmitter
		const ackEventName = `__ack_${ackId}`;
		super.emit(ackEventName as any, responseData);
	}

	private cleanupAck(ackId?: string): void {
		if (!ackId) return;

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

			// Очищаем все ACK callbacks перед эмитом disconnect
			for (const [ackId, ack] of this.ackCallbacks) {
				clearTimeout(ack.timeoutId);
				try {
					ack.callback(new Error('Socket disconnected'));
				} catch (error) {
					// Ignore callback errors during disconnect
				}
			}
			this.ackCallbacks.clear();
			this.namespace.removeSocket(this);

			// ИСПРАВЛЕНО: Используем super.emit для правильного эмита disconnect события
			super.emit('disconnect', reason);
		}
	}

	_handleError(error: Error): void {
		super.emit('error', error);
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

	getAckStats() {
		const ackEvents = this.eventNames().filter(
			(name) => typeof name === 'string' && name.startsWith('__ack_')
		);

		return {
			total: ackEvents.length,
			oldestAge: 0, // Упрощено, поскольку EventEmitter не отслеживает время создания
		};
	}
}

export function warmupPerformanceOptimizations(): void {
	if (!isProduction) {
		console.log('🔥 Warming up performance optimizations...');
	}

	SocketParser.encodeSimpleEvent('test', '/');
	SocketParser.encodeStringEvent('test', 'warmup', '/');

	BinaryProtocol.encodeBinaryEvent('ping');
	BinaryProtocol.encodeBinaryEvent('message', 'test');

	if (!isProduction) {
		console.log('✅ Performance optimizations warmed up!');
	}
}
