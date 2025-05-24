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
} from '../shared/types/socket.types';
import type { Socket } from './socket';

export interface ServerReservedEvents<
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
	new_namespace: (
		namespace: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
	) => void;
}

type MiddlewareFn<SocketData> = (socket: any, next: (err?: Error) => void) => void;

/**
 * Main Socket.IO Server class with full TypeScript support
 */
export class SocketServer<
	// Events received from clients
	ListenEvents extends EventsMap = ClientToServerEvents,
	// Events sent to clients
	EmitEvents extends EventsMap = ServerToClientEvents,
	// Inter-server events
	ServerSideEvents extends EventsMap = InterServerEvents,
	// Socket data type
	SocketData extends DefaultSocketData = DefaultSocketData
> extends EventEmitter {
	private namespaces: Map<
		string,
		Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
	> = new Map();
	private bunServer?: BunServer;

	constructor() {
		super();
	}

	get sockets(): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
		return this.of('/');
	}

	/**
	 * Set Bun server instance for publishing
	 */
	setBunServer(server: BunServer): void {
		this.bunServer = server;
	}

	/**
	 * Publish message using Bun's native pub/sub
	 */
	publish(topic: string, message: string | Uint8Array): boolean {
		if (!this.bunServer) {
			console.warn('[SocketServer] Bun server not set, cannot publish');
			return false;
		}
		return <ServerWebSocketSendStatus>this.bunServer.publish(topic, message) > 0;
	}

	/**
	 * Get or create namespace with full typing
	 */
	of<
		NSListenEvents extends EventsMap = ListenEvents,
		NSEmitEvents extends EventsMap = EmitEvents,
		NSServerSideEvents extends EventsMap = ServerSideEvents,
		NSSocketData extends SocketData = SocketData
	>(name: string): Namespace<NSListenEvents, NSEmitEvents, NSServerSideEvents, NSSocketData> {
		if (name === '' || name === undefined) {
			name = '/';
		}
		if (name[0] !== '/') {
			name = '/' + name;
		}

		let namespace = this.namespaces.get(name) as Namespace<
			NSListenEvents,
			NSEmitEvents,
			NSServerSideEvents,
			NSSocketData
		>;

		if (!namespace) {
			namespace = new Namespace<
				NSListenEvents,
				NSEmitEvents,
				NSServerSideEvents,
				NSSocketData
			>(this, name);

			this.namespaces.set(name, namespace as any);

			// ИСПРАВЛЕНИЕ: Пробрасываем события с namespace на server для дефолтного namespace
			if (name === '/') {
				namespace.on('connection', (socket) => {
					console.log(
						`[SocketServer] Forwarding connection event for socket ${socket.id}`
					);
					this.emit('connection', socket);
					this.emit('connect', socket);
				});

				namespace.on('disconnect', (socket, reason) => {
					console.log(
						`[SocketServer] Forwarding disconnect event for socket ${socket.id}`
					);
					this.emit('disconnect', socket, reason);
				});
			}

			if (name !== '/') {
				this.emit('new_namespace', namespace);
			}
		}

		return namespace;
	}

	/**
	 * Add middleware to default namespace
	 */
	use(fn: MiddlewareFn<SocketData>): this {
		this.sockets.use(fn);
		return this;
	}

	/**
	 * Typed event listeners with proper overloads
	 */
	override on(
		event: 'connect' | 'connection',
		listener: (socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>) => void
	): this;
	override on(
		event: 'disconnect',
		listener: (
			socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
			reason: string
		) => void
	): this;
	override on(
		event: 'new_namespace',
		listener: (
			namespace: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
		) => void
	): this;
	override on<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this {
		// ИСПРАВЛЕНИЕ: Не пробрасываем на sockets, так как это создаёт путаницу
		// События регистрируются только на server-уровне
		return super.on(event as string, listener);
	}

	/**
	 * Typed once listeners with proper overloads
	 */
	override once(event: 'connect' | 'connection', listener: (socket: any) => void): this;
	override once(event: 'disconnect', listener: (socket: any, reason: string) => void): this;
	override once(
		event: 'new_namespace',
		listener: (
			namespace: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
		) => void
	): this;
	override once<Ev extends keyof ListenEvents>(event: Ev, listener: ListenEvents[Ev]): this {
		return super.once(event as string, listener);
	}

	/**
	 * Target specific room(s) for broadcasting
	 */
	to(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.to(room);
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.in(room);
	}

	/**
	 * Exclude specific room(s) or socket(s)
	 */
	except(room: Room | Room[]): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.except(room);
	}

	/**
	 * Typed emit to all sockets in namespace with proper overloads
	 */
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

	/**
	 * Send message to all sockets
	 */
	send(...args: any[]): this {
		this.sockets.send(...args);
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
		return this.sockets.compress(compress);
	}

	/**
	 * Set volatile flag for next emission
	 */
	get volatile(): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.volatile;
	}

	/**
	 * Set local flag for next emission
	 */
	get local(): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.local;
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator<EmitEvents, SocketData> {
		return this.sockets.timeout(timeout);
	}

	/**
	 * Get all sockets in default namespace
	 */
	fetchSockets(): Promise<any[]> {
		return this.sockets.fetchSockets();
	}

	/**
	 * Make all sockets join room(s)
	 */
	socketsJoin(room: Room | Room[]): void {
		this.sockets.socketsJoin(room);
	}

	/**
	 * Make all sockets leave room(s)
	 */
	socketsLeave(room: Room | Room[]): void {
		this.sockets.socketsLeave(room);
	}

	/**
	 * Disconnect all sockets
	 */
	disconnectSockets(close: boolean = false): void {
		this.sockets.disconnectSockets(close);
	}

	/**
	 * Close server and all namespaces
	 */
	close(): void {
		for (const namespace of this.namespaces.values()) {
			namespace.disconnectSockets(true);
			namespace.adapter.close();
		}
		this.namespaces.clear();
		this.removeAllListeners();
	}

	/**
	 * Get namespace by name
	 */
	getNamespace(
		name: string
	): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> | undefined {
		return this.namespaces.get(name);
	}

	/**
	 * Get all namespace names
	 */
	getNamespaceNames(): string[] {
		return Array.from(this.namespaces.keys());
	}

	/**
	 * Get total number of connected sockets across all namespaces
	 */
	get socketsCount(): number {
		let total = 0;
		for (const namespace of this.namespaces.values()) {
			total += namespace.socketsCount;
		}
		return total;
	}
}

// Create typed singleton instance
export const io = new SocketServer<
	ClientToServerEvents,
	ServerToClientEvents,
	InterServerEvents,
	DefaultSocketData
>();
