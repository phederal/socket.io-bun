/**
 * Простой helper для тестов - создает сервер + Socket.IO клиент
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from '../../ws';
import { io as clientIO, type Socket } from 'socket.io-client';

export type createTestServerType = {
	server: Bun.Server;
	io: typeof io;
	port: number;
	url: string;
	cleanup: () => void;
};

/** global */
let portCounter: number = 8900;
const hostname: string = 'localhost';
let srv: createTestServerType['server'] | null = null;

export async function server(): Promise<createTestServerType> {
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

	const server = Bun.serve({
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

	srv = server;

	io.attach(server);
	const cleanup = () => server.stop();

	return {
		server,
		io,
		port,
		url: `wss://localhost:${port}/ws`,
		cleanup,
	};
}

export function client(server: createTestServerType, nsp: string = '/'): Socket {
	// Delete "/ws" only if it comes right after domain and port
	const url = server.url.replace(/(:\/\/[^\/]+)\/ws(\/.*)?$/, '$1$2');
	// Create client from socket.io-client
	return clientIO(url + nsp, {
		path: '/ws',
		transports: ['websocket'],
		upgrade: false,
		timeout: 10000,
		forceNew: true,
		// rejectUnauthorized: false,
		autoConnect: true,
		rememberUpgrade: true,
	});
}
