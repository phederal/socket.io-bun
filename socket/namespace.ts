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
} from '../types/socket.types';

const isProduction = process.env.NODE_ENV === 'production';

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
 * Обновлен под новый унифицированный Socket API
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

		if (!isProduction) {
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

	/**
	 * Binary broadcast operator
	 */
	get binary(): BroadcastOperator<EmitEvents, SocketData> {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).binary;
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
		// Специальные события namespace
		if (event === 'connection' || event === 'connect' || event === 'disconnect') {
			return super.emit(event as string, dataOrArg);
		}

		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emit(
			event as any,
			dataOrArg,
			ack
		);
	}

	/**
	 * Emit с принудительным использованием бинарного формата
	 */
	emitBinary<Ev extends keyof EmitEvents>(
		event: Ev,
		data?: Parameters<EmitEvents[Ev]>[0]
	): boolean {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).binary.emit(
			event,
			data as any
		);
	}

	/**
	 * Быстрый emit для namespace
	 */
	emitFast<Ev extends keyof EmitEvents>(
		event: Ev,
		data?: Parameters<EmitEvents[Ev]>[0]
	): boolean {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emitFast(event, data);
	}

	/**
	 * Batch operations для массовых операций
	 */
	emitBatch<Ev extends keyof EmitEvents>(
		operations: Array<{
			event: Ev;
			data?: Parameters<EmitEvents[Ev]>[0];
			rooms?: Room | Room[];
			binary?: boolean;
		}>
	): number {
		return new BroadcastOperator<EmitEvents, SocketData>(this.adapter).emitBatch(operations);
	}

	/**
	 * Emit с ACK для namespace
	 */
	emitWithAck<Ev extends keyof EmitEvents>(
		event: Ev,
		data: Parameters<EmitEvents[Ev]>[0],
		callback: AckCallback,
		options?: {
			timeout?: number;
			priority?: 'low' | 'normal' | 'high';
			binary?: boolean;
		}
	): boolean {
		// Для namespace ACK мы отправляем всем сокетам и собираем ответы
		const targetSockets = this.adapter.getSockets();
		if (targetSockets.size === 0) {
			setTimeout(() => callback(null, []), 0);
			return true;
		}

		const responses: any[] = [];
		let responseCount = 0;
		let timedOut = false;
		const expectedResponses = targetSockets.size;
		const timeout = options?.timeout || 5000;

		const timer = setTimeout(() => {
			if (!timedOut) {
				timedOut = true;
				callback(new Error('Namespace broadcast acknowledgement timeout'), responses);
			}
		}, timeout);

		// Отправляем каждому сокету индивидуально
		for (const socketId of targetSockets) {
			const socket = this.sockets.get(socketId);
			if (socket) {
				socket.emitWithAck(
					event as string,
					data,
					(err: any, response: any) => {
						if (timedOut) return;

						if (err) {
							responses.push({ socketId, error: err.message || err });
						} else {
							responses.push({ socketId, data: response });
						}
						responseCount++;

						if (responseCount >= expectedResponses) {
							timedOut = true;
							clearTimeout(timer);
							callback(null, responses);
						}
					},
					{
						timeout: Math.floor(timeout * 0.8), // Немного меньше для individual sockets
						priority: options?.priority,
						binary: options?.binary,
					}
				);
			} else {
				// Socket не найден
				responses.push({ socketId, error: 'Socket not found' });
				responseCount++;

				if (responseCount >= expectedResponses) {
					timedOut = true;
					clearTimeout(timer);
					callback(null, responses);
				}
			}
		}

		return true;
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

	/**
	 * Получение статистики ACK для всех сокетов в namespace
	 */
	getAckStats() {
		const stats = {
			totalSockets: this.sockets.size,
			totalPendingAcks: 0,
			oldestAckAge: 0,
			socketsWithPendingAcks: 0,
		};

		for (const socket of this.sockets.values()) {
			const socketStats = socket.getAckStats();
			stats.totalPendingAcks += socketStats.total;
			if (socketStats.total > 0) {
				stats.socketsWithPendingAcks++;
				stats.oldestAckAge = Math.max(stats.oldestAckAge, socketStats.oldestAge);
			}
		}

		return stats;
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
