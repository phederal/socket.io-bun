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

const isProduction = process.env.NODE_ENV === 'production';

type MiddlewareFn<SocketData> = (socket: any, next: (err?: Error) => void) => void;

/**
 * Main Socket.IO Server class with full TypeScript support
 */
export class SocketServer<
	ListenEvents extends EventsMap = ClientToServerEvents,
	EmitEvents extends EventsMap = ServerToClientEvents,
	ServerSideEvents extends EventsMap = InterServerEvents,
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

	setBunServer(server: BunServer): void {
		this.bunServer = server;
	}

	publish(topic: string, message: string | Uint8Array): boolean {
		if (!this.bunServer) {
			if (!isProduction) {
				console.warn('[SocketServer] Bun server not set, cannot publish');
			}
			return false;
		}
		return <ServerWebSocketSendStatus>this.bunServer.publish(topic, message) > 0;
	}

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

			// ИСПРАВЛЕНИЕ: Правильное пробрасывание событий для дефолтного namespace
			if (name === '/') {
				namespace.on('connection', (socket) => {
					if (!isProduction) {
						console.log(
							`[SocketServer] Forwarding connection event for socket ${socket.id} to server`
						);
					}
					// Используем setImmediate чтобы убедиться что все listeners зарегистрированы
					setImmediate(() => {
						super.emit('connection', socket);
						super.emit('connect', socket);
					});
				});

				namespace.on('disconnect', (socket, reason) => {
					if (!isProduction) {
						console.log(
							`[SocketServer] Forwarding disconnect event for socket ${socket.id} to server`
						);
					}
					setImmediate(() => {
						super.emit('disconnect', socket, reason);
					});
				});
			}

			if (name !== '/') {
				this.emit('new_namespace', namespace);
			}
		}

		return namespace;
	}

	use(fn: MiddlewareFn<SocketData>): this {
		this.sockets.use(fn);
		return this;
	}

	// ИСПРАВЛЕНИЕ: Упрощаем типизацию для совместимости
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

	send(...args: any[]): this {
		this.sockets.send(...args);
		return this;
	}

	write(...args: any[]): this {
		return this.send(...args);
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
		for (const namespace of this.namespaces.values()) {
			namespace.disconnectSockets(true);
			namespace.adapter.close();
		}
		this.namespaces.clear();
		this.removeAllListeners();
	}

	getNamespace(
		name: string
	): Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> | undefined {
		return this.namespaces.get(name);
	}

	getNamespaceNames(): string[] {
		return Array.from(this.namespaces.keys());
	}

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
