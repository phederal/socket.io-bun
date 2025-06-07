import { Hono } from 'hono';
import { io as clientIO, type Socket } from 'socket.io-client';

// imports for wsUpgrade
import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';
import { Server } from '../../src';
import type { SocketData } from '#types/socket-types';
import type { DefaultEventsMap } from '#types/typed-events';

export interface TestServerConfig {
	port?: number;
	hostname?: string;
	namespace?: string;
	auth?: Record<string, any>;
	tls?: boolean;
	pingTimeout?: number;
	pingInterval?: number;
	connectTimeout?: number;
}

export interface TestClientConfig {
	namespace?: string;
	transports?: string[];
	timeout?: number;
	autoConnect?: boolean;
}

export class TestEnvironment {
	private static portCounter = 8900;
	private readonly hostname: string;
	private readonly usesTLS: boolean;

	private io?: Server<any, any, DefaultEventsMap, SocketData>;
	private server?: Bun.Server;
	private serverUrl?: string;
	private clients: Socket[] = [];
	private pendingClients: Socket[] = [];
	private config: TestServerConfig = {};

	constructor(config: TestServerConfig = {}) {
		this.config = config;
		this.hostname = config.hostname || 'localhost';
		this.usesTLS = config.tls !== false;

		this.createServer = this.createServer.bind(this);
		this.createClient = this.createClient.bind(this);
		this.createClients = this.createClients.bind(this);
		this.createClientsAsync = this.createClientsAsync.bind(this);
		this.cleanup = this.cleanup.bind(this);
	}

	get testEnv() {
		return this;
	}

	async createServer(config: TestServerConfig = {}): Promise<typeof io> {
		this.cleanup(); // Clean up previous server if exists

		/**
		 * Create wsUpgrade (moved from ws.ts)
		 */
		// <Listen, Emit, Reserved, SocketData>
		this.io = new Server<any, any, DefaultEventsMap, SocketData>({
			pingTimeout: config.pingTimeout || this.config.pingTimeout || 10000,
			pingInterval: config.pingInterval || this.config.pingInterval || 5000,
			connectTimeout: config.connectTimeout || this.config.connectTimeout || 5000,
		});

		const io = this.io; // for use in this fn
		// Create WebSocket handler
		const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();
		// WebSocket upgrade handler
		const wsUpgrade = upgradeWebSocket((c: Context) => {
			const user = c.get('user');
			const session = c.get('session');

			if (!user || !session) {
				// TODO: create io.onerrorconnection for that situation
				return io.onconnection(c, {
					// @ts-ignore
					user: null,
					// @ts-ignore
					session: null,
					authFailure: true,
				});
			}

			return io.onconnection(c, {
				user,
				session,
			});
		});
		/** end file create wsUpgrade (moved from ws.ts) */

		const port = config.port || ++TestEnvironment.portCounter;
		const app = new Hono();

		// Middleware for authentication (custom socket data)
		app.use('/ws/*', async (c, next) => {
			const user = config.auth?.user === false ? null : 'user_test1';
			const session = config.auth?.session === false ? null : 'session_test1';

			// @ts-ignore
			c.set('user', user);
			// @ts-ignore
			c.set('session', session);
			await next();
		});

		app.get('/ws', wsUpgrade);
		app.get('/ws/*', wsUpgrade);

		this.server = Bun.serve({
			hostname: this.hostname,
			port,
			fetch: app.fetch,
			websocket: {
				open: websocket.open,
				message: websocket.message,
				close: websocket.close,
				sendPings: false,
				idleTimeout: 0, // ???
				publishToSelf: false,
				backpressureLimit: 16 * 1024 * 1024, // 16MB
				maxPayloadLength: 16 * 1024 * 1024, // 16MB
			},
			tls: {
				key: Bun.file('dev/localhost-key.pem'),
				cert: Bun.file('dev/localhost.pem'),
			},
		});
		this.serverUrl = `${this.usesTLS ? 'wss' : 'ws'}://${this.hostname}:${port}`;

		// Привязываем Socket.IO к серверу
		io.attach(this.server);

		// For testing error access (auth failed)
		if (config.auth?.user === false || config.auth?.session === false) {
			io.use((socket, next) => {
				next(new Error('Unauthorized - authentication failed'));
			});
		}

		return io;
	}

	/**
	 * Создает клиента с отложенным подключением
	 */
	createClient(clientConfig: TestClientConfig = {}): Socket {
		if (!this.serverUrl) {
			throw new Error('Server must be created first before creating clients');
		}

		const namespace = clientConfig.namespace || '/';
		const socket = clientIO(this.serverUrl + namespace, {
			path: '/ws',
			transports: (clientConfig.transports as any) || ['websocket'],
			timeout: clientConfig.timeout || 10000,
			autoConnect: false, // ключевой момент - отключаем автоподключение
			forceNew: true,
			upgrade: false,
			rememberUpgrade: false,
			reconnection: false,
			rejectUnauthorized: false,
			transportOptions: {
				pingTimeout: this.config.pingTimeout || undefined,
				pingInterval: this.config.pingInterval || undefined,
			},
			withCredentials: true,
			requestTimeout: clientConfig.timeout || 10000,
		});

		this.clients.push(socket);
		this.pendingClients.push(socket);

		process.nextTick(() => {
			this._connectPendingClients();
		});

		return socket;
	}

