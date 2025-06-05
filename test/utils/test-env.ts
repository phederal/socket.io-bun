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

	constructor(config: TestServerConfig = {}) {
               this.hostname = config.hostname || 'localhost';
               this.usesTLS = config.tls !== false;

		// Привязываем методы к контексту
		this.createServer = this.createServer.bind(this);
		this.createClient = this.createClient.bind(this);
		this.cleanup = this.cleanup.bind(this);
	}

	get testEnv() {
		return this;
	}

	/**
	 * Создает и запускает тестовый сервер
	 */
	async createServer(config: TestServerConfig = {}): Promise<typeof io> {
		const port = config.port || ++TestEnvironment.portCounter;
		const app = new Hono();

		// Middleware для аутентификации
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
			websocket: {
				open: websocket.open,
				message: websocket.message,
				close: websocket.close,
			},
		};

		// Добавляем TLS если нужно
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
	 * Создает клиента без создания сервера (для переиспользования существующего)
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
			autoConnect: clientConfig.autoConnect !== false,
			forceNew: true,
			upgrade: false,
			rememberUpgrade: true,
		});

		this.clients.push(socket);
		return socket;
	}

	/**
	 * Очищает все ресурсы
	 */
	cleanup(): void {
		// Отключаем всех клиентов
		this.clients.forEach((client) => {
			if (client.connected) {
				client.disconnect();
			}
		});
		this.clients = [];

		// Останавливаем сервер
		if (this.server) {
			this.server.stop(true);
			this.server = undefined;
			this.serverUrl = undefined;
		}
	}

	/**
	 * Проверяет, что все клиенты подключены
	 */
	clientsConnected(): boolean {
		return this.clients.every((client) => client.connected);
	}

	/**
	 * Получает количество подключенных клиентов
	 */
	get clientsConnectedCount(): number {
		return this.clients.filter((client) => client.connected).length;
	}

	/**
	 * Получает URL сервера
	 */
	get url(): string | undefined {
		return this.serverUrl;
	}
}

/**
 * Утилита для создания тестового окружения (для обратной совместимости)
 */
export function createTestEnv(config: TestServerConfig = {}): TestEnvironment {
	return new TestEnvironment(config);
}
