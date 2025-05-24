import { Namespace, type ExtendedError, type ServerReservedEventsMap } from './namespace';
import { Socket } from './socket';
import type { ClientToServerEvents } from 'shared/types/socket.types';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Client } from './client';
import { DEFAULT_NAMESPACE, PING_INTERVAL } from './globals';
import { StrictEventEmitter, type DefaultEventsMap, type EventParams, type EventsMap, type RemoveAcknowledgements } from './types';
import { ParentNamespace, type ParentNspNameMatchFn } from './parent-namespace';
import { EventEmitter } from 'events';
import type { Encoder } from './parser';
import type { RemoteSocket } from './broadcast';

export interface WS extends ServerWebSocket<WSContext> {}

export type Hook = (client: Socket) => void;
export type MessageHook = <T extends keyof ClientToServerEvents>(client: Socket, event: T, data: ClientToServerEvents[T]) => void;
export type ErrorHook = (client: Socket, err: Error) => void;
export type Middleware = <T extends keyof ClientToServerEvents>(client: Socket, event: T, data: ClientToServerEvents[T]) => boolean | Promise<boolean>;
export type NewNamespaceHook = (namespace: Namespace) => void;

// export type SocketsMap = Map<Socket['id'], Set<Socket>>; // userId => Set<ws> (multi-tabs/multi-sessions)
export type RoomsMap = Map<string, Set<Socket>>; // roomId => Set<ws>
export type Room = string;

export type EventCallback<E extends keyof ClientToServerEvents> = (client: Socket, data: ClientToServerEvents[E]) => void;

export class Server<
	// Types for the events received from the clients.
	ListenEvents extends EventsMap = DefaultEventsMap,
	// Types for the events sent to the clients.
	EmitEvents extends EventsMap = ListenEvents,
	// Types for the events received from the server.
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	// Additional properties that can be attached to the socket instance
	SocketData = any,
> extends StrictEventEmitter<
	// Types for the events received
	ServerSideEvents,
	// Types for the events sent
	RemoveAcknowledgements<EmitEvents>,
	// Reserved events for service
	ServerReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
