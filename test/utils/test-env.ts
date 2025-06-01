/**
 * Простой helper для тестов - создает сервер + Socket.IO клиент
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from '../../ws';
import { io as clientIO, type Socket } from 'socket.io-client';

export type TestServerType = {
	server: Bun.Server;
	io: typeof io;
	port: number;
	url: string;
	cleanup: () => void;
};

export type TestEnvType = {
	createServer: () => Promise<
		TestServerType & {
			createClient: (nsp?: string) => Socket;
		}
	>;
	cleanup: () => void;
};

/** global */
let portCounter: number = 8900;
const hostname: string = 'localhost';

// Глобальные списки для отслеживания всех ресурсов
const globalServers: TestServerType[] = [];
const globalClients: Socket[] = [];

export function testEnv(): TestEnvType {
	const createServer = async () => {
		const port = ++portCounter;
		const app = new Hono();

		// Простая аутентификация для тестов
		app.use('/ws/*', async (c, next) => {
			// @ts-ignore
			c.set('user', { id: `test_${Date.now()}` });
			// @ts-ignore
			c.set('session', { id: `session_${Date.now()}` });
			await next();
		});

		app.get('/ws', wsUpgrade);
		app.get('/ws/*', wsUpgrade);

		const bunServer = Bun.serve({
			hostname: hostname,
			port,
			fetch: app.fetch,
			websocket: {
				open: websocket.open,
				message: websocket.message,
				close: websocket.close,
			},
			tls: {
				key: Bun.file('dev/localhost-key.pem'),
				cert: Bun.file('dev/localhost.pem'),
			},
		});

		const serverUrl = `wss://${hostname}:${port}`;

		// Привязываем Socket.IO к серверу
		io.attach(bunServer);

		const server: TestServerType = {
			server: bunServer,
			io,
			port,
			url: serverUrl,
			cleanup: () => bunServer.stop(true),
		};

		// Функция создания клиента привязана к этому серверу
		const createClient = (nsp: string = '/'): Socket => {
			const socket = clientIO(serverUrl + nsp, {
				path: '/ws',
				transports: ['websocket'],
				upgrade: false,
				timeout: 10000,
				forceNew: true,
				autoConnect: true,
				rememberUpgrade: true,
			});

			globalClients.push(socket);
			return socket;
		};

		globalServers.push(server);

		return {
			...server,
			createClient,
		};
	};

	const cleanup = () => {
		// Отключаем всех клиентов
		globalClients.forEach((client) => {
			if (client.connected) {
				client.disconnect();
			}
		});
		globalClients.length = 0;

		// Останавливаем все серверы
		globalServers.forEach((server) => server.cleanup());
		globalServers.length = 0;
	};

	return {
		createServer,
		cleanup,
	};
}

// Глобальная функция cleanup для использования в afterEach
export function testCleanup() {
	// Отключаем всех клиентов
	globalClients.forEach((client) => {
		if (client.connected) {
			client.disconnect();
		}
	});
	globalClients.length = 0;

	// Останавливаем все серверы
	globalServers.forEach((server) => server.cleanup());
	globalServers.length = 0;
}
