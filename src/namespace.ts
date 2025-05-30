import debugModule from 'debug';
import { EventEmitter } from 'events';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import { Socket } from './socket';
import { BroadcastOperator } from './broadcast';
import { Adapter } from './adapter';
import { StrictEventEmitter } from '#types/typed-events';
import type { Server } from './server';

import type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketId,
	Room,
	Handshake,
	AckCallback,
	SocketData as DefaultSocketData,
} from '../types/socket-types';
import type {
	RemoveAcknowledgements,
	EventsMap,
	DefaultEventsMap,
	DecorateAcknowledgementsWithMultipleResponses,
	EventNamesWithoutAck,
	EventParams,
} from '#types/typed-events';
import type { Client } from './client';

const debug = debugModule('socket.io:namespace');

const isProduction = process.env.NODE_ENV === 'production';

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

type MiddlewareFn<ListenEvents extends EventsMap, EmitEvents extends EventsMap, ServerSideEvents extends EventsMap, SocketData extends DefaultSocketData> = (
	socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
	next: (err?: Error) => void,
) => void;

/**
 * Namespace represents a pool of sockets connected under a given scope
 * Обновлен под новый унифицированный Socket API
 */
export class Namespace<
	ListenEvents extends EventsMap = ClientToServerEvents,
	EmitEvents extends EventsMap = ServerToClientEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData,
> extends StrictEventEmitter<
	/** strict typing */
	ServerSideEvents,
	RemoveAcknowledgements<EmitEvents>,
	NamespaceReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
> {
	public readonly name: string;
	public readonly sockets: Map<SocketId, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	// @ts-ignore
	public adapter: Adapter;
	readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;

	private _fns: Array<(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, next: (err?: ExtendedError) => void) => void> = [];

	/** @private */
	public _ids: number = 0;

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
		// @ts-ignore
		this.adapter = new (this.server.adapter()!)(this);
	}

	use(
		/** strict types */
		fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, next: (err?: ExtendedError) => void) => void,
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
	private run(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>, fn: (err?: ExtendedError) => void) {
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

	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).to(room);
	}

	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>(this.adapter).in(room);
	}

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
		client: Client<ListenEvents, EmitEvents, ServerSideEvents>,
		auth: Record<string, unknown>,
		fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void,
	) {
		debug('adding socket to nsp %s', this.name);
		const socket = await this._createSocket(client, auth);

		this.run(socket, (err) => {
			process.nextTick(() => {
				if (client.conn.readyState !== WebSocket.OPEN) {
					debug('next called after client was closed - ignoring socket');
					socket._cleanup();
					return;
				}

				if (err) {
					debug('middleware error, sending CONNECT_ERROR packet to the client');
					socket._cleanup();
					return socket._error({
						message: err.message,
						data: err.data,
					});
				}

				this._doConnect(socket, fn);
			});
		});
	}

	private async _createSocket(client: Client<ListenEvents, EmitEvents, ServerSideEvents>, auth: Record<string, unknown>) {
		return new Socket(this, client, auth);
	}

	private _doConnect(
		socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		fn: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void,
	) {
		this.sockets.set(socket.id, socket);
		this.adapter.addAll(socket.id, new Set([socket.id]));

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

	get binary(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).binary;
	}

	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).volatile;
	}

	get local(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).local;
	}

	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		// @ts-ignore // TODO: fix types on event
		return super.on(event, listener);
	}

	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		// @ts-ignore // TODO: fix types on event
		return super.once(event, listener);
	}

	// emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean {
	// 	if (event === 'connection' || event === 'connect' || event === 'disconnect') {
	// 		return super.emit(event, ...args);
	// 	}
	// 	return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(event, ...args);
	// }
	override emit<Ev extends EventNamesWithoutAck<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(ev, ...args);
	}

	emitWithAck<Ev extends EventNamesWithoutAck<EmitEvents>>(ev: Ev, ...args: EventParams<EmitEvents, Ev>): boolean {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(ev, ...args);
	}

	send(...args: Parameters<EmitEvents[any]>): boolean {
		return this.emit('message' as any, ...args);
	}

	write(...args: Parameters<EmitEvents[any]>): boolean {
		return this.emit('message' as any, ...args);
	}

	compress(compress: boolean): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).compress(compress);
	}

	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).timeout(timeout);
	}

	fetchSockets(): Promise<Socket<EmitEvents, SocketData>[]> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).fetchSockets();
	}

	socketsJoin(room: Room | Room[]): void {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsJoin(room);
	}

	socketsLeave(room: Room | Room[]): void {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsLeave(room);
	}

	disconnectSockets(close: boolean = false): void {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).disconnectSockets(close);
	}

	get socketsCount(): number {
		return this.sockets.size;
	}

	/** @private */
	_remove(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
		if (this.sockets.has(socket.id)) {
			this.sockets.delete(socket.id);
			this.adapter.delAll(socket.id);
		}
	}
}
