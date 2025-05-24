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
} from '../shared/types/socket.types';

export interface NamespaceReservedEvents {
	connect: (socket: Socket) => void;
	connection: (socket: Socket) => void;
	disconnect: (socket: Socket, reason: string) => void;
}

type MiddlewareFn = (socket: Socket, next: (err?: Error) => void) => void;

/**
 * Namespace represents a pool of sockets connected under a given scope
 */
export class Namespace extends EventEmitter {
	public readonly name: string;
	public readonly sockets: Map<SocketId, Socket> = new Map();
	public readonly adapter: Adapter;

	private middlewares: MiddlewareFn[] = [];
	private _ids: number = 0;

	constructor(public readonly server: any, name: string) {
		super();
		this.name = name;
		this.adapter = new Adapter(this);
	}

	/**
	 * Add middleware to namespace
	 */
	use(fn: MiddlewareFn): this {
		this.middlewares.push(fn);
		return this;
	}

	/**
	 * Handle new socket connection
	 */
	async handleConnection(
		ws: ServerWebSocket<WSContext>,
		user: any,
		session: any
	): Promise<Socket> {
		const socketId = user.id || this.generateSocketId();

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

		const socket = new Socket(socketId, ws, this, handshake);

		// Run middlewares
		await this.runMiddlewares(socket);

		// Add to namespace
		this.sockets.set(socketId, socket);
		this.adapter.addSocket(socketId, socketId); // Add to own room

		// Subscribe to namespace topic
		ws.subscribe(`namespace:${this.name}`);

		this.emit('connect', socket);
		this.emit('connection', socket);

		return socket;
	}

	/**
	 * Remove socket from namespace
	 */
	removeSocket(socket: Socket): void {
		if (this.sockets.has(socket.id)) {
			this.sockets.delete(socket.id);
			this.adapter.removeSocketFromAllRooms(socket.id);
			this.emit('disconnect', socket, 'transport close');
		}
	}

	/**
	 * Target specific room(s) for broadcasting
	 */
	to(room: Room | Room[]): BroadcastOperator {
		return new BroadcastOperator(this.adapter).to(room);
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator {
		return this.to(room);
	}

	/**
	 * Exclude specific room(s) or socket(s)
	 */
	except(room: Room | Room[]): BroadcastOperator {
		return new BroadcastOperator(this.adapter).except(room);
	}

	/**
	 * Emit to all sockets in namespace
	 */
	emit<K extends keyof ServerToClientEvents>(
		event: K,
		...args: Parameters<ServerToClientEvents[K]>
	): boolean;
	emit<K extends keyof ServerToClientEvents>(
		event: K,
		data: Parameters<ServerToClientEvents[K]>[0],
		ack?: AckCallback
	): boolean;
	emit<K extends keyof ServerToClientEvents>(
		event: K,
		dataOrArg?: any,
		ack?: AckCallback
	): boolean {
		return new BroadcastOperator(this.adapter).emit(event, dataOrArg, ack);
	}

	/**
	 * Send message to all sockets
	 */
	send(data: any): this {
		this.emit('message' as any, data);
		return this;
	}

	/**
	 * Write message to all sockets - alias for send
	 */
	write(data: any): this {
		return this.send(data);
	}

	/**
	 * Set compress flag for next emission
	 */
	compress(compress: boolean): BroadcastOperator {
		return new BroadcastOperator(this.adapter).compress(compress);
	}

	/**
	 * Set volatile flag for next emission
	 */
	get volatile(): BroadcastOperator {
		return new BroadcastOperator(this.adapter).volatile;
	}

	/**
	 * Set local flag for next emission
	 */
	get local(): BroadcastOperator {
		return new BroadcastOperator(this.adapter).local;
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator {
		return new BroadcastOperator(this.adapter).timeout(timeout);
	}

	/**
	 * Get all sockets in namespace
	 */
	fetchSockets(): Promise<Socket[]> {
		return Promise.resolve(Array.from(this.sockets.values()));
	}

	/**
	 * Make all sockets join room(s)
	 */
	socketsJoin(room: Room | Room[]): void {
		new BroadcastOperator(this.adapter).socketsJoin(room);
	}

	/**
	 * Make all sockets leave room(s)
	 */
	socketsLeave(room: Room | Room[]): void {
		new BroadcastOperator(this.adapter).socketsLeave(room);
	}

	/**
	 * Disconnect all sockets
	 */
	disconnectSockets(close: boolean = false): void {
		new BroadcastOperator(this.adapter).disconnectSockets(close);
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
	private async runMiddlewares(socket: Socket): Promise<void> {
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
