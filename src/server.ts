import { EventEmitter } from 'events';
import type { Server as BunServer, ServerWebSocketSendStatus } from 'bun';
import { Namespace } from './namespace';
import { BroadcastOperator } from './broadcast';
import type {
	ServerToClientEvents,
	ClientToServerEvents,
	InterServerEvents,
	SocketData as DefaultSocketData,
	EventsMap,
	DefaultEventsMap,
	Room,
	AckCallback,
} from '../types/socket.types';
import type { Socket } from './socket';
import type { Context } from 'hono';
import { Connection } from './connection';
import type { Client } from './client';

const isProduction = process.env.NODE_ENV === 'production';

type MiddlewareFn<SocketData> = (socket: any, next: (err?: Error) => void) => void;

interface ServerOptions {
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
	SocketData extends DefaultSocketData = DefaultSocketData
> extends EventEmitter {
	private engine?: BunServer;
	private clients: Map<string, Client> = new Map();
	public readonly sockets: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	private _nsps: Map<string, Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> =
		new Map();

	private readonly opts: Partial<ServerOptions>;
	public pingInterval: number = 25000;
	public pingTimeout: number = 20000;
	public maxPayload: number = 1000000;

	constructor(
		opts: Partial<ServerOptions> = {
			pingInterval: 25000,
			pingTimeout: 20000,
			maxPayload: 1000000,
		}
	) {
		super();
		this.opts = opts;
		this.sockets = this.of('/');
	}

	get _opts() {
		return this.opts;
	}

	attach(server: BunServer): void {
		this.engine = server;
	}

	publish(topic: string, message: string | Uint8Array): boolean {
		if (!this.engine) {
			console.warn('[SocketServer] Bun server not set, cannot publish');
			return false;
		}
		return <ServerWebSocketSendStatus>this.engine.publish(topic, message) > 0;
	}

	of(
		name: string,
		fn?: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void
	): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		if (String(name)[0] !== '/') name = '/' + name;

		let nsp = this._nsps.get(name);

		if (!nsp) {
			nsp = new Namespace(this, name);
			this._nsps.set(name, nsp as any);

			if (name === '/') {
				nsp.on('connection', (socket: Socket) => {
					// Используем setImmediate чтобы убедиться что все listeners зарегистрированы
					setImmediate(() => {
						super.emit('connection', socket);
						super.emit('connect', socket);
					});
				});

				nsp.on('disconnect', (socket: Socket, reason) => {
					setImmediate(() => {
						super.emit('disconnect', socket, reason);
					});
				});
			}

			if (name !== '/') {
				this.emit('new_namespace', nsp);
			}
		}
		if (fn) nsp.on('connect', fn);
		return nsp;
	}

	use(fn: MiddlewareFn<SocketData>): this {
		this.sockets.use(fn);
		return this;
	}

	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
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

	emit<Ev extends keyof EmitEvents>(event: Ev, ...args: Parameters<EmitEvents[Ev]>): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	emit<Ev extends keyof EmitEvents>(
		event: Ev,
		dataOrArg?: Parameters<EmitEvents[Ev]>[0],
		ack?: AckCallback
	): boolean {
		return this.sockets.emit(event, dataOrArg, ack);
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
		for (const namespace of this._nsps.values()) {
			namespace.disconnectSockets(true);
			namespace.adapter.close();
		}
		this._nsps.clear();
		this.removeAllListeners();
	}

	getNamespace(
		name: string
	): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> | undefined {
		return this._nsps.get(name);
	}

	getNamespaceNames(): string[] {
		return Array.from(this._nsps.keys());
	}

	get socketsCount(): number {
		let total = 0;
		for (const namespace of this._nsps.values()) {
			total += namespace.socketsCount;
		}
		return total;
	}

	/** @private */
	onconnection(c: Context, data?: SocketData): Connection {
		// @ts-ignore
		return new Connection<ListenEvents, EmitEvents, ServerSideEvents, SocketData>(
			this,
			c,
			data
		);
	}
}
