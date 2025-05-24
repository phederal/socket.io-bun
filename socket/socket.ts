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
	SocketData,
} from '../shared/types/socket.types';
import { SocketParser } from './parser';
import type { Namespace } from './namespace';
import type { BroadcastOperator } from './broadcast';

export interface SocketReservedEvents {
	disconnect: (reason: DisconnectReason, description?: any) => void;
	disconnecting: (reason: DisconnectReason, description?: any) => void;
	error: (err: Error) => void;
}

export class Socket extends EventEmitter {
	public readonly id: SocketId;
	public readonly handshake: Handshake;
	public readonly rooms: Set<Room> = new Set();
	public readonly data: SocketData = {};

	private readonly ws: ServerWebSocket<WSContext>;
	private readonly namespace: Namespace;
	private readonly ackCallbacks: AckMap = new Map();
	private _connected: boolean = true;

	constructor(
		id: SocketId,
		ws: ServerWebSocket<WSContext>,
		namespace: Namespace,
		handshake: Handshake
	) {
		super();
		this.id = id;
		this.ws = ws;
		this.namespace = namespace;
		this.handshake = handshake;

		// Join default room (socket's own ID)
		this.rooms.add(this.id);
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
	 * Emit event to this socket
	 */
	override emit<K extends keyof ServerToClientEvents>(
		event: K,
		...args: Parameters<ServerToClientEvents[K]>
	): boolean;
	override emit<K extends keyof ServerToClientEvents>(
		event: K,
		data: Parameters<ServerToClientEvents[K]>[0],
		ack?: AckCallback
	): boolean;
	override emit<K extends keyof ServerToClientEvents>(
		event: K,
		dataOrArg?: any,
		ack?: AckCallback
	): boolean {
		if (!this.connected) return false;

		try {
			let ackId: string | undefined;

			// Handle acknowledgement callback
			if (typeof ack === 'function') {
				ackId = SocketParser.generateAckId();
				this.ackCallbacks.set(ackId, ack);

				// Clean up callback after timeout
				setTimeout(() => {
					if (this.ackCallbacks.has(ackId!)) {
						this.ackCallbacks.delete(ackId!);
						ack(new Error('Acknowledgement timeout'));
					}
				}, 10000);
			}

			const packet = SocketParser.encode(event, dataOrArg, ackId);
			const result = this.ws.send(packet);

			return result !== 0 && result !== -1;
		} catch (error) {
			console.error('[Socket] Emit error:', error);
			return false;
		}
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
	get broadcast(): BroadcastOperator {
		return this.namespace.except(this.id);
	}

	/**
	 * Disconnect the socket
	 */
	disconnect(close: boolean = false): this {
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

		if (close) {
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
		if (packet.ackId && this.ackCallbacks.has(packet.ackId)) {
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

		// Emit the event to socket listeners
		this.emit(packet.event as any, packet.data);
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
