import base64id from 'base64id';
import debugModule from 'debug';
import type { ServerToClientEvents, ClientToServerEvents, SocketId, Room, AckCallback, SocketData as DefaultSocketData } from '../types/socket-types';
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
import type { Adapter } from './adapter';
import type { Client } from './client';
import type { Namespace } from './namespace';
import type { Server } from './server';
import { BroadcastOperator, type BroadcastFlags } from './broadcast';
import { PacketType, type Packet } from './parser';

const debug = debugModule('socket.io:socket');

const isProduction = process.env.NODE_ENV === 'production';

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
	public readonly id: SocketId;
	public readonly handshake: Handshake;
	public readonly data: SocketData = {} as SocketData;
	public connected: boolean = false;

	private readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	private readonly adapter: Adapter;
	/** @private */
	public acks = new Map<number, () => void>();
	private fns: Array<(event: Event, next: (err?: Error) => void) => void> = [];
	private flags: BroadcastFlags = {};
	private _anyListeners?: Array<(...args: any[]) => void>;
	private _anyOutgoingListeners?: Array<(...args: any[]) => void>;

	constructor(
		readonly nsp: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		readonly client: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		auth: Record<string, unknown>,
	) {
		super();
		this.server = nsp.server;
		this.adapter = nsp.adapter;
		this.id = base64id.generateId();
		this.adapter = this.nsp.adapter;
		this.handshake = this.buildHandshake(auth);
		this.on('error', () => {});
	}

	/**
	 * Builds the `handshake` BC object
	 *
	 * @private
	 */
	private buildHandshake(auth: object = {}): Handshake {
		const ip =
			this.client.conn.ctx.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
			this.client.conn.ctx.req.header('X-Real-IP') ||
			this.client.conn.ctx.req.header('CF-Connecting-IP');
		return {
			headers: this.client.conn.ctx.req.header() || {},
			time: new Date() + '',
			address: ip ?? '0.0.0.0',
			xdomain: !!this.client.conn.ctx.req.header('Origin'),
			// @ts-ignore
			secure: !this.client.conn.ctx.req,
			issued: +new Date(),
			url: this.client.conn.ctx.req.url,
			// @ts-ignore
			query: this.client.conn.ctx.req.queries || [],
			auth,
		};
	}

	override emit<Ev extends EventNames<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
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

		this.notifyOutgoingListeners(packet);
		this.packet(packet, flags);

		return true;
	}

	public emitWithAck<Ev extends EventNamesWithAck<EmitEvents>>(
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

	to(room: Room | Room[]): any {
		return this.newBroadcastOperator().to(room);
	}

	in(room: Room | Room[]): any {
		this.newBroadcastOperator().in(room);
	}

	except(room: Room | Room[]) {
		return this.newBroadcastOperator().except(room);
	}

	send(...args: EventParams<EmitEvents, 'message'>): this {
		this.emit('message', ...args);
		return this;
	}

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
	packet(packet: Omit<Packet, 'nsp'> & Partial<Pick<Packet, 'nsp'>>, opts: any = {}): void {
		packet.nsp = this.nsp.name;
		opts.compress = false !== opts.compress;
		this.client._packet(packet as Packet, opts);
	}

	join(rooms: Room | Array<Room>): Promise<void> | void {
		debug('join room %s', rooms);
		return this.adapter.addAll(this.id, new Set(Array.isArray(rooms) ? rooms : [rooms]));
	}

	leave(room: Room): Promise<void> | void {
		debug('leave room %s', room);
		return this.adapter.del(this.id, room);
	}

	leaveAll(): Promise<void> | void {
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
			data: { sid: this.id },
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
				this.onevent(packet);
				break;
			case PacketType.BINARY_EVENT:
				this.onevent(packet);
				break;
			case PacketType.ACK:
				this.onack(packet);
				break;
			case PacketType.BINARY_ACK:
				this.onack(packet);
				break;
			case PacketType.DISCONNECT:
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
		return function () {
			// prevent double callbacks
			if (sent) return;
			const args = Array.prototype.slice.call(arguments);
			debug('sending ack %j', args);
			self.packet({
				id: id,
				type: PacketType.ACK,
				data: args,
			});
			sent = true;
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
	public disconnect(close = false): this {
		if (!this.connected) return this;
		if (close) {
			this.client._disconnect();
		} else {
			this.packet({ type: PacketType.DISCONNECT });
			this._onclose('server namespace disconnect');
		}
		return this;
	}

	public compress(compress: boolean): this {
		this.flags.compress = compress;
		return this;
	}

	public get volatile(): this {
		this.flags.volatile = true;
		return this;
	}

	public get broadcast() {
		return this.newBroadcastOperator();
	}

	public get local() {
		return this.newBroadcastOperator().local;
	}

	timeout(timeout: number): Socket<ListenEvents, DecorateAcknowledgements<EmitEvents>, ServerSideEvents, SocketData> {
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
		this.run(event, (err) => {
			process.nextTick(() => {
				if (err) {
					return this._onerror(err);
				}
				if (this.connected) {
					super.emitUntyped.apply(this, event);
				} else {
					debug('ignore packet received after disconnection');
				}
			});
		});
	}

	public use(fn: (event: Event, next: (err?: Error) => void) => void): this {
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
		if (!this.fns.length) return fn();
		const fns = this.fns.slice(0);
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
	public get disconnected() {
		return !this.connected;
	}

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
	public onAny(listener: (...args: any[]) => void): this {
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
	public prependAny(listener: (...args: any[]) => void): this {
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
	public offAny(listener?: (...args: any[]) => void): this {
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
	public listenersAny() {
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
	public onAnyOutgoing(listener: (...args: any[]) => void): this {
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
	public prependAnyOutgoing(listener: (...args: any[]) => void): this {
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
	public offAnyOutgoing(listener?: (...args: any[]) => void): this {
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
	public listenersAnyOutgoing() {
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
		);
	}

	/**
	 * Must be disbanded and deleted
	 */
	_handlePacket(packet: any): void {
		if (!packet || !packet.event) return;

		if (!isProduction) {
			console.log(`[Socket] Handling packet: ${packet.event} from ${this.id}, ackId: ${packet.ackId}`);
		}

		try {
			if (packet.event === '__connect') return;
			if (packet.event === '__disconnect') {
				this._handleClose('client namespace disconnect');
				return;
			}

			if (packet.event === '__ack' && packet.ackId) {
				if (!isProduction) {
					console.log(`[Socket] Received ACK response: ${packet.ackId} from ${this.id}`);
				}
				this._handleAck(packet.ackId, packet.data);
				return;
			}

			if (packet.event === 'ping') {
				if (this.ws.readyState === 1) {
					this.ws.send('3');
				}
				return;
			}
			if (packet.event === 'pong') return;

			// ИСПРАВЛЕНО: Правильная обработка событий с ACK запросом от клиента
			if (packet.ackId && typeof packet.ackId === 'string') {
				if (!isProduction) {
					console.log(`[Socket] Event ${packet.event} requires ACK response: ${packet.ackId}`);
				}

				const listeners = this.listeners(packet.event);

				if (listeners.length > 0) {
					const listener = listeners[0] as Function;

					const ackWrapper = (...args: any[]) => {
						try {
							if (!this._connected || this.ws.readyState !== 1) {
								return;
							}

							const ackResponse = SocketParser.encodeAckResponse(packet.ackId!, args, this.nsp.name);

							const success = this.ws.send(ackResponse);

							if (!isProduction && !success) {
								console.warn(`[Socket] Failed to send ACK response for ${packet.ackId}`);
							}
						} catch (error) {
							if (!isProduction) {
								console.warn(`[Socket] ACK response error:`, error);
							}
						}
					};

					try {
						// ИСПРАВЛЕНО: Правильное определение типа события с ACK
						if (packet.data !== undefined) {
							// Событие с данными и callback
							listener.call(this, packet.data, ackWrapper);
						} else {
							// Событие без данных, только callback
							listener.call(this, ackWrapper);
						}
					} catch (error) {
						if (!isProduction) {
							console.error(`[Socket] Error in ACK event handler for ${packet.event}:`, error);
						}
						ackWrapper({ error: 'Internal server error' });
					}
					return;
				} else {
					if (!isProduction) {
						console.warn(`[Socket] No handler for ACK event: ${packet.event}`);
					}

					try {
						const ackResponse = SocketParser.encodeAckResponse(
							packet.ackId!,
							{
								error: `No handler for event: ${packet.event}`,
							},
							this.nsp,
						);
						this.ws.send(ackResponse);
					} catch (error) {
						if (!isProduction) {
							console.error(`[Socket] Failed to send error ACK:`, error);
						}
					}
					return;
				}
			}

			// ИСПРАВЛЕНО: Обычное событие без ACK - используем super.emit для EventEmitter
			if (!isProduction) {
				console.log(`[Socket] Emitting regular event: ${packet.event}`);
			}

			if (packet.data !== undefined) {
				super.emit(packet.event, packet.data);
			} else {
				super.emit(packet.event);
			}
		} catch (error) {
			if (!isProduction) {
				console.error(`[Socket] Error handling packet ${packet.event}:`, error);
			}
		}
	}

	/**
	 * Must be disbanded and deleted
	 */
	_handleAck(ackId: string, data: any): void {
		if (!isProduction) {
			console.log(`[Socket] Handling ACK ${ackId} with data:`, data);
		}

		const ackData = this.acks.get(ackId);
		if (ackData) {
			// Очищаем timeout
			clearTimeout(ackData.timeoutId);
			// Удаляем из Map
			this.acks.delete(ackId);

			// Извлекаем данные из Socket.IO массива
			const responseData = Array.isArray(data) && data.length > 0 ? data[0] : data;

			// Выполняем callback
			try {
				ackData.callback(responseData);
			} catch (error) {
				if (!isProduction) {
					console.warn(`[Socket] Error in ACK callback:`, error);
				}
			}
		}
	}

	/**
	 * Must be disbanded and deleted
	 */
	private cleanupAck(ackId?: string): void {
		if (!ackId) return;

		const ackData = this.acks.get(ackId);
		if (ackData) {
			clearTimeout(ackData.timeoutId);
			this.acks.delete(ackId);
		}
	}

	/**
	 * Must be disbanded and deleted
	 */
	_handleClose(reason: DisconnectReason): void {
		this.stopHeartbeat();
		if (this._connected) {
			this._connected = false;
			this.leaveAll();

			// Очищаем все ACK callbacks перед эмитом disconnect
			for (const [ackId, ackData] of this.acks) {
				clearTimeout(ackData.timeoutId);
				try {
					ackData.callback(new Error('Socket disconnected'));
				} catch (error) {
					// Ignore callback errors during disconnect
				}
			}
			this.acks.clear();

			this.nsp.removeSocket(this);
			super.emit('disconnect', reason);
		}
	}

	/**
	 * Must be disbanded and deleted
	 */
	_handleError(error: Error): void {
		super.emit('error', error);
	}

	/**
	 * Must be disbanded and deleted
	 */
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
}
