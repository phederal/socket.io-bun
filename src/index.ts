import debugModule from 'debug';
import base64id from 'base64id';
import EventEmitter from 'events';
import { Namespace, type ExtendedError, type ServerReservedEventsMap } from './namespace';
import { BroadcastOperator } from './broadcast';
import { Adapter, SessionAwareAdapter, type Room } from './socket.io-adapter';
import type { Server as BunServer, ServerWebSocket } from 'bun';
import type { RESERVED_EVENTS, DisconnectReason } from '../types/socket-types';
import {
	StrictEventEmitter,
	type EventsMap,
	type DefaultEventsMap,
	type EventParams,
	type EventNames,
	type DecorateAcknowledgementsWithTimeoutAndMultipleResponses,
	type AllButLast,
	type Last,
	type RemoveAcknowledgements,
	type EventNamesWithAck,
	type FirstNonErrorArg,
} from '#types/typed-events';
import { Socket } from './socket';
import type { Context } from 'hono';
import { Client } from './client';
import * as parser from './socket.io-parser';
import type { Encoder } from './socket.io-parser';
import { debugConfig } from '../config';
import { ParentNamespace } from './parent-namespace';
import { Server as Engine, Socket as RawSocket } from './engine.io';
import type { WSContext, WSEvents } from 'hono/ws';

const debug = debugModule('socket.io:server');
debug.enabled = debugConfig.server;

type ParentNspNameMatchFn = (
	/** strict types */
	name: string,
	auth: { [key: string]: any },
	fn: (err: Error | null, success: boolean) => void,
) => void;

type AdapterConstructor = typeof Adapter | ((nsp: Namespace<any, any, any, any>) => Adapter);

export interface ServerOptions {
	/**
	 * name of the path to capture
	 * @default "/ws"
	 */
	path: string;
	/**
	 * the adapter to use
	 * @default the in-memory adapter (@/adapter)
	 */
	adapter: AdapterConstructor;
	/**
	 * the parser to use
	 * @default the default parser (@/socket.io-parser)
	 */
	parser: typeof parser; // not any type
	/**
	 * how many ms before a client without namespace is closed
	 * @default 45000
	 */
	connectTimeout: number;
	/**
	 * Whether to enable the recovery of connection state when a client temporarily disconnects.
	 *
	 * The connection state includes the missed packets, the rooms the socket was in and the `data` attribute.
	 */
	connectionStateRecovery: {
		/**
		 * The backup duration of the sessions and the packets.
		 *
		 * @default 120000 (2 minutes)
		 */
		maxDisconnectionDuration?: number;
		/**
		 * Whether to skip middlewares upon successful connection state recovery.
		 *
		 * @default true
		 */
		skipMiddlewares?: boolean;
	};
	/**
	 * Whether to remove child namespaces that have no sockets connected to them
	 * @default false
	 */
	cleanupEmptyChildNamespaces: boolean;

	pingTimeout: number;
	pingInterval: number;
	transports: 'websocket';
	perMessageDeflate: boolean;
	maxPayload: number;
}

/**
 * Represents a Socket.IO server.
 *
 * @example
 * import { Server } from "socket.io";
 *
 * const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>();
 *
 * io.on("connection", (socket) => {
 *   console.log(`socket ${socket.id} connected`);
 *
 *   // send an event to the client
 *   socket.emit("foo", "bar");
 *
 *   socket.on("foobar", () => {
 *     // an event was received from the client
 *   });
 *
 *   // upon disconnection
 *   socket.on("disconnect", (reason) => {
 *     console.log(`socket ${socket.id} disconnected due to ${reason}`);
 *   });
 * });
 *
 * io.listen(3000);
 */