	/**
	 * Creates multiple clients with an optional callback to be executed on every client
	 *
	 * @example
	 * createClients(100, (client, index, clients) => {
	 * 		client.on('connect', () => console.log(`${index++} |`, client.id));
	 * });
	 *
	 * @param count The number of clients to create
	 * @param callback An async callback to be executed after client are created
	 * @param configClient The client configuration
	 * @param connectedOnly Whether to wait for all clients to be connected
	 */
	// Sync
	createClients(
		count: number,
		callback?: (client: Socket, index: number, clients: Socket[]) => void,
		configClient?: TestClientConfig,
		connectedOnly?: false,
	): Socket[];
	// Async
	createClients(
		count: number,
		callback: (client: Socket, index: number, clients: Socket[]) => void,
		configClient: TestClientConfig,
		connectedOnly?: true,
	): Promise<Socket[]>;
	createClients(
		count: number,
		callback?: (client: Socket, index: number, clients: Socket[]) => void,
		configClient: TestClientConfig = {},
		connectedOnly: boolean = false,
	): any {
		const clients = Array.from({ length: count }, (_, i) => this.createClient(configClient));
		if (callback) clients.forEach((client, i, all) => callback(client, i, all));

		if (connectedOnly) {
			return new Promise<Socket[]>((resolve, reject) => {
				let connected = 0;
				for (const client of clients) {
					client.once('connect', () => {
						connected++;
						if (connected === clients.length) resolve(clients);
					});
					client.once('connect_error', reject);
				}
			});
		}

		return clients;
	}

	/**
	 * Creates multiple clients with an optional ASYNC callback to be executed on every client
	 *
	 * @example
	 * await createClientsAsync(100, async (client, index, clients) => {
	 * 		client.on('connect', () => console.log(`${index++} |`, client.id));
	 * });
	 *
	 * @param count The number of clients to create
	 * @param callback An async callback to be executed after client are created
	 * @param configClient The client configuration
	 * @param connectedOnly Whether to wait for all clients to be connected
	 */
	async createClientsAsync(
		count: number,
		callback?: (client: Socket, index: number, clients: Socket[]) => Promise<void>,
		configClient: TestClientConfig = {},
		connectedOnly?: false,
	): Promise<Socket[]> {
		const clients = Array.from({ length: count }, (_, i) => this.createClient(configClient));
		if (callback) await Promise.all(clients.map((client, i, all) => callback(client, i, all)));

		if (connectedOnly) {
			await new Promise<void>((resolve, reject) => {
				let connected = 0;
				for (const client of clients) {
					client.once('connect', () => {
						connected++;
						if (connected === clients.length) resolve();
					});
					client.once('connect_error', reject);
				}
			});
		}

		return clients;
	}

	/**
	 * Connects all accumulated customers in order
	 */
	private async _connectPendingClients(): Promise<void> {
		const clientsToConnect = [...this.pendingClients];
		this.pendingClients = [];

		// We connect customers strictly in order, we are waiting for everyone
		for (const socket of clientsToConnect) {
			socket.connect();
			// We are waiting for the connection of the current client before the transition to the next
			await new Promise<void>((resolve) => {
				if (socket.connected) return resolve();
				socket.once('connect', () => resolve());
				socket.once('connect_error', () => resolve()); // Even with an error we continue
			});
		}
	}

	/**
	 * Cleans all resources
	 */
	cleanup(): void {
		if (!this.io) return;
		const io = this.io!;

		// Clear listeners
		io.removeAllListeners();
		io.disconnectSockets(true);

		// Clear namespaces
		for (const [name, nsp] of io._nsps) {
			nsp.removeAllListeners();
			nsp.sockets.clear();
			if (nsp.adapter) {
				nsp.adapter.removeAllListeners();
			}
			nsp['_fns'] = [];
		}

		io.close(); // close io server
		this.io = undefined; // delete io server

		// Disconnect all clients
		this.clients.forEach((client) => {
			if (client.connected) {
				client.disconnect();
			}
		});

		this.clients = [];
		this.pendingClients = [];

		// Stop the server
		if (this.server) {
			this.server.stop(true);
			this.server = undefined;
			this.serverUrl = undefined;
		}
	}

	/**
	 * Checks that all clients are connected
	 */
	clientsConnected(): boolean {
		return this.clients.every((client) => client.connected);
	}

	/**
	 * Gets the number of connected clients
	 */
	get clientsConnectedCount(): number {
		return this.clients.filter((client) => client.connected).length;
	}

	/**
	 * Get server URL
	 */
	get url(): string | undefined {
		return this.serverUrl;
	}
}

/**
 * A utility for creating a test environment (for reverse compatibility)
 */
export function createTestEnv(config: TestServerConfig = {}): TestEnvironment {
	return new TestEnvironment(config);
}