> {
	/**
	 * the adapter to use
	 * @default the in-memory adapter (https://github.com/socketio/socket.io-adapter)
	 */
	adapter: AdapterConstructor;
	/**
	 * the parser to use
	 * @default the default parser (https://github.com/socketio/socket.io-parser)
	 */
	parser: any;
	readonly encoder: Encoder;
	readonly bun: any;

	public sockets: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	public namespaces: Map<string, Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	public parentNamespaces: Map<ParentNspNameMatchFn, ParentNamespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	/**
	 * A subset of the {@link parentNsps} map, only containing {@link ParentNamespace} which are based on a regular
	 * expression.
	 */
	private parentNamespacesFromRegExp: Map<RegExp, ParentNamespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();

	private connections: Set<Client> = new Set();

	private heartbeatRunner: any = null;
	private heartbeatInterval = PING_INTERVAL;

	constructor() {
		super();
		this.sockets = this.of(DEFAULT_NAMESPACE);
		this.namespaces.set(DEFAULT_NAMESPACE, this.sockets);
	}

	// 1. Перегрузки:
	on(event: 'connect' | 'connection', cb: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void): this;
	on(event: 'disconnect', cb: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void): this;
	on(event: 'message', cb: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void): this;
	on(event: 'error', cb: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void): this;
	on(event: 'new_namespace', cb: (namespace: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void): this;
	on<E extends keyof ClientToServerEvents>(event: E, cb: EventCallback<E>): this;
	// 2. Имплементация:
	on(event: string, cb: any): this {
		switch (event) {
			case 'connect':
			case 'connection':
				this.sockets.on('connect', cb);
				break;
			case 'disconnect':
				this.sockets.on('disconnect', cb);
				break;
			case 'message':
				this.sockets.on('message', cb);
				break;
			case 'error':
				this.sockets.on('error', cb);
				break;
			default:
				this.sockets.on(event as keyof ClientToServerEvents, cb);
		}
		return this;
	}

	/**
	 * Get namespace or create if not exists
	 * @param name namespace name
	 * @returns {Namespace} namespace object
	 */
	public of(name: string | RegExp | ParentNspNameMatchFn, fn?: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		if (typeof name === 'function' || name instanceof RegExp) {
			const parentNsp = new ParentNamespace(this);
			// _debug('initializing parent namespace %s', parentNsp.name);
			if (typeof name === 'function') {
				this.parentNamespaces.set(name, parentNsp);
			} else {
				this.parentNamespaces.set((nsp, conn, next) => next(null, (name as RegExp).test(nsp)), parentNsp);
				this.parentNamespacesFromRegExp.set(name, parentNsp);
			}
			// @ts-ignore
			if (fn) parentNsp.on('connect', fn);
			return parentNsp;
		}

		let nsp = this.namespaces.get(name);

		if (!nsp) {
			for (const [regex, parentNamespace] of this.parentNamespacesFromRegExp) {
				if (regex.test(name as string)) {
					//   _debug("attaching namespace %s to parent namespace %s", name, regex);
					return parentNamespace.createChild(name as string);
				}
			}

			// _debug('initializing namespace %s', name);
			nsp = new Namespace(this, name);
			this.namespaces.set(name, nsp);
			// @ts-ignore
			if (name !== '/') this.sockets.emitReserved('new_namespace', nsp);
		}
		if (fn) nsp.on('connect', fn);
		return nsp;

		// if (name === DEFAULT_NAMESPACE || name === '' || name === undefined) return this.sockets;
		// if (String(name)[0] !== '/') name = '/' + name;
		// if (!this.namespaces.has(name)) {
		// 	const namespace = new Namespace(this, name, new Map(), new Map(), this.hooks, this.middlewares);
		// 	this.namespaces.set(name, namespace);
		// 	for (const hook of this.newNamespaceHooks) hook(namespace);
		// }
		// return this.namespaces.get(name)!;
	}

	/**
	 * Registers a middleware, which is a function that gets executed for every incoming {@link Socket}.
	 *
	 * @example
	 * io.use((socket, next) => {
	 *   // ...
	 *   next();
	 * });
	 *
	 * @param fn - the middleware function
	 */
	public use(fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, next: (err?: ExtendedError) => void) => void): this {
		this.sockets.use(fn);
		return this;
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
	public to(room: Room | Room[]) {
		return this.sockets.to(room);
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
	public in(room: Room | Room[]) {
		return this.sockets.in(room);
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
	public except(room: Room | Room[]) {
		return this.sockets.except(room);
	}

	/**
	 * Sends a `message` event to all clients.
	 *
	 * This method mimics the WebSocket.send() method.
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
	 *
	 * @example
	 * io.send("hello");
	 *
	 * // this is equivalent to
	 * io.emit("message", "hello");
	 *
	 * @return self
	 */
	public send(...args: EventParams<EmitEvents, 'message'>): this {
		// This type-cast is needed because EmitEvents likely doesn't have `message` as a key.
		// if you specify the EmitEvents, the type of args will be never.
		this.sockets.emit('message' as any, ...args);
		return this;
	}

	/**
	 * Sends a `message` event to all clients. Alias of {@link send}.
	 *
	 * @return self
	 */
	public write(...args: EventParams<EmitEvents, 'message'>): this {
		// This type-cast is needed because EmitEvents likely doesn't have `message` as a key.
		// if you specify the EmitEvents, the type of args will be never.
		this.sockets.emit('message' as any, ...args);
		return this;
	}

	// /**
	//  * Sends a message to the other Socket.IO servers of the cluster.
	//  *
	//  * @example
	//  * io.serverSideEmit("hello", "world");
	//  *
	//  * io.on("hello", (arg1) => {
	//  *   console.log(arg1); // prints "world"
	//  * });
	//  *
	//  * // acknowledgements (without binary content) are supported too:
	//  * io.serverSideEmit("ping", (err, responses) => {
	//  *  if (err) {
	//  *     // some servers did not acknowledge the event in the given delay
	//  *   } else {
	//  *     console.log(responses); // one response per server (except the current one)
	//  *   }
	//  * });
	//  *
	//  * io.on("ping", (cb) => {
	//  *   cb("pong");
	//  * });
	//  *
	//  * @param ev - the event name
	//  * @param args - an array of arguments, which may include an acknowledgement callback at the end
	//  */
	// public serverSideEmit<Ev extends EventNames<ServerSideEvents>>(ev: Ev, ...args: EventParams<DecorateAcknowledgementsWithTimeoutAndMultipleResponses<ServerSideEvents>, Ev>): boolean {
	// 	return this.sockets.serverSideEmit(ev, ...args);
	// }

	// /**
	//  * Sends a message and expect an acknowledgement from the other Socket.IO servers of the cluster.
	//  *
	//  * @example
	//  * try {
	//  *   const responses = await io.serverSideEmitWithAck("ping");
	//  *   console.log(responses); // one response per server (except the current one)
	//  * } catch (e) {
	//  *   // some servers did not acknowledge the event in the given delay
	//  * }
	//  *
	//  * @param ev - the event name
	//  * @param args - an array of arguments
	//  *
	//  * @return a Promise that will be fulfilled when all servers have acknowledged the event
	//  */
	// public serverSideEmitWithAck<Ev extends EventNamesWithAck<ServerSideEvents>>(ev: Ev, ...args: AllButLast<EventParams<ServerSideEvents, Ev>>): Promise<FirstNonErrorArg<Last<EventParams<ServerSideEvents, Ev>>>[]> {
	// 	return this.sockets.serverSideEmitWithAck(ev, ...args);
	// }

	/**
	 * Sets the compress flag.
	 *
	 * @example
	 * io.compress(false).emit("hello");
	 *
	 * @param compress - if `true`, compresses the sending data
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public compress(compress: boolean) {
		return this.sockets.compress(compress);
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
	 * receive messages (because of network slowness or other issues, or because they’re connected through long polling
	 * and is in the middle of a request-response cycle).
	 *
	 * @example
	 * io.volatile.emit("hello"); // the clients may or may not receive it
	 *
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public get volatile() {
		return this.sockets.volatile;
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
	 *
	 * @example
	 * // the “foo” event will be broadcast to all connected clients on this node
	 * io.local.emit("foo", "bar");
	 *
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	public get local() {
		return this.sockets.local;
	}

	/**
	 * Adds a timeout in milliseconds for the next operation.
	 *
	 * @example
	 * io.timeout(1000).emit("some-event", (err, responses) => {
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
		return this.sockets.timeout(timeout);
	}

	/**
	 * Returns the matching socket instances.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * // return all Socket instances
	 * const sockets = await io.fetchSockets();
	 *
	 * // return all Socket instances in the "room1" room
	 * const sockets = await io.in("room1").fetchSockets();
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
	public fetchSockets(): Promise<RemoteSocket<EmitEvents, SocketData>[]> {
		return this.sockets.fetchSockets();
	}

	/**
	 * Makes the matching socket instances join the specified rooms.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 *
	 * // make all socket instances join the "room1" room
	 * io.socketsJoin("room1");
	 *
	 * // make all socket instances in the "room1" room join the "room2" and "room3" rooms
	 * io.in("room1").socketsJoin(["room2", "room3"]);
	 *
	 * @param room - a room, or an array of rooms
	 */
	public socketsJoin(room: Room | Room[]) {
		return this.sockets.socketsJoin(room);
	}

	/**
	 * Makes the matching socket instances leave the specified rooms.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * // make all socket instances leave the "room1" room
	 * io.socketsLeave("room1");
	 *
	 * // make all socket instances in the "room1" room leave the "room2" and "room3" rooms
	 * io.in("room1").socketsLeave(["room2", "room3"]);
	 *
	 * @param room - a room, or an array of rooms
	 */
	public socketsLeave(room: Room | Room[]) {
		return this.sockets.socketsLeave(room);
	}

	/**
	 * Makes the matching socket instances disconnect.
	 *
	 * Note: this method also works within a cluster of multiple Socket.IO servers, with a compatible {@link Adapter}.
	 *
	 * @example
	 * // make all socket instances disconnect (the connections might be kept alive for other namespaces)
	 * io.disconnectSockets();
	 *
	 * // make all socket instances in the "room1" room disconnect and close the underlying connections
	 * io.in("room1").disconnectSockets(true);
	 *
	 * @param close - whether to close the underlying connection
	 */
	public disconnectSockets(close: boolean = false) {
		return this.sockets.disconnectSockets(close);
	}
}

/**
 * Expose main namespace (/).
 */

const emitterMethods = Object.keys(EventEmitter.prototype).filter((key) => {
	return typeof (EventEmitter.prototype as any)[key] === 'function';
});

emitterMethods.forEach((fn) => {
	(Server.prototype as any)[fn] = function (...args: any[]) {
		return (this.sockets as any)[fn](...args);
	};
});

// module.exports = () => new Server();
// module.exports.Server = Server;
// module.exports.Namespace = Namespace;
// module.exports.Socket = Socket;

export const io = new Server();

export function Sockets(nsp?: string): Namespace {
	if (nsp) return io.of(nsp);
	return io.sockets;
}
