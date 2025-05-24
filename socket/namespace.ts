import { Socket } from './socket';
import { BroadcastOperator, type BroadcastOptions } from './broadcast';
import type { EventCallback, Middleware, RoomsMap, Room, Server } from './server';
import type { ServerToClientEvents, ClientToServerEvents, AckMap, AckCallback } from 'shared/types/socket.types';
import {
	StrictEventEmitter,
	type AllButLast,
	type DecorateAcknowledgementsWithMultipleResponses,
	type DecorateAcknowledgementsWithTimeoutAndMultipleResponses,
	type DefaultEventsMap,
	type EventNames,
	type EventNamesWithAck,
	type EventNamesWithoutAck,
	type EventParams,
	type EventsMap,
	type FirstNonErrorArg,
	type Last,
	type RemoveAcknowledgements,
	type SocketId,
} from './types';
import { Packet } from './parser';
import type { Client } from './client';

export interface ExtendedError extends Error {
	data?: any;
}

export interface NamespaceReservedEventsMap<ListenEvents extends EventsMap, EmitEvents extends EventsMap, ServerSideEvents extends EventsMap, SocketData> {
	connect: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
	connection: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
}

export interface ServerReservedEventsMap<ListenEvents extends EventsMap, EmitEvents extends EventsMap, ServerSideEvents extends EventsMap, SocketData>
	extends NamespaceReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
	new_namespace: (namespace: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
}

export const RESERVED_EVENTS: ReadonlySet<string | Symbol> = new Set<keyof ServerReservedEventsMap<never, never, never, never>>(<const>['connect', 'connection', 'new_namespace']);

export class Namespace<
	// Types for the events received from the clients.
	ListenEvents extends EventsMap = DefaultEventsMap,
	// Types for the events sent to the clients.
	EmitEvents extends EventsMap = ListenEvents,
	// Reserved events that can be emitted by socket.io
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData = any,
> extends StrictEventEmitter<
	// Types for the events received
	ServerSideEvents,
	// Types for the events sent
	RemoveAcknowledgements<EmitEvents>,
	// Reserved events
	NamespaceReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
