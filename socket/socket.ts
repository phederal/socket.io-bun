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
import { SocketParser } from './parser';

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
			if (process.env.NODE_ENV === 'development') {
				console.log(`[Socket] Sending packet to ${this.id} for event '${event}':`, packet);
			}

			// Проверяем что пакет корректный
			if (!packet || typeof packet !== 'string') {
				if (process.env.NODE_ENV === 'development') {
					console.error(`[Socket] Invalid packet generated for ${this.id}:`, packet);
				}
				return false;
			}

			const result = this.ws.send(packet);

			return result !== 0 && result !== -1;
		} catch (error) {
			console.error('[Socket] Emit error:', error);
			return false;
		}
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

		if (process.env.NODE_ENV === 'development') {
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

		// ИСПРАВЛЕНИЕ: Улучшенная обработка ACK запросов
		if (packet.ackId && typeof packet.ackId === 'string') {
			const originalListeners = this.listeners(packet.event);

			if (originalListeners.length > 0) {
				const listener = originalListeners[0] as Function;

				// Создаем ACK wrapper
				const ackWrapper = (...args: any[]) => {
					if (process.env.NODE_ENV === 'development') {
						console.log(`[Socket] Sending ACK response for ${packet.ackId}:`, args);
					}
					const ackResponse = SocketParser.encodeAckResponse(
						packet.ackId!,
						args,
						this.nsp
					);
					this.ws.send(ackResponse);
				};

				try {
					// Проверяем количество параметров у listener
					if (packet.data !== undefined) {
						if (listener.length > 1) {
							// Listener ожидает callback
							listener.call(this, packet.data, ackWrapper);
						} else {
							// Listener не ожидает callback, но ACK запрошен
							listener.call(this, packet.data);
							ackWrapper(); // Отправляем пустой ACK
						}
					} else {
						if (listener.length > 0) {
							// Listener ожидает callback
							listener.call(this, ackWrapper);
						} else {
							// Listener не ожидает callback
							listener.call(this);
							ackWrapper(); // Отправляем пустой ACK
						}
					}
				} catch (error) {
					console.error(`[Socket] Error in event handler for ${packet.event}:`, error);
					ackWrapper([{ error: 'Internal server error' }]);
				}
				return;
			} else {
				// Нет обработчиков, отправляем ошибку в ACK
				console.warn(`[Socket] No listeners for event ${packet.event}, sending error ACK`);
				const ackResponse = SocketParser.encodeAckResponse(
					packet.ackId!,
					[{ error: `No handler for event: ${packet.event}` }],
					this.nsp
				);
				this.ws.send(ackResponse);
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

	_handleAck(ackId: string, data: any): void {
		if (process.env.NODE_ENV === 'development') {
			console.log(`[Socket] Handling ACK ${ackId} for socket ${this.id}:`, data);
		}
		if (this.ackCallbacks.has(ackId)) {
			const callback = this.ackCallbacks.get(ackId)!;
			this.ackCallbacks.delete(ackId);
			if (process.env.NODE_ENV === 'development') {
				console.log(`[Socket] Calling ACK callback for ${ackId}`);
			}
			callback(null, data);
		} else if (process.env.NODE_ENV === 'development') {
			console.warn(`[Socket] No ACK callback found for ${ackId} on socket ${this.id}`);
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
