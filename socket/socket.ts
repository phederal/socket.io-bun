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

export interface SocketReservedEvents {
	disconnect: (reason: DisconnectReason, description?: any) => void;
	disconnecting: (reason: DisconnectReason, description?: any) => void;
	error: (err: Error) => void;
}

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

	public readonly ws: ServerWebSocket<WSContext>;
	private namespace: any; // Избегаем циклического импорта

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

		// Join default room (socket's own ID)
		this.rooms.add(this.id);
		this.startHeartbeat();
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this.connected) {
				this.emit('ping' as any);
			}
		}, this.heartbeatInterval);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	/**
	 * Get namespace name
	 */
	get nsp(): string {
		return this.namespace.name;
	}

	/**
	 * Check if socket is connected
	 */
	get connected(): boolean {
		return this._connected && this.ws.readyState === 1;
	}

	/**
	 * Typed event listeners with proper overloads
	 */
	override on<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this;
	override on<Ev extends keyof SocketReservedEvents>(
		event: Ev,
		listener: SocketReservedEvents[Ev]
	): this;
	override on(event: string, listener: (...args: any[]) => void): this;
	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	/**
	 * Typed once listeners with proper overloads
	 */
	override once<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this;
	override once<Ev extends keyof SocketReservedEvents>(
		event: Ev,
		listener: SocketReservedEvents[Ev]
	): this;
	override once(event: string, listener: (...args: any[]) => void): this;
	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	/**
	 * Typed removeListener with proper overloads
	 */
	override removeListener<Ev extends keyof ListenEvents>(
		event: Ev,
		listener: ListenEvents[Ev]
	): this;
	override removeListener<Ev extends keyof SocketReservedEvents>(
		event: Ev,
		listener: SocketReservedEvents[Ev]
	): this;
	override removeListener(event: string, listener: (...args: any[]) => void): this;
	override removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.removeListener(event, listener);
	}

	/**
	 * Typed off (alias for removeListener)
	 */
	override off<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this;
	override off<Ev extends keyof SocketReservedEvents>(
		event: Ev,
		listener: SocketReservedEvents[Ev]
	): this;
	override off(event: string, listener: (...args: any[]) => void): this;
	override off(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.off(event, listener);
	}

	/**
	 * Typed emit event to this socket with proper overloads
	 */
	override emit<Ev extends keyof EmitEvents>(
		event: Ev,
		...args: Parameters<EmitEvents[Ev]>
	): boolean;
	override emit<Ev extends keyof EmitEvents>(
		event: Ev,
		data: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	override emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	override emit(event: string | symbol, ...args: any[]): boolean;
	override emit<Ev extends keyof EmitEvents>(
		event: Ev | string | symbol,
		dataOrArg?: any,
		ack?: AckCallback
	): boolean {
		if (!this._connected) return false;

		try {
			let ackId: string | undefined;
			let data: any;

			// Handle different call signatures
			if (typeof dataOrArg === 'function') {
				// emit(event, ack)
				ack = dataOrArg;
				data = undefined;
			} else if (typeof ack === 'function') {
				// emit(event, data, ack)
				data = dataOrArg;
			} else {
				// emit(event, ...args) or emit(event, data)
				data = dataOrArg;
				// Ensure data doesn't contain functions
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

			const packet = SocketParser.encode(event as any, data, ackId);
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

		// Check for circular references
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
	 * Join a room
	 */
	join(room: Room | Room[]): this {
		const rooms = Array.isArray(room) ? room : [room];

		for (const r of rooms) {
			if (!this.rooms.has(r)) {
				this.rooms.add(r);
				this.namespace.adapter.addSocket(this.id, r);

				// Subscribe to Bun topic for room
				this.ws.subscribe(`room:${this.nsp}:${r}`);
			}
		}

		return this;
	}

	/**
	 * Leave a room
	 */
	leave(room: Room): this {
		if (this.rooms.has(room) && room !== this.id) {
			this.rooms.delete(room);
			this.namespace.adapter.removeSocket(this.id, room);

			// Unsubscribe from Bun topic
			this.ws.unsubscribe(`room:${this.nsp}:${room}`);
		}

		return this;
	}

	/**
	 * Leave all rooms except own ID
	 */
	leaveAll(): this {
		const roomsToLeave = Array.from(this.rooms).filter((room) => room !== this.id);
		roomsToLeave.forEach((room) => this.leave(room));
		return this;
	}

	/**
	 * Get broadcast operator for chaining
	 */
	get broadcast(): any {
		return this.namespace.except(this.id);
	}

	/**
	 * Target specific room(s) for broadcasting
	 */
	to(room: Room | Room[]): any {
		return this.namespace.to(room);
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): any {
		return this.to(room);
	}

	/**
	 * Add timeout for acknowledgements
	 */
	timeout(timeout: number): any {
		return this.namespace.timeout(timeout);
	}

	/**
	 * Disconnect the socket
	 */
	disconnect(close: boolean = false): this {
		this.stopHeartbeat();
		if (!this._connected) return this;

		this._connected = false;
		this.emit('disconnecting' as any, 'server namespace disconnect');

		// Leave all rooms
		this.leaveAll();

		// Clean up acknowledgement callbacks
		this.ackCallbacks.clear();

		// Remove from namespace
		this.namespace.removeSocket(this);

		this.emit('disconnect' as any, 'server namespace disconnect');

		if (close && this.ws.readyState === 1) {
			this.ws.close();
		}

		return this;
	}

	/**
	 * Handle incoming packet
	 * @internal
	 */
	_handlePacket(packet: any): void {
		if (!packet || !packet.event) return;

		// Handle acknowledgement response
		if (packet.event === '__ack' && packet.ackId && this.ackCallbacks.has(packet.ackId)) {
			const callback = this.ackCallbacks.get(packet.ackId)!;
			this.ackCallbacks.delete(packet.ackId);
			callback(null, packet.data);
			return;
		}

		// Handle ping/pong
		if (packet.event === 'ping') {
			this.emit('pong' as any);
			return;
		}

		// Check if this is an ack request from client
		if (packet.ackId && typeof packet.ackId === 'string') {
			// Client expects an acknowledgment
			const originalListeners = this.listeners(packet.event);

			if (originalListeners.length > 0) {
				// Find if any listener expects a callback
				const listener = originalListeners[0] as Function;

				if (listener.length > (packet.data !== undefined ? 1 : 0)) {
					// Listener expects more parameters than we're providing - likely a callback
					const ackWrapper = (...args: any[]) => {
						const ackResponse = SocketParser.encodeAckResponse(packet.ackId!, args[0]);
						this.ws.send(ackResponse);
					};

					// Call listener with data and callback
					if (packet.data !== undefined) {
						listener.call(this, packet.data, ackWrapper);
					} else {
						listener.call(this, ackWrapper);
					}
					return;
				}
			}
		}

		// Emit the event to socket listeners
		if (packet.data !== undefined) {
			this.emit(packet.event as any, packet.data);
		} else {
			this.emit(packet.event as any);
		}
	}

	/**
	 * Handle acknowledgement for outgoing packet
	 * @internal
	 */
	_handleAck(ackId: string, data: any): void {
		if (this.ackCallbacks.has(ackId)) {
			const callback = this.ackCallbacks.get(ackId)!;
			this.ackCallbacks.delete(ackId);
			callback(null, data);
		}
	}

	/**
	 * Handle socket close
	 * @internal
	 */
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

	/**
	 * Handle socket error
	 * @internal
	 */
	_handleError(error: Error): void {
		this.emit('error' as any, error);
	}
}
