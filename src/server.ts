import debugModule from 'debug';
import base64id from 'base64id';
import { Namespace, type ServerReservedEventsMap } from './namespace';
import { BroadcastOperator } from './broadcast';
import { Connection } from './connection';
import { Adapter } from './adapter';
import * as parser from './socket.io-parser';
import { StrictEventEmitter } from '#types/typed-events';
import type { Server as BunServer, ServerWebSocketSendStatus } from 'bun';
import type { ServerToClientEvents, ClientToServerEvents, SocketData as DefaultSocketData, Room, AckCallback } from '../types/socket-types';
import type { EventsMap, DefaultEventsMap, RemoveAcknowledgements } from '#types/typed-events';
import type { Socket } from './socket';
import type { Context } from 'hono';
import type { Client } from './client';
import type { Encoder } from './socket.io-parser';

const debug = debugModule('socket.io:server');

const isProduction = process.env.NODE_ENV === 'production';

type MiddlewareFn<SocketData> = (socket: any, next: (err?: Error) => void) => void;

type AdapterConstructor = typeof Adapter | ((nsp: Namespace) => Adapter);

interface ServerOptions {
	path: string;
	adapter: AdapterConstructor;
	parser: typeof parser; // not any type
	pingInterval?: number;
	pingTimeout?: number;
	maxPayload?: number;
}

/**
 * Main Socket.IO Server class with full TypeScript support
 */
export class Server<
	ListenEvents extends EventsMap = ClientToServerEvents,
	EmitEvents extends EventsMap = ServerToClientEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData,
> extends StrictEventEmitter<
	/** strict typing */
	ServerSideEvents,
	RemoveAcknowledgements<EmitEvents>,
	ServerReservedEventsMap<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
> {
	private engine?: BunServer;
	readonly _parser: typeof parser;
	readonly encoder: Encoder;

	public readonly _nsps: Map<string, Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	public readonly _clients: Map<string, Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();

	private _path?: string;
	private _adapter?: AdapterConstructor;

	public readonly sockets: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	private readonly opts: Partial<ServerOptions>;

	constructor(
		opts: Partial<ServerOptions> = {
			pingInterval: 25000,
			pingTimeout: 20000,
			maxPayload: 1000000,
		},
	) {
		super();
		this._parser = opts.parser || parser;
		this.encoder = new this._parser.Encoder();
		this.path(opts.path || '/socket.io');
		this.adapter(opts.adapter || Adapter);
		this.sockets = this.of('/');
		this.opts = opts;
	}

	get _opts() {
		return this.opts;
	}

	/**
	 * Sets the adapter for rooms.
	 *
	 * @param v pathname
	 * @return self when setting or value when getting
	 */
	public adapter(): AdapterConstructor | undefined;
	public adapter(v: AdapterConstructor): this;
	public adapter(v?: AdapterConstructor): AdapterConstructor | undefined | this {
		if (!arguments.length) return this._adapter;
		this._adapter = v;
		for (const nsp of this._nsps.values()) {
			nsp._initAdapter();
		}
		return this;
	}

	/**
	 * Sets the client serving path.
	 *
	 * @param {String} v pathname
	 * @return {Server|String} self when setting or value when getting
	 */
	public path(v: string): this;
	public path(): string;
	public path(v?: string): this | string;
	public path(v?: string): this | string {
		if (!arguments.length) return this._path!;
		this._path = v!.replace(/\/$/, '');

		// const escapedPath = this._path.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
		// this.clientPathRegex = new RegExp('^' + escapedPath + '/socket\\.io(\\.msgpack|\\.esm)?(\\.min)?\\.js(\\.map)?(?:\\?|$)');
		return this;
	}

	attach(srv: BunServer, opts: Partial<ServerOptions> = {}): void {
		this.engine = srv;
	}

	listen(srv: BunServer, opts: Partial<ServerOptions> = {}): void {
		return this.attach(srv, opts);
	}

	publish(topic: string, message: string | Uint8Array): boolean {
		if (!this.engine) {
			console.warn('[SocketServer] Bun server not set, cannot publish');
			return false;
		}
		return <ServerWebSocketSendStatus>this.engine.publish(topic, message) > 0;
	}

	of(
		/** namespace */
		name: string,
		fn?: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void,
	): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		if (String(name)[0] !== '/') name = '/' + name;

		let nsp = this._nsps.get(name);

		if (!nsp) {
			nsp = new Namespace(this, name);
			this._nsps.set(name, nsp as any);

			if (name !== '/') {
				// @ts-ignore
				this.sockets.emitReserved('new_namespace', nsp);
			}
		}
		if (fn) nsp.on('connect', fn);
		return nsp;
	}

	use(fn: MiddlewareFn<SocketData>): this {
		this.sockets.use(fn);
		return this;
	}

	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.to(room);
	}

	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.in(room);
	}

	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.except(room);
	}

	send(...args: Parameters<EmitEvents[any]>): boolean {
		return this.sockets.send(...args);
	}

	write(...args: Parameters<EmitEvents[any]>): boolean {
		return this.sockets.send(...args);
	}

	compress(compress: boolean): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.compress(compress);
	}

	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.volatile;
	}

	get local(): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.local;
	}

	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.timeout(timeout);
	}

	fetchSockets(): Promise<any[]> {
		return this.sockets.fetchSockets();
	}

	socketsJoin(room: Room | Room[]): void {
		this.sockets.socketsJoin(room);
	}

	socketsLeave(room: Room | Room[]): void {
		this.sockets.socketsLeave(room);
	}

	disconnectSockets(close: boolean = false): void {
		this.sockets.disconnectSockets(close);
	}

	close(): void {
		for (const nsp of this._nsps.values()) {
			nsp.disconnectSockets(true);
			nsp.adapter.close();
		}
		this._nsps.clear();
		this.removeAllListeners();
	}

	/** @private */
	onconnection(c: Context, data?: SocketData): Connection<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		return new Connection<ListenEvents, EmitEvents, ServerSideEvents, SocketData>(this.generateId(), this, c, data);
	}

	/**
	 * Create Engine.IO handshake response (v4.x compatible)
	 *
	 * @private
	 */
	public handshake(sid: string): string {
		const handshake = {
			sid,
			upgrades: ['websocket'],
			pingInterval: this._opts.pingInterval,
			pingTimeout: this._opts.pingTimeout,
			maxPayload: this._opts.maxPayload,
		};
		const response = '0' + JSON.stringify(handshake);
		return response;
	}

	private generateId() {
		return base64id.generateId();
	}
}