class Server<
	/**
	 * Types for the events received from the clients.
	 *
	 * @example
	 * interface ClientToServerEvents {
	 *   hello: (arg: string) => void;
	 * }
	 *
	 * const io = new Server<ClientToServerEvents>();
	 *
	 * io.on("connection", (socket) => {
	 *   socket.on("hello", (arg) => {
	 *     // `arg` is inferred as string
	 *   });
	 * });
	 */
	ListenEvents extends EventsMap = DefaultEventsMap,
	/**
	 * Types for the events sent to the clients.
	 *
	 * @example
	 * interface ServerToClientEvents {
	 *   hello: (arg: string) => void;
	 * }
	 *
	 * const io = new Server<DefaultEventMap, ServerToClientEvents>();
	 *
	 * io.emit("hello", "world");
	 */
	EmitEvents extends EventsMap = ListenEvents,
	/**
	 * Types for the events received from and sent to the other servers.
	 *
	 * @example
	 * interface InterServerEvents {
	 *   ping: (arg: number) => void;
	 * }
	 *
	 * const io = new Server<DefaultEventMap, DefaultEventMap, ServerToClientEvents>();
	 *
	 * io.serverSideEmit("ping", 123);
	 *
	 * io.on("ping", (arg) => {
	 *   // `arg` is inferred as number
	 * });
	 */
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	/**
	 * Additional properties that can be attached to the socket instance.
	 *
	 * Note: any property can be attached directly to the socket instance (`socket.foo = "bar"`), but the `data` object
	 * will be included when calling {@link Server#fetchSockets}.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.data.eventsCount = 0;
	 *
	 *   socket.onAny(() => {
	 *     socket.data.eventsCount++;
	 *   });
	 * });
	 */
	SocketData = any,
> extends StrictEventEmitter<
	/** strict typing */
	ServerSideEvents,
	RemoveAcknowledgements<EmitEvents>,
	ServerReservedEventsMap<
		/** strict typing */
		ListenEvents,
		EmitEvents,
		ServerSideEvents,
		SocketData
	>
