import type { AckCallback, ServerToClientEvents } from 'shared/types/socket.types';
import { Namespace } from './namespace';
import { Socket } from './socket';
import { server } from '@/index';
import type { Room } from './server';
import type { EventsMap, TypedEventBroadcaster } from './types';

export interface BroadcastFlags {
	// volatile?: boolean;
	// compress?: boolean;
	// local?: boolean;
	broadcast?: boolean;
	// binary?: boolean;
	timeout?: number;
}

export interface BroadcastOptions {
	rooms: Set<Room>;
	except?: Set<Room>;
	flags?: BroadcastFlags;
}

export class BroadcastOperator<EmitEvents extends EventsMap, SocketData> implements TypedEventBroadcaster<EmitEvents> {
	constructor(
		private readonly adapter: Adapter,
		private readonly rooms: Set<Room> = new Set<Room>(),
		private readonly exceptRooms: Set<Room> = new Set<Room>(),
		private readonly flags: BroadcastFlags & {
			expectSingleResponse?: boolean;
		} = {},
	) {}

	/**
	 * Broadcasts a packet to all clients.
	 *
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	get broadcast(): BroadcastOperator {
		this.flags.broadcast = true;
		return new BroadcastOperator(this.adapter, this.rooms, this.exceptRooms, this.flags);
	}

	/**
	 * Targets a room when emitting.
	 *
	 * @example
	 * // the “foo” event will be broadcast to all connected clients in the “room-101” room
	 * io.to("room-101").emit("foo", "bar");
	 *
	 * // with an array of rooms (a client will be notified at most once)
	 * io.to(["room-101", "room-102"]).emit("foo", "bar");
	 *
	 * // with multiple chained calls
	 * io.to("room-101").to("room-102").emit("foo", "bar");
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	to(room: Room | Room[]): BroadcastOperator {
		const rooms = new Set(this.rooms);
		if (Array.isArray(room)) {
			for (const i of room) rooms.add(i);
		} else {
			rooms.add(room);
		}
		return new BroadcastOperator(this.adapter, rooms, this.exceptRooms, this.flags);
	}

	/**
	 * Targets a room when emitting. Similar to `to()`, but might feel clearer in some cases:
	 *
	 * @example
	 * // disconnect all clients in the "room-101" room
	 * io.in("room-101").disconnectSockets();
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	in(room: Room | Room[]): BroadcastOperator {
		return this.to(room);
	}

	/**
	 * Set a timeout in milliseconds to wait for a response from a user after emitting an event.
	 *
	 * @param ms Timeout in milliseconds
	 * @returns This instance
	 */
	timeout(ms: number): BroadcastOperator {
		const flags = Object.assign({}, this.flags, { timeout: ms });
		return new BroadcastOperator(this.adapter, this.rooms, this.exceptRooms, flags);
	}

	/**
	 * Excludes a room when emitting.
	 *
	 * @example
	 * // the "foo" event will be broadcast to all connected clients, except the ones that are in the "room-101" room
	 * io.except("room-101").emit("foo", "bar");
	 *
	 * // with an array of rooms
	 * io.except(["room-101", "room-102"]).emit("foo", "bar");
	 *
	 * // with multiple chained calls
	 * io.except("room-101").except("room-102").emit("foo", "bar");
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	except(room: string[] | string): BroadcastOperator {
		const exceptRooms = new Set(this.exceptRooms);
		if (Array.isArray(room)) {
			for (const i of room) exceptRooms.add(i);
		} else {
			exceptRooms.add(room);
		}
		return new BroadcastOperator(this.adapter, this.rooms, exceptRooms, this.flags);
	}

	/**
	 * Emits an event to all connected namespace clients.
	 *
	 * @param userId ID of the user to emit to
	 * @param event Event name
	 * @param data Data to emit
	 * @param options Options
	 * @returns This instance
	 */
	emit<K extends keyof ServerToClientEvents>(event: K, data: ServerToClientEvents[K], options?: { binary?: boolean; ack?: AckCallback }): boolean {
		const payload = this.adapter(event, data, options?.binary, options?.ack);
		try {
			// Namespace
			if (this.rooms.size === 0) {
				if (this.flags.timeout) {
					const timer = setTimeout(() => {
						this._publish(`namespace:${this.adapter.name}`, event, data, payload);
					}, this.flags.timeout);
					clearTimeout(timer);
				} else {
					this._publish(`namespace:${this.adapter.name}`, event, data, payload);
				}
				return true;
			}
			// Each rooms
			for (const room of this.rooms) {
				if (this.exceptRooms.has(room)) continue;
				if (this.flags.timeout) {
					const timer = setTimeout(() => {
						this._publish(`room:${this.adapter.name}:${room}`, event, data, payload);
					}, this.flags.timeout);
					clearTimeout(timer);
				} else {
					this._publish(`room:${this.adapter.name}:${room}`, event, data, payload);
				}
			}
			return true;
		} catch (error) {
			console.error(error);
			return false;
		} finally {
			this._resetChain();
		}
	}

