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

export interface NamespaceReservedEvents<
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap,
	SocketData extends DefaultSocketData
> {
	connect: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
	connection: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void;
	disconnect: (
		socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		reason: string
	) => void;
}

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

	/**
	 * Add middleware to namespace
	 */
	use(fn: MiddlewareFn<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): this {
		this.middlewares.push(fn);
		return this;
	}

	/**
	 * Typed event listeners with proper overloads
	 */
	override on<
		Ev extends keyof NamespaceReservedEvents<
			ListenEvents,
			EmitEvents,
			ServerSideEvents,
			SocketData
		>
	>(
		event: Ev,
		listener: NamespaceReservedEvents<
			ListenEvents,
			EmitEvents,
			ServerSideEvents,
			SocketData
		>[Ev]
	): this;
	override on<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this;
	override on(event: string, listener: (...args: any[]) => void): this;
	override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	/**
	 * Typed once listeners with proper overloads
	 */
	override once<
		Ev extends keyof NamespaceReservedEvents<
			ListenEvents,
			EmitEvents,
			ServerSideEvents,
			SocketData
		>
	>(
		event: Ev,
		listener: NamespaceReservedEvents<
			ListenEvents,
			EmitEvents,
			ServerSideEvents,
			SocketData
		>[Ev]
	): this;
	override once<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this;
	override once(event: string, listener: (...args: any[]) => void): this;
	override once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	/**
	 * Handle new socket connection
	 */
	async handleConnection(
		ws: ServerWebSocket<WSContext>,
		user: any,
		session: any
	): Promise<Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> {
		const socketId = user?.id || this.generateSocketId();

		const handshake: Handshake = {
			headers: {}, // Add headers from request if needed
			time: new Date().toISOString(),
			address: ws.remoteAddress || 'unknown',
			xdomain: false,
			secure: true, // Assuming HTTPS
			issued: Date.now(),
			url: '/', // Add actual URL if needed
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
		this.adapter.addSocket(socketId, socketId); // Add to own room

		// Subscribe to namespace topic
		ws.subscribe(`namespace:${this.name}`);

		this.emit('connect', socket);
		this.emit('connection', socket);
		// EventEmitter.prototype.emit.call(this, 'connect', socket);
		// EventEmitter.prototype.emit.call(this, 'connection', socket);

		return socket;
	}

	/**
	 * Remove socket from namespace
	 */
	removeSocket(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
		if (this.sockets.has(socket.id)) {
			this.sockets.delete(socket.id);
			this.adapter.removeSocketFromAllRooms(socket.id);
			this.emit('disconnect', socket, 'transport close');
		}
	}

	/**
	 * Target specific room(s) for broadcasting
	 */
	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).to(room);
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.to(room);
	}

	/**
	 * Exclude specific room(s) or socket(s)
	 */
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).except(room);
	}

	/**
	 * Typed emit to all sockets in namespace with proper overloads
	 */
	override emit<Ev extends keyof EmitEvents>(
		event: Ev,
		...args: Parameters<EmitEvents[Ev]>
	): boolean;
	override emit<Ev extends keyof EmitEvents>(
		event: Ev,
		data: Parameters<EmitEvents[Ev]>[0],
		ack: AckCallback
	): boolean;
	override emit<Ev extends keyof EmitEvents>(event: Ev, ack: AckCallback): boolean;
	override emit(event: string | symbol, ...args: any[]): boolean;
	override emit<Ev extends keyof EmitEvents>(
		event: Ev | string | symbol,
		dataOrArg?: any,
		ack?: AckCallback
	): boolean {
		if (
			event === 'connect' ||
			event === 'connection' ||
			event === 'disconnect' ||
			event === 'disconnecting'
		) {
			return EventEmitter.prototype.emit.call(this, event, dataOrArg);
		}

		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(
			event as any,
			dataOrArg,
			ack
		);
	}

	/**
	 * Send message to all sockets
	 */
	send(...args: any[]): this {
		this.emit('message' as any, ...args);
		return this;
	}

	/**
	 * Write message to all sockets - alias for send
	 */
	write(...args: any[]): this {
		return this.send(...args);
	}

	/**
	 * Set compress flag for next emission
	 */
	compress(compress: boolean): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).compress(compress);
	}

	/**
	 * Set volatile flag for next emission
	 */
	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).volatile;
	}

	/**
	 * Set local flag for next emission
	 */
	get local(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).local;
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).timeout(timeout);
	}

	/**
	 * Get all sockets in namespace
	 */
	fetchSockets(): Promise<Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>[]> {
		return Promise.resolve(Array.from(this.sockets.values()));
	}

	/**
	 * Make all sockets join room(s)
	 */
	socketsJoin(room: Room | Room[]): void {
		new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsJoin(room);
	}

	/**
	 * Make all sockets leave room(s)
	 */
	socketsLeave(room: Room | Room[]): void {
		new BroadcastOperator<EmitEvents, SocketData>(this.adapter).socketsLeave(room);
	}

	/**
	 * Disconnect all sockets
	 */
	disconnectSockets(close: boolean = false): void {
		new BroadcastOperator<EmitEvents, SocketData>(this.adapter).disconnectSockets(close);
	}

	/**
	 * Get number of connected sockets
	 */
	get socketsCount(): number {
		return this.sockets.size;
	}

	/**
	 * Run middlewares for socket
	 */
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

	/**
	 * Generate unique socket ID
	 */
	private generateSocketId(): string {
		return `${this.name.replace('/', '')}_${Date.now()}_${this._ids++}`;
	}
}