> {
	public readonly name: string;
	/** A map of currently connected sockets. */
	public readonly sockets: Map<SocketId, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	public readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;

	public adapter: Adapter;

	private _fns: Array<(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, next: (err?: ExtendedError) => void) => void> = [];

	_ids: number = 0;

	// Storages (maps)
	public rooms: RoomsMap = new Map();
	private ackCallbacks: AckMap = new Map();

	/**
	 * Namespace constructor.
	 *
	 * @param server instance
	 * @param name
	 */
	constructor(server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, name: string) {
		super();
		this.server = server;
		this.name = name;
	}

	/**
	 * Registers a middleware, which is a function that gets executed for every incoming {@link Socket}.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.use((socket, next) => {
	 *   // ...
	 *   next();
	 * });
	 *
	 * @param fn - the middleware function
	 */
	public use(fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, next: (err?: ExtendedError) => void) => void): this {
		this._fns.push(fn);
		return this;
	}

	/**
	 * Executes the middleware for an incoming client.
	 *
	 * @param socket - the socket that will get added
	 * @param fn - last fn call in the middleware
	 * @private
	 */
	private run(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, fn: (err?: ExtendedError) => void) {
		if (!this._fns.length) return fn();
		const fns = this._fns.slice(0);
		function run(i: number) {
			fns[i](socket, (err) => {
				// upon error, short-circuit
				if (err) return fn(err);
				// if no middleware left, summon callback
				if (!fns[i + 1]) return fn();
				// go on to next
				run(i + 1);
			});
		}
		run(0);
	}

	/**
	 * Targets a room when emitting.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // the “foo” event will be broadcast to all connected clients in the “room-101” room
	 * myNamespace.to("room-101").emit("foo", "bar");
	 *
	 * // with an array of rooms (a client will be notified at most once)
	 * myNamespace.to(["room-101", "room-102"]).emit("foo", "bar");
	 *
	 * // with multiple chained calls
	 * myNamespace.to("room-101").to("room-102").emit("foo", "bar");
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public to(room: Room | Room[]) {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).to(room);
	}

	/**
	 * Targets a room when emitting. Similar to `to()`, but might feel clearer in some cases:
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // disconnect all clients in the "room-101" room
	 * myNamespace.in("room-101").disconnectSockets();
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public in(room: Room | Room[]) {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).in(room);
	}

	/**
	 * Excludes a room when emitting.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // the "foo" event will be broadcast to all connected clients, except the ones that are in the "room-101" room
	 * myNamespace.except("room-101").emit("foo", "bar");
	 *
	 * // with an array of rooms
	 * myNamespace.except(["room-101", "room-102"]).emit("foo", "bar");
	 *
	 * // with multiple chained calls
	 * myNamespace.except("room-101").except("room-102").emit("foo", "bar");
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public except(room: Room | Room[]) {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).except(room);
	}

	/**
	 * Adds a new client.
	 *
	 * @return {Socket}
	 * @private
	 */
	async _add(client: Client<ListenEvents, EmitEvents, ServerSideEvents>, fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void) {
		// _debug('adding socket to nsp %s', this.name);
		const socket = await this._createSocket(client);
		this._preConnectSockets.set(socket.id, socket);
		if (
			// @ts-ignore
			this.server.opts.connectionStateRecovery?.skipMiddlewares &&
			socket.recovered &&
			client.conn.readyState === 'open'
		) {
			return this._doConnect(socket, fn);
		}
		this.run(socket, (err) => {
			process.nextTick(() => {
				if ('open' !== client.conn.readyState) {
					// _debug('next called after client was closed - ignoring socket');
					socket._cleanup();
					return;
				}
				if (err) {
					// _debug('middleware error, sending CONNECT_ERROR packet to the client');
					socket._cleanup();
					if (client.conn.protocol === 3) {
						return socket._error(err.data || err.message);
					} else {
						return socket._error({
							message: err.message,
							data: err.data,
						});
					}
				}
				this._doConnect(socket, fn);
			});
		});
	}

	private async _createSocket(client: Client<ListenEvents, EmitEvents, ServerSideEvents>) {
		return new Socket(client, this);
	}

	private _doConnect(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void) {
		// this._preConnectSockets.delete(socket.id);
		this.sockets.set(socket.id, socket);

		// it's paramount that the internal `onconnect` logic
		// fires before user-set events to prevent state order
		// violations (such as a disconnection before the connection
		// logic is complete)
		socket._onconnect();
		if (fn) fn(socket);

		// fire user-set events
		this.emitReserved('connect', socket);
		this.emitReserved('connection', socket);
	}

	/**
	 * Removes a client. Called by each `Socket`.
	 *
	 * @private
	 */
	_remove(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
		// this.sockets.delete(socket.id) || this._preConnectSockets.delete(socket.id);
		this.sockets.delete(socket.id);
	}

	/**
	 * Emits to all connected clients.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.emit("hello", "world");
	 *
	 * // all serializable datastructures are supported (no need to call JSON.stringify)
	 * myNamespace.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
	 *
	 * // with an acknowledgement from the clients
	 * myNamespace.timeout(1000).emit("some-event", (err, responses) => {
	 *   if (err) {
	 *     // some clients did not acknowledge the event in the given delay
	 *   } else {
	 *     console.log(responses); // one response per client
	 *   }
	 * });
	 *
	 * @return Always true
	 */
	public emit<Ev extends EventNamesWithoutAck<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(ev, ...args);
	}

	/**
	 * Sends a `message` event to all clients.
	 *
	 * This method mimics the WebSocket.send() method.
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.send("hello");
	 *
	 * // this is equivalent to
	 * myNamespace.emit("message", "hello");
	 *
	 * @return self
	 */
	public send(...args: EventParams<EmitEvents, 'message'>): this {
		// This type-cast is needed because EmitEvents likely doesn't have `message` as a key.
		// if you specify the EmitEvents, the type of args will be never.
		this.emit('message' as any, ...args);
		return this;
	}

	/**
	 * Sends a `message` event to all clients. Sends a `message` event. Alias of {@link send}.
	 *
	 * @return self
	 */
	public write(...args: EventParams<EmitEvents, 'message'>): this {
		// This type-cast is needed because EmitEvents likely doesn't have `message` as a key.
		// if you specify the EmitEvents, the type of args will be never.
		this.emit('message' as any, ...args);
		return this;
	}

	/**
	 * Sends a message to the other Socket.IO servers of the cluster.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.serverSideEmit("hello", "world");
	 *
	 * myNamespace.on("hello", (arg1) => {
	 *   console.log(arg1); // prints "world"
	 * });
	 *
	 * // acknowledgements (without binary content) are supported too:
	 * myNamespace.serverSideEmit("ping", (err, responses) => {
	 *  if (err) {
	 *     // some servers did not acknowledge the event in the given delay
	 *   } else {
	 *     console.log(responses); // one response per server (except the current one)
	 *   }
	 * });
	 *
	 * myNamespace.on("ping", (cb) => {
	 *   cb("pong");
	 * });
	 *
	 * @param ev - the event name
	 * @param args - an array of arguments, which may include an acknowledgement callback at the end
	 */
	public serverSideEmit<Ev extends EventNames<ServerSideEvents>>(ev: Ev, ...args: EventParams<DecorateAcknowledgementsWithTimeoutAndMultipleResponses<ServerSideEvents>, Ev>): boolean {
		if (RESERVED_EVENTS.has(ev)) {
			throw new Error(`"${String(ev)}" is a reserved event name`);
		}
		args.unshift(ev);
		// this.adapter.serverSideEmit(args);
		return true;
	}

	/**
	 * Sends a message and expect an acknowledgement from the other Socket.IO servers of the cluster.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * try {
	 *   const responses = await myNamespace.serverSideEmitWithAck("ping");
	 *   console.log(responses); // one response per server (except the current one)
	 * } catch (e) {
	 *   // some servers did not acknowledge the event in the given delay
	 * }
	 *
	 * @param ev - the event name
	 * @param args - an array of arguments
	 *
	 * @return a Promise that will be fulfilled when all servers have acknowledged the event
	 */
	public serverSideEmitWithAck<Ev extends EventNamesWithAck<ServerSideEvents>>(ev: Ev, ...args: AllButLast<EventParams<ServerSideEvents, Ev>>): Promise<FirstNonErrorArg<Last<EventParams<ServerSideEvents, Ev>>>[]> {
		return new Promise((resolve, reject) => {
			args.push((err, responses) => {
				if (err) {
					err.responses = responses;
					return reject(err);
				} else {
					return resolve(responses);
				}
			});
			// this.serverSideEmit(ev, ...(args as any[] as EventParams<ServerSideEvents, Ev>));
		});
	}

	/**
	 * Called when a packet is received from another Socket.IO server
	 *
	 * @param args - an array of arguments, which may include an acknowledgement callback at the end
	 *
	 * @private
	 */
	_onServerSideEmit(args: [string, ...any[]]) {
		super.emitUntyped.apply(this, args);
	}

	/**
	 * Sets the compress flag.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.compress(false).emit("hello");
	 *
	 * @param compress - if `true`, compresses the sending data
	 * @return self
	 */
	public compress(compress: boolean) {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).compress(compress);
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
	 * receive messages (because of network slowness or other issues, or because they’re connected through long polling
	 * and is in the middle of a request-response cycle).
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.volatile.emit("hello"); // the clients may or may not receive it
	 *
	 * @return self
	 */
	public get volatile() {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).volatile;
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // the “foo” event will be broadcast to all connected clients on this node
	 * myNamespace.local.emit("foo", "bar");
	 *
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public get local() {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).local;
	}

	/**
	 * Adds a timeout in milliseconds for the next operation.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * myNamespace.timeout(1000).emit("some-event", (err, responses) => {
	 *   if (err) {
	 *     // some clients did not acknowledge the event in the given delay
	 *   } else {
	 *     console.log(responses); // one response per client
	 *   }
	 * });
	 *
	 * @param timeout
	 */
	public timeout(timeout: number) {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).timeout(timeout);
	}

	/**
	 * Returns the matching socket instances.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // return all Socket instances
	 * const sockets = await myNamespace.fetchSockets();
	 *
	 * // return all Socket instances in the "room1" room
	 * const sockets = await myNamespace.in("room1").fetchSockets();
	 *
	 * for (const socket of sockets) {
	 *   console.log(socket.id);
	 *   console.log(socket.handshake);
	 *   console.log(socket.rooms);
	 *   console.log(socket.data);
	 *
	 *   socket.emit("hello");
	 *   socket.join("room1");
	 *   socket.leave("room2");
	 *   socket.disconnect();
	 * }
	 */
	public fetchSockets() {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).fetchSockets();
	}

	/**
	 * Makes the matching socket instances join the specified rooms.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // make all socket instances join the "room1" room
	 * myNamespace.socketsJoin("room1");
	 *
	 * // make all socket instances in the "room1" room join the "room2" and "room3" rooms
	 * myNamespace.in("room1").socketsJoin(["room2", "room3"]);
	 *
	 * @param room - a room, or an array of rooms
	 */
	public socketsJoin(room: Room | Room[]) {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsJoin(room);
	}

	/**
	 * Makes the matching socket instances leave the specified rooms.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // make all socket instances leave the "room1" room
	 * myNamespace.socketsLeave("room1");
	 *
	 * // make all socket instances in the "room1" room leave the "room2" and "room3" rooms
	 * myNamespace.in("room1").socketsLeave(["room2", "room3"]);
	 *
	 * @param room - a room, or an array of rooms
	 */
	public socketsLeave(room: Room | Room[]) {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsLeave(room);
	}

	/**
	 * Makes the matching socket instances disconnect.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // make all socket instances disconnect (the connections might be kept alive for other namespaces)
	 * myNamespace.disconnectSockets();
	 *
	 * // make all socket instances in the "room1" room disconnect and close the underlying connections
	 * myNamespace.in("room1").disconnectSockets(true);
	 *
	 * @param close - whether to close the underlying connection
	 */
	public disconnectSockets(close: boolean = false) {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).disconnectSockets(close);
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