> {
	public readonly sockets: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;

	/**
	 * A reference to the underlying Engine.IO server.
	 *
	 * @example
	 * const clientsCount = io.engine.clientsCount;
	 *
	 */
	engine!: Engine;
	bun!: BunServer;

	/** @private */
	readonly _parser: typeof parser;
	/** @private */
	readonly encoder: Encoder;

	/** @private */
	readonly _nsps: Map<string, Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	private parentNsps: Map<ParentNspNameMatchFn, ParentNamespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	/**
	 * A subset of the {@link parentNsps} map, only containing {@link ParentNamespace} which are based on a regular
	 * expression.
	 *
	 * @private
	 */
	private parentNamespacesFromRegExp: Map<RegExp, ParentNamespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();

	readonly _clients: Map<string, Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();

	private _adapter?: AdapterConstructor;
	private readonly opts: Partial<ServerOptions>;
	private _path?: string;

	/** @private */
	_connectTimeout!: number;

	/**
	 * Server constructor.
	 *
	 * @param [opts]
	 */
	constructor(
		opts: Partial<ServerOptions> = {
			connectionStateRecovery: {
				maxDisconnectionDuration: 2 * 60 * 1000,
				skipMiddlewares: true,
			},
		},
	) {
		super();
		this.path(opts.path || '/ws');
		this.connectTimeout(opts.connectTimeout || 45000);
		this._parser = opts.parser || parser;
		this.encoder = new this._parser.Encoder();
		this.opts = opts;
		if (opts.connectionStateRecovery) {
			opts.connectionStateRecovery = Object.assign(
				{
					maxDisconnectionDuration: 2 * 60 * 1000,
					skipMiddlewares: true,
				},
				opts.connectionStateRecovery,
			);
			this.adapter(opts.adapter || SessionAwareAdapter);
		} else {
			this.adapter(opts.adapter || Adapter);
		}
		opts.cleanupEmptyChildNamespaces = !!opts.cleanupEmptyChildNamespaces;
		this.sockets = this.of('/');
	}

	get _opts() {
		return this.opts;
	}

	/**
	 * Executes the middleware for an incoming namespace not already created on the server.
	 *
	 * @param name - name of incoming namespace
	 * @param auth - the auth parameters
	 * @param fn - callback
	 *
	 * @private
	 */
	_checkNamespace(
		name: string,
		auth: { [key: string]: any },
		fn: (nsp: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> | false) => void,
	): void {
		if (this.parentNsps.size === 0) return fn(false);
		const keysIterator = this.parentNsps.keys();
		const run = () => {
			const nextFn = keysIterator.next();
			if (nextFn.done) {
				return fn(false);
			}
			nextFn.value(name, auth, (err, allow) => {
				if (err || !allow) {
					return run();
				}
				if (this._nsps.has(name)) {
					// the namespace was created in the meantime
					debug('dynamic namespace %s already exists', name);
					return fn(this._nsps.get(name) as Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>);
				}
				const namespace = this.parentNsps.get(nextFn.value)!.createChild(name);
				debug('dynamic namespace %s was created', name);
				fn(namespace);
			});
		};

		run();
	}

	/**
	 * Sets the client serving path.
	 *
	 * @param {String} v pathname
	 * @return {Server|String} self when setting or value when getting
	 */
	path(v: string): this;
	path(): string;
	path(v?: string): this | string;
	path(v?: string): this | string {
		if (!arguments.length) return this._path!;
		this._path = v!.replace(/\/$/, '');
		// const escapedPath = this._path.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
		// Not using in this package (for now)
		return this;
	}

	/**
	 * Set the delay after which a client without namespace is closed
	 * @param v
	 */
	connectTimeout(v: number): this;
	connectTimeout(): number;
	connectTimeout(v?: number): this | number;
	connectTimeout(v?: number): this | number {
		if (v === undefined) return this._connectTimeout;
		this._connectTimeout = v;
		return this;
	}

	/**
	 * Sets the adapter for rooms.
	 *
	 * @param v pathname
	 * @return self when setting or value when getting
	 */
	adapter(): AdapterConstructor | undefined;
	adapter(v: AdapterConstructor): this;
	adapter(v?: AdapterConstructor): AdapterConstructor | undefined | this {
		if (!arguments.length) return this._adapter;
		this._adapter = v;
		for (const nsp of this._nsps.values()) {
			nsp._initAdapter();
		}
		return this;
	}

	/**
	 * Attaches socket.io to a bun server.
	 *
	 * @param srv - server instance
	 * @param opts - options passed to engine.io
	 * @return self
	 */
	listen(srv: BunServer, opts: Partial<ServerOptions> = {}): void {
		this.attach(srv, opts);
	}

	/**
	 * Attaches socket.io to a bun server.
	 * Initialize engine server.
	 *
	 * @param srv - server instance
	 * @param opts - options passed to engine.io
	 * @return self
	 */
	attach(srv: BunServer, opts: Partial<ServerOptions> = {}): void {
		Object.assign(opts, this.opts);
		// set engine.io path to `/socket.io`
		opts.path = opts.path || this._path;
		this.bun = srv;
		this.initEngine(srv, opts);
	}

	/**
	 * Initialize engine
	 *
	 * @param srv - the server to attach to
	 * @param opts - options passed to engine.io
	 * @private
	 */
	private initEngine(srv: BunServer, opts: Partial<ServerOptions> = {}): void {
		debug('creating engine.io instance');
		// initialize engine
		this.engine = new Engine(srv, opts);
		// bind to engine events
		this.bind(this.engine);
	}

	/**
	 * Binds socket.io to an engine.io instance.
	 *
	 * @param engine engine.io (or compatible) server
	 * @return self
	 */
	bind(engine: any): this {
		// TODO apply strict types to the engine: "connection" event, `close()` and a method to serve static content
		//  this would allow to provide any custom engine, like one based on Deno or Bun built-in HTTP server
		engine.on('connection', (conn: RawSocket) => {
			// prevent duplicate clients
			if (conn.id in this._clients) return this;
			// create client if not exist
			const client = new Client(conn, this);
			this._clients.set(conn.id, client);
		});
		return this;
	}

	/**
	 * Called with each incoming transport connection.
	 *
	 * @param {Context} c
	 * @param {SocketData} data
	 * @return any (for compatibility)
	 * @private
	 */
	onconnection(c: Context, data?: SocketData): WSEvents<ServerWebSocket<WSContext>> {
		const transport = this.engine.handleRequest(c, data);
		return {
			onOpen: transport.onOpen.bind(transport),
			onMessage: transport.onMessage.bind(transport),
			onClose: transport.onClose.bind(transport),
			onError: transport.onError.bind(transport),
		};
	}

	/**
	 * Looks up a namespace.
	 *
	 * @example
	 * // with a simple string
	 * const myNamespace = io.of("/my-namespace");
	 *
	 * // with a regex
	 * const dynamicNsp = io.of(/^\/dynamic-\d+$/).on("connection", (socket) => {
	 *   const namespace = socket.nsp; // newNamespace.name === "/dynamic-101"
	 *
	 *   // broadcast to all clients in the given sub-namespace
	 *   namespace.emit("hello");
	 * });
	 *
	 * @param name - nsp name
	 * @param fn optional, nsp `connection` ev handler
	 */
	of(
		/** namespace */
		name: string | RegExp,
		fn?: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void,
	): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		if (typeof name === 'function' || name instanceof RegExp) {
			const parentNsp = new ParentNamespace(this);
			debug('initializing parent namespace %s', parentNsp.name);
			if (typeof name === 'function') {
				this.parentNsps.set(name, parentNsp);
			} else {
				this.parentNsps.set((nsp, conn, next) => next(null, (name as unknown as RegExp).test(nsp)), parentNsp);
				this.parentNamespacesFromRegExp.set(name, parentNsp);
			}
			if (fn) {
				// @ts-ignore
				parentNsp.on('connect', fn);
			}
			return parentNsp;
		}

		name = name as string;
		if (String(name)[0] !== '/') name = '/' + name;

		let nsp = this._nsps.get(name);

		if (!nsp) {
			for (const [regex, parentNamespace] of this.parentNamespacesFromRegExp) {
				if (regex.test(name as string)) {
					debug('attaching namespace %s to parent namespace %s', name, regex);
					return parentNamespace.createChild(name as string);
				}
			}

			debug('initializing namespace %s', name);
			nsp = new Namespace(this, name);
			this._nsps.set(name, nsp);

			if (name !== '/') {
				// @ts-ignore
				this.sockets.emitReserved('new_namespace', nsp);
			}
		}
		if (fn) nsp.on('connect', fn);
		return nsp;
	}

	/**
	 * Closes server connection
	 *
	 * @param [fn] optional, called as `fn([err])` on error OR all conns closed
	 */
	async close(fn?: (err?: Error) => void): Promise<void> {
		await Promise.allSettled(
			[...this._nsps.values()].map(async (nsp) => {
				nsp.sockets.forEach((socket) => {
					socket._onclose('server shutting down');
				});

				await nsp.adapter.close();
			}),
		);

		this.engine.close();

		fn && fn();
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
	use(
		fn: (
			/** strict types */
			socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
			next: (err?: ExtendedError) => void,
		) => void,
	): this {
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
	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
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
	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
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
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
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
	send(...args: EventParams<EmitEvents, 'message'>): this {
		this.sockets.emit('message' as any, ...args);
		return this;
	}

	/**
	 * Sends a `message` event to all clients. Alias of {@link send}.
	 *
	 * @return self
	 */
	write(...args: EventParams<EmitEvents, 'message'>): this {
		return this.send(...args);
	}

	// TODO: add cluster compatibility
	private serverSideEmit() {}
	private serverSideEmitWithAck() {}

	/**
	 * Sets the compress flag.
	 *
	 * @example
	 * io.compress(false).emit("hello");
	 *
	 * @param compress - if `true`, compresses the sending data
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	compress(compress: boolean) {
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
	get volatile() {
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
	get local() {
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
	timeout(timeout: number) {
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
	fetchSockets(): Promise<any[]> {
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
	socketsJoin(room: Room | Room[]): void {
		this.sockets.socketsJoin(room);
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
	socketsLeave(room: Room | Room[]): void {
		this.sockets.socketsLeave(room);
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
	disconnectSockets(close: boolean = false): void {
		this.sockets.disconnectSockets(close);
	}
}

/**
 * Expose main namespace (/).
 */

const emitterMethods = Object.keys(EventEmitter.prototype).filter(function (key) {
	// @ts-ignore
	return typeof EventEmitter.prototype[key] === 'function';
});

emitterMethods.forEach(function (fn) {
	// @ts-ignore
	Server.prototype[fn] = function () {
		// @ts-ignore
		return this.sockets[fn].apply(this.sockets, arguments);
	};
});

const io = Object.assign(
	// @ts-ignore
	(srv?: any, opts?: any) => new Server(srv, opts),
	{
		Server,
		Namespace,
		Socket,
	},
);

export default io;
export { Server, Socket, Namespace, BroadcastOperator };
export type { DisconnectReason, DefaultEventsMap, ExtendedError }; // RemoteSocket removed
export type { Event } from './socket';