	/**
	 * Sends a message to the client, taking into account the outgoing event handlers.
	 * Calls all outgoing event handlers registered with `onAnyOutgoing` with the event
	 * name and data as arguments, and then sends the message to the client.
	 *
	 * @param topic - The topic name.
	 * @param event - The event name. {@link ServerToClientEvents}
	 * @param data - The event data.
	 * @param payload - The payload to send.
	 */
	private _publish(topic: string, event: keyof ServerToClientEvents, data: any, payload: any) {
		// Вызываем все обработчики
		for (const handler of this.adapter['anyOutgoingHandlers']) handler(event, data);
		// Отправляем сообщение клиенту
		queueMicrotask(() => server.publish(topic, payload));
	}

	/**
	 * Resets the current chain of operations by clearing internal flags and sets.
	 * This method is typically called after a chain of operations is completed to ensure
	 * that subsequent chains do not have stale state.
	 *
	 * @returns {this} Returns the instance of the class to allow method chaining.
	 */
	private _resetChain(): this {
		this.rooms.clear();
		this.exceptRooms.clear();
		this.flags.timeout = undefined;
		return this;
	}
}

/**
 * Expose of subset of the attributes and methods of the Socket class
 */
export class RemoteSocket<EmitEvents extends EventsMap, SocketData> implements TypedEventBroadcaster<EmitEvents> {
	public readonly id: SocketId;
	public readonly handshake: Handshake;
	public readonly rooms: Set<Room>;
	public readonly data: SocketData;

	private readonly operator: BroadcastOperator<EmitEvents, SocketData>;

	constructor(adapter: Adapter, details: SocketDetails<SocketData>) {
		this.id = details.id;
		this.handshake = details.handshake;
		this.rooms = new Set(details.rooms);
		this.data = details.data;
		this.operator = new BroadcastOperator<EmitEvents, SocketData>(adapter, new Set([this.id]), new Set(), {
			expectSingleResponse: true, // so that remoteSocket.emit() with acknowledgement behaves like socket.emit()
		});
	}

	/**
	 * Adds a timeout in milliseconds for the next operation.
	 *
	 * @example
	 * const sockets = await io.fetchSockets();
	 *
	 * for (const socket of sockets) {
	 *   if (someCondition) {
	 *     socket.timeout(1000).emit("some-event", (err) => {
	 *       if (err) {
	 *         // the client did not acknowledge the event in the given delay
	 *       }
	 *     });
	 *   }
	 * }
	 *
	 * // note: if possible, using a room instead of looping over all sockets is preferable
	 * io.timeout(1000).to(someConditionRoom).emit("some-event", (err, responses) => {
	 *   // ...
	 * });
	 *
	 * @param timeout
	 */
	public timeout(timeout: number): BroadcastOperator<DecorateAcknowledgements<EmitEvents>, SocketData> {
		return this.operator.timeout(timeout);
	}

	public emit<Ev extends EventNames<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		return this.operator.emit(ev, ...args);
	}

	/**
	 * Joins a room.
	 *
	 * @param {String|Array} room - room or array of rooms
	 */
	public join(room: Room | Room[]): void {
		return this.operator.socketsJoin(room);
	}

	/**
	 * Leaves a room.
	 *
	 * @param {String} room
	 */
	public leave(room: Room): void {
		return this.operator.socketsLeave(room);
	}

	/**
	 * Disconnects this client.
	 *
	 * @param {Boolean} close - if `true`, closes the underlying connection
	 * @return {Socket} self
	 */
	public disconnect(close = false): this {
		this.operator.disconnectSockets(close);
		return this;
	}
}
