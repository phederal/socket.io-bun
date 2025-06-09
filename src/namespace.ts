import debugModule from 'debug';
import { Socket } from './socket';
import { BroadcastOperator } from './broadcast';
import { Adapter, type SocketId, type Room } from './socket.io-adapter';
import { StrictEventEmitter } from '../types/typed-events';
import type { Server } from './';

import type { DefaultSocketData, Handshake } from '../types/socket-types';
import type {
	RemoveAcknowledgements,
	EventsMap,
	DefaultEventsMap,
	DecorateAcknowledgementsWithMultipleResponses,
	EventNamesWithoutAck,
	EventParams,
} from '../types/typed-events';
import type { Client } from './client';
import { debugConfig } from '../config';

const debug = debugModule('socket.io:namespace');
debug.enabled = debugConfig.namespace || false;

export interface ExtendedError extends Error {
	data?: any;
}

export interface NamespaceReservedEventsMap<
	/** strict typing */
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap,
	SocketData extends DefaultSocketData,
> {
	connect: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
	connection: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
}

export interface ServerReservedEventsMap<
	/** strict typing */
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap,
	SocketData extends DefaultSocketData,
> extends NamespaceReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
	new_namespace: (namespace: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
}

export const RESERVED_EVENTS: ReadonlySet<string | Symbol> = new Set<
	/** strict typing */
	keyof ServerReservedEventsMap<never, never, never, never>
>(<const>['connect', 'connection', 'new_namespace']);

/**
 * A Namespace is a communication channel that allows you to split the logic of your application over a single shared
 * connection.
 *
 * Each namespace has its own:
 *
 * - event handlers
 *
 * ```
 * io.of("/orders").on("connection", (socket) => {
 *   socket.on("order:list", () => {});
 *   socket.on("order:create", () => {});
 * });
 *
 * io.of("/users").on("connection", (socket) => {
 *   socket.on("user:list", () => {});
 * });
 * ```
 *
 * - rooms
 *
 * ```
 * const orderNamespace = io.of("/orders");
 *
 * orderNamespace.on("connection", (socket) => {
 *   socket.join("room1");
 *   orderNamespace.to("room1").emit("hello");
 * });
 *
 * const userNamespace = io.of("/users");
 *
 * userNamespace.on("connection", (socket) => {
 *   socket.join("room1"); // distinct from the room in the "orders" namespace
 *   userNamespace.to("room1").emit("holà");
 * });
 * ```
 *
 * - middlewares
 *
 * ```
 * const orderNamespace = io.of("/orders");
 *
 * orderNamespace.use((socket, next) => {
 *   // ensure the socket has access to the "orders" namespace
 * });
 *
 * const userNamespace = io.of("/users");
 *
 * userNamespace.use((socket, next) => {
 *   // ensure the socket has access to the "users" namespace
 * });
 * ```
 */
export class Namespace<
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData,
> extends StrictEventEmitter<
	/** strict typing */
	ServerSideEvents,
	RemoveAcknowledgements<EmitEvents>,
	NamespaceReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
> {
	public readonly name: string;
	/**
	 * A map of currently connected sockets.
	 */
	public readonly sockets: Map<SocketId, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();

	public adapter!: Adapter;

	/** @private */
	readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;

	private _fns: Array<(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, next: (err?: ExtendedError) => void) => void> = [];

	/** @private */
	_ids: number = 0;

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
		this._initAdapter();
	}

	/**
	 * Initializes the `Adapter` for this nsp.
	 * Run upon changing adapter by `Server#adapter`
	 * in addition to the constructor.
	 *
	 * @private
	 */
	_initAdapter(): void {
		let AdapterConstructor: any;
		if (typeof (this.server as any).adapter === 'function') {
			AdapterConstructor = (this.server as any).adapter();
		} else {
			AdapterConstructor = Adapter;
		}
		if (AdapterConstructor) this.adapter = new AdapterConstructor(this);
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
	use(
		fn: (
			/** strict types */
			socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
			next: (err?: ExtendedError) => void,
		) => void,
	): this {
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
	private run(
		/** strict types */
		socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		fn: (err?: ExtendedError) => void,
	) {
		if (!this._fns.length) return fn();
		const fns = this._fns.slice(0);
		(function run(i: number) {
			fns[i]!(socket, (err) => {
				// upon error, short-circuit
				if (err) return fn(err);
				// if no middleware left, summon callback
				if (!fns[i + 1]) return fn();
				// go on to next
				run(i + 1);
			});
		})(0);
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
	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
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
	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
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
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).except(room);
	}

	/**
	 * Adds a new client.
	 *
	 * @return {Socket}
	 * @private
	 */
	async _add(
		client: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		data: Record<string, unknown>,
		fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void,
	) {
		debug('adding socket to nsp %s', this.name);
		const socket = await this._createSocket(client, data);

		this.run(socket, (err) => {
			if (client.conn.readyState !== WebSocket.OPEN) {
				debug('next called after client was closed - ignoring socket');
				return socket['_cleanup']();
			}

			process.nextTick(() => {
				if (err) {
					debug('middleware error, sending CONNECT_ERROR packet to the client');
					socket['_cleanup']();
					return socket['_error']({
						message: err.message,
						data: err.data,
					});
				}

				this._doConnect(socket, fn);
			});
		});
	}

	private async _createSocket(client: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, data: Record<string, unknown>) {
		// TODO: add restoring session
		return new Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>(this, client, data);
	}

	private _doConnect(
		/** strict types */
		socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		fn: (
			/** strict types */
			socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		) => void,
	) {
		this.sockets.set(socket.id, socket);

		// it's paramount that the internal `onconnect` logic
		// fires before user-set events to prevent state order
		// violations (such as a disconnection before the connection
		// logic is complete)
		socket['_onconnect']();
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
		if (this.sockets.has(socket.id)) {
			this.sockets.delete(socket.id);
		}
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
	override emit<Ev extends EventNamesWithoutAck<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
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
	send(...args: EventParams<EmitEvents, 'message'>): this {
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
	write(...args: EventParams<EmitEvents, 'message'>): this {
		this.emit('message' as any, ...args);
		return this;
	}

	// TODO: add compitability with cluster
	private serverSideEmit() {}
	private serverSideEmitWithAck() {}
	private _onServerSideEmit() {}

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
	compress(compress: boolean) {
		return new BroadcastOperator<
			/** strict types */
			DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
			SocketData
		>(this.adapter).compress(compress);
	}

	get binary(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).binary;
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
	get volatile() {
		return new BroadcastOperator<
			/** strict types */
			DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
			SocketData
		>(this.adapter).volatile;
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
	get local() {
		return new BroadcastOperator<
			/** strict types */
			DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
			SocketData
		>(this.adapter).local;
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
	timeout(timeout: number) {
		return new BroadcastOperator<
			/** strict types */
			DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
			SocketData
		>(this.adapter).timeout(timeout);
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
	fetchSockets() {
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
	socketsJoin(room: Room | Room[]): void {
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
	socketsLeave(room: Room | Room[]): void {
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
	disconnectSockets(close: boolean = false): void {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).disconnectSockets(close);
	}
}
