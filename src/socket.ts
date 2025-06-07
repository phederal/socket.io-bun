import base64id from 'base64id';
import debugModule from 'debug';
import type { SocketData as DefaultSocketData } from '../types/socket-types';
import { RESERVED_EVENTS, type DisconnectReason, type Handshake, type SocketReservedEventsMap } from '#types/socket-types';
import {
	StrictEventEmitter,
	type AllButLast,
	type DecorateAcknowledgements,
	type DecorateAcknowledgementsWithMultipleResponses,
	type DefaultEventsMap,
	type EventNames,
	type EventNamesWithAck,
	type EventParams,
	type EventsMap,
	type FirstNonErrorArg,
	type Last,
} from '#types/typed-events';
import type { Adapter, PrivateSessionId, Session, SocketId, Room } from './socket.io-adapter';
import type { Client } from './client';
import type { Namespace } from './namespace';
import type { Server } from './';
import { BroadcastOperator, type BroadcastFlags } from './broadcast';
import { PacketType, type Packet } from './socket.io-parser';
import { debugConfig } from '../config';

const debug = debugModule('socket.io:socket');
debug.enabled = debugConfig.socket;

const RECOVERABLE_DISCONNECT_REASONS: ReadonlySet<DisconnectReason> = new Set([
	'transport error',
	'transport close',
	'forced close',
	'ping timeout',
	'server shutting down',
	'forced server close',
]);

/**
 * `[eventName, ...args]`
 */
export type Event = [string, ...any[]];

export class Socket<
	ListenEvents extends EventsMap = DefaultEventsMap,
	EmitEvents extends EventsMap = ListenEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData,
