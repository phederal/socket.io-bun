/**
 * Example file for init io server
 * and use with hono createBunWebSocket
 */

import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import { Hono, type Context } from 'hono';
import { Server } from './src';

// Create typed socket server
// <Listen, Emit, Reserved, SocketData>
const io = new Server<
	{},
	{},
	{},
	{
		user: string;
		session: string;
	}
>({
	pingTimeout: 10000,
	pingInterval: 5000,
	connectTimeout: 5000,
});

// Create WebSocket handler
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();

// WebSocket upgrade handler
export const wsUpgrade = upgradeWebSocket((c: Context) => {
	const user = c.get('user') || 'user_test1';
	const session = c.get('session') || 'session_test1';

	if (!user || !session) {
		return Promise.reject({ code: 3000, reason: 'Unauthorized' });
	}

	return io.onconnection(c, {
		user,
		session,
	});
});

const app = new Hono();

// Middleware for authentication (custom socket data)
app.use('/socket.io/*', async (c, next) => {
	// Check set modified data
	const user = '__user_test1__';
	const session = '__session_test1__';

	// @ts-ignore
	c.set('user', user);
	// @ts-ignore
	c.set('session', session);
	await next();
});

app.get('/socket.io/*', wsUpgrade);

const server = Bun.serve({
	hostname: 'localhost',
	port: 8444,
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

io.attach(server);

console.log(`wss://${server.hostname}:${server.port}`);
