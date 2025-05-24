import { EventEmitter } from 'events';
import type { Server as BunServer, ServerWebSocketSendStatus } from 'bun';
import { Namespace } from './namespace';
import { BroadcastOperator } from './broadcast';
import type {
	ServerToClientEvents,
	ClientToServerEvents,
	Room,
	AckCallback,
} from '../shared/types/socket.types';

export interface ServerReservedEvents {
	connect: (socket: any) => void;
	connection: (socket: any) => void;
	disconnect: (socket: any, reason: string) => void;
	new_namespace: (namespace: Namespace) => void;
}

type MiddlewareFn = (socket: any, next: (err?: Error) => void) => void;

/**
 * Main Socket.IO Server class
 */
export class SocketServer extends EventEmitter {
	public readonly sockets: Namespace;
	private namespaces: Map<string, Namespace> = new Map();
	private bunServer?: BunServer;

	constructor() {
		super();

		// Create default namespace
		this.sockets = this.of('/');
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
		const res: ServerWebSocketSendStatus = this.bunServer.publish(topic, message);
		return res > 0;
	}

	/**
	 * Get or create namespace
	 */
	of(name: string): Namespace {
		if (name === '' || name === undefined) {
			name = '/';
		}
		if (name[0] !== '/') {
			name = '/' + name;
		}

		let namespace = this.namespaces.get(name);
		if (!namespace) {
			namespace = new Namespace(this, name);
			this.namespaces.set(name, namespace);

			// Forward events from namespace to server
			namespace.on('connect', (socket) => {
				this.emit('connect', socket);
				this.emit('connection', socket);
			});

			namespace.on('disconnect', (socket, reason) => {
				this.emit('disconnect', socket, reason);
			});

			if (name !== '/') {
				this.emit('new_namespace', namespace);
			}
		}

		return namespace;
	}

	/**
	 * Add middleware to default namespace
	 */
	use(fn: MiddlewareFn): this {
		this.sockets.use(fn);
		return this;
	}

	/**
	 * Listen for connections on event
	 */
	on(event: 'connect' | 'connection', listener: (socket: any) => void): this;
	on(event: 'disconnect', listener: (socket: any, reason: string) => void): this;
	on(event: 'new_namespace', listener: (namespace: Namespace) => void): this;
	on(event: string, listener: (...args: any[]) => void): this {
		if (event === 'connect' || event === 'connection') {
			this.sockets.on(event, listener);
		} else {
			super.on(event, listener);
		}
		return this;
	}

	/**
	 * Target specific room(s) for broadcasting
	 */
	to(room: Room | Room[]): BroadcastOperator {
		return this.sockets.to(room);
	}

	/**
	 * Target specific room(s) - alias for to()
	 */
	in(room: Room | Room[]): BroadcastOperator {
		return this.sockets.in(room);
	}

	/**
	 * Exclude specific room(s) or socket(s)
	 */
	except(room: Room | Room[]): BroadcastOperator {
		return this.sockets.except(room);
	}

	/**
	 * Emit to all sockets in default namespace
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
		return this.sockets.emit(event, dataOrArg, ack);
	}

	/**
	 * Send message to all sockets
	 */
	send(data: any): this {
		this.sockets.send(data);
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
		return this.sockets.compress(compress);
	}

	/**
	 * Set volatile flag for next emission
	 */
	get volatile(): BroadcastOperator {
		return this.sockets.volatile;
	}

	/**
	 * Set local flag for next emission
	 */
	get local(): BroadcastOperator {
		return this.sockets.local;
	}

	/**
	 * Set timeout for acknowledgements
	 */
	timeout(timeout: number): BroadcastOperator {
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
		super.removeAllListeners();
	}

	/**
	 * Get namespace by name
	 */
	getNamespace(name: string): Namespace | undefined {
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

// Create singleton instance
export const io = new SocketServer();