> extends StrictEventEmitter<ListenEvents, EmitEvents, SocketReservedEventsMap> {
	/**
	 * An unique identifier for the session.
	 */
	public readonly id: SocketId;
	/**
	 * The handshake details.
	 */
	public readonly handshake: Handshake;
	/**
	 * Additional information that can be attached to the Socket instance and which will be used in the
	 * {@link Server.fetchSockets()} method.
	 */
	public data: SocketData = {} as SocketData;

	/**
	 * Whether the socket is currently connected or not.
	 *
	 * @example
	 * io.use((socket, next) => {
	 *   console.log(socket.connected); // false
	 *   next();
	 * });
	 *
	 * io.on("connection", (socket) => {
	 *   console.log(socket.connected); // true
	 * });
	 */
	public connected: boolean = false;

	// TODO: add pid

	private readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	private readonly adapter: Adapter;

	private acks = new Map<number, (...args: any[]) => void>();
	private fns: Array<(event: Event, next: (err?: Error) => void) => void> = [];
	private flags: BroadcastFlags = {};
	private _anyListeners?: Array<(...args: any[]) => void>;
	private _anyOutgoingListeners?: Array<(...args: any[]) => void>;

	constructor(
		readonly nsp: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		readonly client: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		auth: Record<string, unknown>,
		// previousSession?: Session,
	) {
		super();
		this.server = nsp.server;
		this.adapter = nsp.adapter;
		this.id = base64id.generateId();
		this.handshake = this.buildHandshake(auth);

		// prevents crash when the socket receives an "error" event without listener
		// this.on('error', () => {});
	}

	/**
	 * Builds the `handshake` BC object
	 *
	 * @private
	 */
	private buildHandshake(auth: object = {}): Handshake {
		return {
			headers: this.client.conn.ctx.req.header() || {},
			time: new Date().toISOString(),
			address: this.client.conn.ws.raw?.remoteAddress ?? '0.0.0.0',
			xdomain: !!this.client.conn.ctx.req.header('Origin'),
			// @ts-ignore
			secure: !this.client.conn.ctx.req.url.startsWith('wss://'),
			issued: +new Date(),
			url: this.client.conn.ctx.req.url,
			// @ts-ignore
			query: Object.fromEntries(new URL(this.client.conn.ctx.req.url).searchParams),
			auth: auth,
		};
	}

	/**
	 * Emits to this client.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.emit("hello", "world");
	 *
	 *   // all serializable datastructures are supported (no need to call JSON.stringify)
	 *   socket.emit("hello", 1, "2", { 3: ["4"], 5: Buffer.from([6]) });
	 *
	 *   // with an acknowledgement from the client
	 *   socket.emit("hello", "world", (val) => {
	 *     // ...
	 *   });
	 * });
	 *
	 * @return Always returns `true`.
	 */
	override emit<Ev extends EventNames<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		// Special handling of the 'error' event (improve by socket.io-bun)
		if (ev === 'error' && args.length > 0 && args[0] instanceof Error) {
			this.emitReserved('error', args[0] as Error);
			return true;
		}

		if (RESERVED_EVENTS.has(ev)) {
			throw new Error(`"${String(ev)}" is a reserved event name`);
		}

		const data: any[] = [ev, ...args];
		const packet: any = {
			type: PacketType.EVENT,
			data: data,
		};

		// access last argument to see if it's an ACK callback
		if (typeof data[data.length - 1] === 'function') {
			const id = this.nsp._ids++;
			debug('emitting packet with ack id %d', id);

			this.registerAckCallback(id, data.pop());
			packet.id = id;
		}

		const flags = Object.assign({}, this.flags);
		this.flags = {};

		// TODO: add connected state recovered
		// @ts-ignore
		// if (this.nsp.server.opts.connectionStateRecovery) {
		//   // this ensures the packet is stored and can be transmitted upon reconnection
		//   this.adapter.broadcast(packet, {
		//     rooms: new Set([this.id]),
		//     except: new Set(),
		//     flags,
		//   });
		// } else { ...> }

		this.notifyOutgoingListeners(packet);
		this.packet(packet, flags);

		return true;
	}

	/**
	 * Emits an event and waits for an acknowledgement
	 *
	 * @example
	 * io.on("connection", async (socket) => {
	 *   // without timeout
	 *   const response = await socket.emitWithAck("hello", "world");
	 *
	 *   // with a specific timeout
	 *   try {
	 *     const response = await socket.timeout(1000).emitWithAck("hello", "world");
	 *   } catch (err) {
	 *     // the client did not acknowledge the event in the given delay
	 *   }
	 * });
	 *
	 * @return a Promise that will be fulfilled when the client acknowledges the event
	 */
	emitWithAck<Ev extends EventNamesWithAck<EmitEvents>>(
		ev: Ev,
		...args: AllButLast<EventParams<EmitEvents, Ev>>
	): Promise<FirstNonErrorArg<Last<EventParams<EmitEvents, Ev>>>> {
		// the timeout flag is optional
		const withErr = this.flags.timeout !== undefined;
		return new Promise((resolve, reject) => {
			args.push((arg1: any, arg2: any) => {
				if (withErr) {
					return arg1 ? reject(arg1) : resolve(arg2);
				} else {
					return resolve(arg1);
				}
			});
			this.emit(ev, ...(args as any[] as EventParams<EmitEvents, Ev>));
		});
	}

	/**
	 * @private
	 */
	private registerAckCallback(id: number, ack: (...args: any[]) => void): void {
		const timeout = this.flags.timeout;
		if (timeout === undefined) {
			this.acks.set(id, ack);
			return;
		}

		const timer = setTimeout(() => {
			debug('event with ack id %d has timed out after %d ms', id, timeout);
			this.acks.delete(id);
			ack.call(this, new Error('operation has timed out'));
		}, timeout);

		this.acks.set(id, (...args) => {
			clearTimeout(timer);
			ack.apply(this, [null, ...args]);
		});
	}

	/**
	 * Targets a room when broadcasting.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // the “foo” event will be broadcast to all connected clients in the “room-101” room, except this socket
	 *   socket.to("room-101").emit("foo", "bar");
	 *
	 *   // the code above is equivalent to:
	 *   io.to("room-101").except(socket.id).emit("foo", "bar");
	 *
	 *   // with an array of rooms (a client will be notified at most once)
	 *   socket.to(["room-101", "room-102"]).emit("foo", "bar");
	 *
	 *   // with multiple chained calls
	 *   socket.to("room-101").to("room-102").emit("foo", "bar");
	 * });
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	to(room: Room | Room[]) {
		return this.newBroadcastOperator().to(room);
	}

	/**
	 * Targets a room when broadcasting. Similar to `to()`, but might feel clearer in some cases:
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // disconnect all clients in the "room-101" room, except this socket
	 *   socket.in("room-101").disconnectSockets();
	 * });
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	in(room: Room | Room[]) {
		return this.newBroadcastOperator().in(room);
	}

	/**
	 * Excludes a room when broadcasting.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // the "foo" event will be broadcast to all connected clients, except the ones that are in the "room-101" room
	 *   // and this socket
	 *   socket.except("room-101").emit("foo", "bar");
	 *
	 *   // with an array of rooms
	 *   socket.except(["room-101", "room-102"]).emit("foo", "bar");
	 *
	 *   // with multiple chained calls
	 *   socket.except("room-101").except("room-102").emit("foo", "bar");
	 * });
	 *
	 * @param room - a room, or an array of rooms
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	except(room: Room | Room[]) {
		return this.newBroadcastOperator().except(room);
	}

	/**
	 * Sends a `message` event.
	 *
	 * This method mimics the WebSocket.send() method.
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.send("hello");
	 *
	 *   // this is equivalent to
	 *   socket.emit("message", "hello");
	 * });
	 *
	 * @return self
	 */
	send(...args: EventParams<EmitEvents, 'message'>): this {
		this.emit('message', ...args);
		return this;
	}

	/**
	 * Sends a `message` event. Alias of {@link send}.
	 *
	 * @return self
	 */
	write(...args: EventParams<EmitEvents, 'message'>): this {
		this.emit('message', ...args);
		return this;
	}

	/**
	 * Writes a packet.
	 *
	 * @param {Object} packet - packet object
	 * @param {Object} opts - options
	 * @private
	 */
	packet(
		/** strict types */
		packet: Omit<Packet, 'nsp'> & Partial<Pick<Packet, 'nsp'>>,
		opts: any = {},
	): void {
		packet.nsp = this.nsp.name;
		opts.compress = false !== opts.compress;
		this.client._packet(packet as Packet, opts);
	}

	/**
	 * Joins a room.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // join a single room
	 *   socket.join("room1");
	 *
	 *   // join multiple rooms
	 *   socket.join(["room1", "room2"]);
	 * });
	 *
	 * @param {String|Array} rooms - room or array of rooms
	 * @return a Promise or nothing, depending on the adapter
	 */
	join(rooms: Room | Array<Room>): Promise<void> | void {
		debug('join room %s', rooms);

		return this.adapter.addAll(this.id, new Set(Array.isArray(rooms) ? rooms : [rooms]));
	}

	/**
	 * Leaves a room.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // leave a single room
	 *   socket.leave("room1");
	 *
	 *   // leave multiple rooms
	 *   socket.leave("room1").leave("room2");
	 * });
	 *
	 * @param {String} room
	 * @return a Promise or nothing, depending on the adapter
	 */
	leave(room: Room): Promise<void> | void {
		debug('leave room %s', room);

		return this.adapter.del(this.id, room);
	}

	/**
	 * Leave all rooms.
	 *
	 * @private
	 */
	private leaveAll(): Promise<void> | void {
		return this.adapter.delAll(this.id);
	}

	/**
	 * Called by `Namespace` upon successful
	 * middleware execution (ie: authorization).
	 * Socket is added to namespace array before
	 * call to join, so adapters can access it.
	 *
	 * @private
	 */
	_onconnect(): void {
		debug('socket connected - writing packet');
		this.connected = true;
		this.join(this.id);
		this.packet({
			type: PacketType.CONNECT,
			data: { sid: this.id }, // TODO: FIX HANDSHAKE ON CONNECT
		});
	}

	/**
	 * Called with each packet. Called by `Client`.
	 *
	 * @param {Object} packet
	 * @private
	 */
	_onpacket(packet: Packet): void {
		debug('got packet %j', packet);
		switch (packet.type) {
			case PacketType.EVENT:
				debug('socket: calling onevent for packet %j', packet);
				this.onevent(packet);
				break;

			case PacketType.BINARY_EVENT:
				debug('socket: calling onevent for packet %j', packet);
				this.onevent(packet);
				break;

			case PacketType.ACK:
				debug('socket: calling onack for packet %j', packet);
				this.onack(packet);
				break;

			case PacketType.BINARY_ACK:
				debug('socket: calling onack for packet %j', packet);
				this.onack(packet);
				break;

			case PacketType.DISCONNECT:
				debug('socket: calling ondisconnect for packet %j', packet);
				this.ondisconnect();
				break;
		}
	}

	/**
	 * Called upon event packet.
	 *
	 * @param {Packet} packet - packet object
	 * @private
	 */
	private onevent(packet: Packet): void {
		const args = packet.data || [];
		debug('emitting event %j', args);

		if (null != packet.id) {
			debug('attaching ack callback to event');
			args.push(this.ack(packet.id));
		}

		if (this._anyListeners && this._anyListeners.length) {
			const listeners = this._anyListeners.slice();
			for (const listener of listeners) {
				listener.apply(this, args);
			}
		}

		this.dispatch(args);
	}

	/**
	 * Produces an ack callback to emit with an event.
	 *
	 * @param {Number} id - packet id
	 * @private
	 */
	private ack(id: number): () => void {
		const self = this;
		let sent = false;
		debug('ack: creating callback for ACK id %d', id);
		return function () {
			// prevent double callbacks
			debug('ack: callback already sent for id %d, ignoring', id);
			if (sent) return;

			const args = Array.prototype.slice.call(arguments);
			debug('ack: callback invoked for id %d with args %j', id, args);

			debug('sending ack %j', args);
			self.packet({
				id: id,
				type: PacketType.ACK,
				data: args,
			});

			sent = true;
			debug('ack: ACK packet sent for id %d', id);
		};
	}

	/**
	 * Called upon ack packet.
	 *
	 * @private
	 */
	private onack(packet: Packet): void {
		const ack = this.acks.get(packet.id!);
		if ('function' == typeof ack) {
			debug('calling ack %s with %j', packet.id, packet.data);
			ack.apply(this, packet.data);
			this.acks.delete(packet.id!);
		} else {
			debug('bad ack %s', packet.id);
		}
	}

	/**
	 * Called upon client disconnect packet.
	 *
	 * @private
	 */
	private ondisconnect(): void {
		debug('got disconnect packet');
		this._onclose('client namespace disconnect');
	}

	/**
	 * Handles a client error.
	 *
	 * @private
	 */
	_onerror(err: Error): void {
		// Be fixed (from socket.io repo) the meaning of the "error" event is overloaded:
		//  - it can be sent by the client (`socket.emit("error")`)
		//  - it can be emitted when the connection encounters an error (an invalid packet for example)
		//  - it can be emitted when a packet is rejected in a middleware (`socket.use()`)
		this.emitReserved('error', err);
	}

	/**
	 * Called upon closing. Called by `Client`.
	 *
	 * @param {String} reason
	 * @param description
	 * @throw {Error} optional error object
	 *
	 * @private
	 */
	_onclose(reason: DisconnectReason, description?: any): this | undefined {
		if (!this.connected) return this;
		debug('closing socket - reason %s', reason);
		this.emitReserved('disconnecting', reason, description);

		// TODO: add persist session
		// if (this.server._opts.connectionStateRecovery && RECOVERABLE_DISCONNECT_REASONS.has(reason)) {
		// 	debug('connection state recovery is enabled for sid %s', this.id);
		// 	this.adapter.persistSession({
		// 		sid: this.id,
		// 		pid: this.pid,
		// 		rooms: [...this.rooms],
		// 		data: this.data,
		// 	});
		// }

		this._cleanup();
		this.client._remove(this);
		this.connected = false;
		this.emitReserved('disconnect', reason, description);
		return;
	}

	/**
	 * Makes the socket leave all the rooms it was part of and prevents it from joining any other room
	 *
	 * @private
	 */
	_cleanup() {
		this.leaveAll();
		this.nsp._remove(this);
		this.join = () => {};

		// clear timeouts on acks
		this.acks.forEach((callback) => {
			try {
				callback(new Error('Socket disconnected'));
			} catch {}
		});
		this.acks.clear(); // clear acks
	}

	/**
	 * Produces an `error` packet.
	 *
	 * @param {Object} err - error object
	 *
	 * @private
	 */
	_error(err: any): void {
		this.packet({ type: PacketType.CONNECT_ERROR, data: err });
	}

	/**
	 * Disconnects this client.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // disconnect this socket (the connection might be kept alive for other namespaces)
	 *   socket.disconnect();
	 *
	 *   // disconnect this socket and close the underlying connection
	 *   socket.disconnect(true);
	 * })
	 *
	 * @param {Boolean} close - if `true`, closes the underlying connection
	 * @return self
	 */
	disconnect(close = false): this {
		if (!this.connected) return this;
		if (close) {
			this.client._disconnect();
		} else {
			this.packet({ type: PacketType.DISCONNECT });
			this._onclose('server namespace disconnect');
		}
		return this;
	}

	/**
	 * Sets the compress flag.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.compress(false).emit("hello");
	 * });
	 *
	 * @param {Boolean} compress - if `true`, compresses the sending data
	 * @return {Socket} self
	 */
	compress(compress: boolean): this {
		this.flags.compress = compress;
		return this;
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data may be lost if the client is not ready to
	 * receive messages (because of network slowness or other issues, or because they’re connected through long polling
	 * and is in the middle of a request-response cycle).
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.volatile.emit("hello"); // the client may or may not receive it
	 * });
	 *
	 * @return {Socket} self
	 */
	get volatile(): this {
		this.flags.volatile = true;
		return this;
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data will only be broadcast to every sockets but the
	 * sender.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // the “foo” event will be broadcast to all connected clients, except this socket
	 *   socket.broadcast.emit("foo", "bar");
	 * });
	 *
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	get broadcast() {
		return this.newBroadcastOperator();
	}

	/**
	 * Sets a modifier for a subsequent event emission that the event data will only be broadcast to the current node.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // the “foo” event will be broadcast to all connected clients on this node, except this socket
	 *   socket.local.emit("foo", "bar");
	 * });
	 *
	 * @return a new {@link BroadcastOperator} instance for chaining
	 */
	get local() {
		return this.newBroadcastOperator().local;
	}

	/**
	 * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
	 * given number of milliseconds have elapsed without an acknowledgement from the client:
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.timeout(5000).emit("my-event", (err) => {
	 *     if (err) {
	 *       // the client did not acknowledge the event in the given delay
	 *     }
	 *   });
	 * });
	 *
	 * @returns self
	 */
	timeout(timeout: number): Socket<
		/** strict types */
		ListenEvents,
		DecorateAcknowledgements<EmitEvents>,
		ServerSideEvents,
		SocketData
	> {
		this.flags.timeout = timeout;
		return this;
	}

	/**
	 * Dispatch incoming event to socket listeners.
	 *
	 * @param {Array} event - event that will get emitted
	 * @private
	 */
	private dispatch(event: Event): void {
		debug('dispatching an event %j', event);
		debug('available listeners: %j', this.eventNames());
		debug('middleware chain length: %d', this.fns.length);

		this.run(event, (err) => {
			debug('middleware chain completed, err: %j', err);
			process.nextTick(() => {
				if (err) {
					debug('dispatch: middleware error, calling _onerror');
					return this._onerror(err);
				}
				if (this.connected) {
					debug('dispatch: emitting event via emitUntyped with args: %j', event);
					debug('dispatch: event name: %s, args count: %d', event[0], event.length);
					super.emitUntyped.apply(this, event);
				} else {
					debug('ignore packet received after disconnection');
				}
			});
		});
	}

	/**
	 * Sets up socket middleware.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.use(([event, ...args], next) => {
	 *     if (isUnauthorized(event)) {
	 *       return next(new Error("unauthorized event"));
	 *     }
	 *     // do not forget to call next
	 *     next();
	 *   });
	 *
	 *   socket.on("error", (err) => {
	 *     if (err && err.message === "unauthorized event") {
	 *       socket.disconnect();
	 *     }
	 *   });
	 * });
	 *
	 * @param {Function} fn - middleware function (event, next)
	 * @return {Socket} self
	 */
	use(fn: (event: Event, next: (err?: Error) => void) => void): this {
		this.fns.push(fn);
		return this;
	}

	/**
	 * Executes the middleware for an incoming event.
	 *
	 * @param {Array} event - event that will get emitted
	 * @param {Function} fn - last fn call in the middleware
	 * @private
	 */
	private run(event: Event, fn: (err?: Error) => void): void {
		debug('run: middleware execution start, chain length: %d', this.fns.length);
		if (!this.fns.length) {
			debug('run: no middleware, calling final callback');
			return fn();
		}
		const fns = this.fns.slice(0);
		debug('run: executing middleware chain with %d functions', fns.length);
		(function run(i: number) {
			fns[i]!(event, (err) => {
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
	 * Whether the socket is currently disconnected
	 */
	get disconnected() {
		return !this.connected;
	}

	/**
	 * A reference to the request that originated the underlying Engine.IO Socket.
	 */
	get ctx() {
		return this.client.conn.ctx;
	}

	/**
	 * A reference to the underlying Client transport connection (Engine.IO Socket object).
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   // Not compatible with this socket.io-bun version
	 *   console.log(socket.conn.transport.name); // prints "polling" or "websocket"
	 *
	 *   // Not compatible with this socket.io-bun version
	 *   socket.conn.once("upgrade", () => {
	 *     console.log(socket.conn.transport.name); // prints "websocket"
	 *   });
	 * });
	 */
	get conn() {
		return this.client.conn;
	}

	get ws() {
		return this.client.conn.ws.raw!;
	}

	/**
	 * Returns the rooms the socket is currently in.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   console.log(socket.rooms); // Set { <socket.id> }
	 *
	 *   socket.join("room1");
	 *
	 *   console.log(socket.rooms); // Set { <socket.id>, "room1" }
	 * });
	 */
	get rooms(): Set<Room> {
		return this.adapter.socketRooms(this.id) || new Set();
	}

	/**
	 * Adds a listener that will be fired when any event is received. The event name is passed as the first argument to
	 * the callback.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.onAny((event, ...args) => {
	 *     console.log(`got event ${event}`);
	 *   });
	 * });
	 *
	 * @param listener
	 */
	onAny(listener: (...args: any[]) => void): this {
		this._anyListeners = this._anyListeners || [];
		this._anyListeners.push(listener);
		return this;
	}

	/**
	 * Adds a listener that will be fired when any event is received. The event name is passed as the first argument to
	 * the callback. The listener is added to the beginning of the listeners array.
	 *
	 * @param listener
	 */
	prependAny(listener: (...args: any[]) => void): this {
		this._anyListeners = this._anyListeners || [];
		this._anyListeners.unshift(listener);
		return this;
	}

	/**
	 * Removes the listener that will be fired when any event is received.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   const catchAllListener = (event, ...args) => {
	 *     console.log(`got event ${event}`);
	 *   }
	 *
	 *   socket.onAny(catchAllListener);
	 *
	 *   // remove a specific listener
	 *   socket.offAny(catchAllListener);
	 *
	 *   // or remove all listeners
	 *   socket.offAny();
	 * });
	 *
	 * @param listener
	 */
	offAny(listener?: (...args: any[]) => void): this {
		if (!this._anyListeners) {
			return this;
		}
		if (listener) {
			const listeners = this._anyListeners;
			for (let i = 0; i < listeners.length; i++) {
				if (listener === listeners[i]) {
					listeners.splice(i, 1);
					return this;
				}
			}
		} else {
			this._anyListeners = [];
		}
		return this;
	}

	/**
	 * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
	 * e.g. to remove listeners.
	 */
	listenersAny() {
		return this._anyListeners || [];
	}

	/**
	 * Adds a listener that will be fired when any event is sent. The event name is passed as the first argument to
	 * the callback.
	 *
	 * Note: acknowledgements sent to the client are not included.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.onAnyOutgoing((event, ...args) => {
	 *     console.log(`sent event ${event}`);
	 *   });
	 * });
	 *
	 * @param listener
	 */
	onAnyOutgoing(listener: (...args: any[]) => void): this {
		this._anyOutgoingListeners = this._anyOutgoingListeners || [];
		this._anyOutgoingListeners.push(listener);
		return this;
	}

	/**
	 * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
	 * callback. The listener is added to the beginning of the listeners array.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   socket.prependAnyOutgoing((event, ...args) => {
	 *     console.log(`sent event ${event}`);
	 *   });
	 * });
	 *
	 * @param listener
	 */
	prependAnyOutgoing(listener: (...args: any[]) => void): this {
		this._anyOutgoingListeners = this._anyOutgoingListeners || [];
		this._anyOutgoingListeners.unshift(listener);
		return this;
	}

	/**
	 * Removes the listener that will be fired when any event is sent.
	 *
	 * @example
	 * io.on("connection", (socket) => {
	 *   const catchAllListener = (event, ...args) => {
	 *     console.log(`sent event ${event}`);
	 *   }
	 *
	 *   socket.onAnyOutgoing(catchAllListener);
	 *
	 *   // remove a specific listener
	 *   socket.offAnyOutgoing(catchAllListener);
	 *
	 *   // or remove all listeners
	 *   socket.offAnyOutgoing();
	 * });
	 *
	 * @param listener - the catch-all listener
	 */
	offAnyOutgoing(listener?: (...args: any[]) => void): this {
		if (!this._anyOutgoingListeners) {
			return this;
		}
		if (listener) {
			const listeners = this._anyOutgoingListeners;
			for (let i = 0; i < listeners.length; i++) {
				if (listener === listeners[i]) {
					listeners.splice(i, 1);
					return this;
				}
			}
		} else {
			this._anyOutgoingListeners = [];
		}
		return this;
	}

	/**
	 * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
	 * e.g. to remove listeners.
	 */
	listenersAnyOutgoing() {
		return this._anyOutgoingListeners || [];
	}

	/**
	 * Notify the listeners for each packet sent (emit or broadcast)
	 *
	 * @param packet
	 *
	 * @private
	 */
	notifyOutgoingListeners(packet: Packet) {
		if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
			const listeners = this._anyOutgoingListeners.slice();
			for (const listener of listeners) {
				listener.apply(this, packet.data);
			}
		}
	}

	private newBroadcastOperator() {
		const flags = Object.assign({}, this.flags);
		this.flags = {};
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(
			this.adapter,
			new Set<Room>(),
			new Set<Room>([this.id]),
			flags,
			this,
		);
	}
}
