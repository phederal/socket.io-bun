import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from '../../ws';
import { io as clientIO, type Socket } from 'socket.io-client';

export interface TestServerConfig {
	port?: number;
	hostname?: string;
	namespace?: string;
	auth?: Record<string, any>;
	tls?: boolean;
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

	private server?: Bun.Server;
	private serverUrl?: string;
	private clients: Socket[] = [];
	private pendingClients: Socket[] = [];
	private isConnecting = false;
	private createDelay = 0;

	constructor(config: TestServerConfig = {}) {
		this.hostname = config.hostname || 'localhost';
		this.usesTLS = config.tls !== false;

		this.createServer = this.createServer.bind(this);
		this.createClient = this.createClient.bind(this);
		this.cleanup = this.cleanup.bind(this);
	}

	get testEnv() {
		return this;
	}

	async createServer(config: TestServerConfig = {}): Promise<typeof io> {
		const port = config.port || ++TestEnvironment.portCounter;
		const app = new Hono();

		// Middleware for authentication (custom socket data)
		app.use('/ws/*', async (c, next) => {
			const user = config.auth?.user || { id: `test_user_${Date.now()}` };
			const session = config.auth?.session || { id: `test_session_${Date.now()}` };

			// @ts-ignore
			c.set('user', user);
			// @ts-ignore
			c.set('session', session);
			await next();
		});

		app.get('/ws', wsUpgrade);
		app.get('/ws/*', wsUpgrade);

		const serverOptions: any = {
			hostname: this.hostname,
			port,
			fetch: app.fetch,
			publishToSelf: false,
			websocket: {
				open: websocket.open,
				message: websocket.message,
				close: websocket.close,
			},
		};

		// Add tls if necessary
		if (this.usesTLS) {
			serverOptions.tls = {
				key: Bun.file('dev/localhost-key.pem'),
				cert: Bun.file('dev/localhost.pem'),
			};
		}

		this.server = Bun.serve(serverOptions);
		this.serverUrl = `${this.usesTLS ? 'wss' : 'ws'}://${this.hostname}:${port}`;

		// Привязываем Socket.IO к серверу
		io.attach(this.server);

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
		});

		this.clients.push(socket);
		this.pendingClients.push(socket);

		// Run the connection with a small delay
		if (!this.isConnecting) {
			this.isConnecting = true;

			setTimeout(async () => {
				await this._connectPendingClients();
			}, this.createDelay);
		}

		return socket;
	}

	/**
	 * Connects all accumulated customers in order
	 */
	private async _connectPendingClients(): Promise<void> {
		const clientsToConnect = [...this.pendingClients];
		this.pendingClients = [];
		this.isConnecting = false;
		// We connect customers strictly in order, we are waiting for everyone
		for (const socket of clientsToConnect) {
			socket.connect();
			// We are waiting for the connection of the current client before the transition to the next
			await new Promise<void>((resolve) => {
				if (socket.connected) {
					resolve();
					return;
				}
				socket.once('connect', () => resolve());
				socket.once('connect_error', () => resolve()); // Even with an error we continue
			});
			// Small pause for stability
			await new Promise((resolve) => setTimeout(resolve, this.createDelay));
		}
	}

	/**
	 * Очищает все ресурсы
	 */
	cleanup(): void {
		// Clear listeners
		io.removeAllListeners();
		io.disconnectSockets(true);

		// Disconnect all clients
		this.clients.forEach((client) => {
			if (client.connected) {
				client.disconnect();
			}
		});
		this.clients = [];
		this.pendingClients = [];
		this.isConnecting = false;

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
