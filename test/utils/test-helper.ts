/**
 * Простой helper для тестов - создает сервер + Socket.IO клиент
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from '../../ws';
import { io as clientIO, type Socket } from 'socket.io-client';

let portCounter = 8900;

export function createSocketIOClient(server: createTestServerType, nsp: string = '/'): Socket {
	// Delete "/ws" only if it comes right after domain and port
	const url = server.url.replace(/(:\/\/[^\/]+)\/ws(\/.*)?$/, '$1$2');
	// Create client from socket.io-client
	return clientIO(url + nsp, {
		path: '/ws',
		transports: ['websocket'],
		timeout: 10000,
		forceNew: true,
		rejectUnauthorized: false,
		autoConnect: true,
	});
}

export type createTestServerType = {
	server: Bun.Server;
	io: typeof io;
	port: number;
	url: string;
	cleanup: () => void;
};

export async function createTestServer(): Promise<createTestServerType> {
	const port = ++portCounter;

	const app = new Hono();

	// Простая аутентификация для тестов
	app.use('/ws/*', async (c, next) => {
		c.set('user', { id: `test_${Date.now()}` });
		c.set('session', { id: `session_${Date.now()}` });
		await next();
	});

	app.get('/ws', wsUpgrade);
	app.get('/ws/*', wsUpgrade);

	const server = Bun.serve({
		hostname: 'localhost',
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

	io.setBunServer(server);

	const cleanup = () => {
		server.stop();
	};

	return {
		server,
		io,
		port,
		url: `wss://localhost:${port}/ws`,
		cleanup,
	};
}
