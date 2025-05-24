import { EventEmitter } from 'events';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import { Socket } from './socket';
import { BroadcastOperator } from './broadcast';
import { Adapter } from './adapter';
import type {
	ServerToClientEvents,
	ClientToServerEvents,
	SocketId,
	Room,
	Handshake,
	AckCallback,
	EventsMap,
	DefaultEventsMap,
	SocketData as DefaultSocketData,
} from '../shared/types/socket.types';

type MiddlewareFn<
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap,
	SocketData extends DefaultSocketData
> = (
	socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
	next: (err?: Error) => void
) => void;

/**
 * Namespace represents a pool of sockets connected under a given scope
 */
export class Namespace<
	ListenEvents extends EventsMap = ClientToServerEvents,
	EmitEvents extends EventsMap = ServerToClientEvents,
	ServerSideEvents extends EventsMap = DefaultEventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData
> extends EventEmitter {
	public readonly name: string;
	public readonly sockets: Map<
		SocketId,
		Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
	> = new Map();
	public readonly adapter: Adapter<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;

	private middlewares: MiddlewareFn<ListenEvents, EmitEvents, ServerSideEvents, SocketData>[] =
		[];
	private _ids: number = 0;

	constructor(public readonly server: any, name: string) {
		super();
		this.name = name;
		this.adapter = new Adapter<ListenEvents, EmitEvents, ServerSideEvents, SocketData>(this);
	}

	use(fn: MiddlewareFn<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): this {
		this.middlewares.push(fn);
		return this;
	}

	// ИСПРАВЛЕНИЕ: Упрощаем override методы для лучшей совместимости
	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	async handleConnection(
		ws: ServerWebSocket<WSContext>,
		user: any,
		session: any
	): Promise<Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> {
		const socketId = user?.id || this.generateSocketId();

		const handshake: Handshake = {
			headers: {},
			time: new Date().toISOString(),
			address: ws.remoteAddress || 'unknown',
			xdomain: false,
			secure: true,
			issued: Date.now(),
			url: '/',
			query: {},
			auth: { user, session },
		};

		const socket = new Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>(
			socketId,
			ws,
			this,
			handshake
		);

		// Run middlewares
		await this.runMiddlewares(socket);

		// Add to namespace
		this.sockets.set(socketId, socket);
		this.adapter.addSocket(socketId, socketId);

		// Subscribe to namespace topic
		ws.subscribe(`namespace:${this.name}`);

		if (process.env.NODE_ENV === 'development') {
			console.log(`[Namespace] Socket ${socketId} added to namespace ${this.name}`);
		}

		return socket;
	}

	removeSocket(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
		if (this.sockets.has(socket.id)) {
			this.sockets.delete(socket.id);
			this.adapter.removeSocketFromAllRooms(socket.id);
			this.emit('disconnect', socket, 'transport close');
		}
	}

	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).to(room);
	}

	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.to(room);
	}

	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).except(room);
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
		// ИСПРАВЛЕНИЕ: Проверяем специальные события namespace
		if (event === 'connection' || event === 'connect' || event === 'disconnect') {
			return super.emit(event as string, dataOrArg);
		}

		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(
			event as any,
			dataOrArg,
			ack
		);
	}

	send(...args: Parameters<EmitEvents[any]>): this {
		this.emit('message' as any, ...args);
		return this;
	}

	write(...args: Parameters<EmitEvents[any]>): this {
		return this.send(...args);
	}

	compress(compress: boolean): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).compress(compress);
	}

	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).volatile;
	}

	get local(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).local;
	}

	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).timeout(timeout);
	}

	fetchSockets(): Promise<Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>[]> {
		return Promise.resolve(Array.from(this.sockets.values()));
	}

	socketsJoin(room: Room | Room[]): void {
		new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsJoin(room);
	}

	socketsLeave(room: Room | Room[]): void {
		new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsLeave(room);
	}

	disconnectSockets(close: boolean = false): void {
		new BroadcastOperator<EmitEvents, SocketData>(this.adapter).disconnectSockets(close);
	}

	get socketsCount(): number {
		return this.sockets.size;
	}

	private async runMiddlewares(
		socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
	): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.middlewares.length === 0) {
				return resolve();
			}

			let index = 0;

			const next = (err?: Error) => {
				if (err) {
					return reject(err);
				}

				if (index >= this.middlewares.length) {
					return resolve();
				}

				const middleware = this.middlewares[index++];
				try {
					middleware!(socket, next);
				} catch (error) {
					reject(error);
				}
			};

			next();
		});
	}

	private generateSocketId(): string {
		return `${this.name.replace('/', '')}_${Date.now()}_${this._ids++}`;
	}
}
