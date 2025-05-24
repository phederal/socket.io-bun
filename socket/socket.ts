import { BroadcastOperator } from './broadcast-client';
import type { AuthUser, AuthSession } from '@/lib/auth';
import type { Room, WS } from './server';
import type { AckCallback, AckMap, ServerToClientEvents } from 'shared/types/socket.types';
import type { Namespace } from './namespace';
import { EventEmitter } from 'events';
import { StrictEventEmitter, type AuthSessionNotNull, type AuthUserNotNull, type DefaultEventsMap, type EventsMap, type SocketReservedEventsMap } from './types';
import type { Client } from './client';
import { Packet } from './parser';

export class Socket<
	// Types for the events received from the clients.
	ListenEvents extends EventsMap = DefaultEventsMap,
	// Types for the events sent to the clients.
	EmitEvents extends EventsMap = ListenEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData = any,
> extends StrictEventEmitter<ListenEvents, EmitEvents, SocketReservedEventsMap> {
	public id: string;
	public client: Client<ListenEvents, EmitEvents, SocketReservedEventsMap>;
	public namespace: Namespace;
	public user: AuthUserNotNull;
	public session: AuthSessionNotNull;
	private flags = {};
	private ackCallbacks: AckMap = new Map();

	constructor(client: Client<ListenEvents, EmitEvents, SocketReservedEventsMap>, namespace: Namespace) {
		super();
		this.client = client;
		this.user = client.user;
		this.session = client.session;
		this.id = client.user.id;
		this.namespace = namespace;
	}

	get nsp(): Namespace['name'] {
		return this.namespace.name;
	}

	get broadcast() {
		const b = new BroadcastOperator(this);
		return b.broadcast;
	}

	get except() {
		const b = new BroadcastOperator(this);
		return b.except.bind(b);
	}

	get in() {
		const b = new BroadcastOperator(this);
		return b.in.bind(b);
	}

	get to() {
		const b = new BroadcastOperator(this);
		return b.to.bind(b);
	}

	get timeout() {
		const b = new BroadcastOperator(this);
		return b.timeout.bind(b);
	}

	emit<E extends keyof ServerToClientEvents>(event: E, data: ServerToClientEvents[E], ack?: AckCallback): boolean {
		if (this.client.conn && this.client.ws.readyState !== 1) return false;
		const status = this.client.ws.raw?.send(this._buildPayload(event, data, true, ack));
		if (status === 0) return false;
		else if (status === -1) return false;
		else return true;
	}

	join(room: string): this {
		this.namespace.join(this, room);
		return this;
	}

	leave(room: string): this {
		this.namespace.leave(this, room);
		return this;
	}

	private newBroadcastOperator() {
		const flags = Object.assign({}, this.flags);
		this.flags = {};
		return new BroadcastOperator(this, new Set<Room>(), new Set<Room>([this.id]), flags);
	}

	/**
	 * Builds the payload to be sent over the socket connection.
	 * If an acknowledgment callback is provided, a unique ackId will be generated and included in the packet.
	 *
	 * @template T - The type of the data being sent.
	 * @param event - The event name associated with the data.
	 * @param data - The data to be sent.
	 * @param binary - Optional flag indicating if the data should be sent as binary.
	 * @param ack - Optional acknowledgment callback.
	 * @returns The serialized payload as a string or Uint8Array.
	 */
	private _buildPayload<T>(event: keyof ServerToClientEvents, data: T, binary = true, ack?: AckCallback): string | Uint8Array {
		let ackId: string | undefined;
		if (ack) {
			ackId = this._generateUniqueAckId();
			this.ackCallbacks.set(ackId, ack);
			setTimeout(() => this.ackCallbacks.delete(ackId!), 10000); // 10 сек
		}
		const packet = ackId != null ? { event, data, ackId } : { event, data };

		if (binary) {
			// всё подряд упаковываем в msgpack
			return Packet.encode(packet);
		} else {
			return JSON.stringify(packet);
		}
	}

	/**
	 * Generates a unique string-based acknowledgment ID.
	 * The ID is formatted as follows: `ack_<timestamp>_<random_string>`.
	 * The timestamp is the current time in milliseconds, and the random string is a 9-character string in base 36.
	 *
	 * @returns A unique acknowledgment ID.
	 */
	private _generateUniqueAckId(): string {
		return `ack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Генерируем уникальный строковый ackId
	}
}
