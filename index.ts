/**
 * Server & WebSocket
 * Main file of backend with full TypeScript support
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from './ws';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from './types/socket.types';
import { serveStatic } from 'hono/bun';

const isProduction = process.env.NODE_ENV === 'production';

// App
const app = new Hono<{
	Variables: {
		user: unknown;
		session: unknown;
	};
}>();

// Add middleware to set mock user and session for testing
app.use('/ws/*', async (c, next) => {
	// In production, this would come from your authentication middleware
	c.set('user', { id: `user_${Date.now()}` });
	c.set('session', { id: `session_${Date.now()}` });

	await next();
});

app.get('/', serveStatic({ path: 'test/test-client.html' }));
app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Create server first
export const server = Bun.serve({
	hostname: 'localhost', // isProduction ? '0.0.0.0' : 'localhost',
	port: 8443, // isProduction ? Number(process.env.APP_PORT) || 3000 : 8443,
	fetch: app.fetch,
	development: !isProduction,
	maxRequestBodySize: 128 * 1024 * 1024,
	idleTimeout: 120,

	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
		idleTimeout: 120,
		maxPayloadLength: 16 * 1024 * 1024,
		publishToSelf: false,
		backpressureLimit: 64 * 1024, // 64KB backpressure limit
	},

	tls: {
		key: Bun.file(import.meta.dir + '/dev/localhost-key.pem'),
		cert: Bun.file(import.meta.dir + '/dev/localhost.pem'),
	},
});

// Set Bun server instance for Socket.IO publishing BEFORE setting up events
io.setBunServer(server);

// ИСПРАВЛЕНИЕ: Включаем тестовый сервер обратно
import './test/test-server';
import { warmupPerformanceOptimizations } from './socket/socket';
warmupPerformanceOptimizations();

// Дополнительная отладка
if (!isProduction) {
	io.on('connect', (socket) => {
		console.log(`🔗 [INDEX] Connect event received for ${socket.id}`);
	});
	console.log(`🚀 Server listening on https://${server.hostname}:${server.port}`);
	console.log(`📡 WebSocket endpoint: wss://${server.hostname}:${server.port}/ws`);
	console.log(`💬 Chat namespace: wss://${server.hostname}:${server.port}/ws/chat`);
	console.log();
}

// ✅ Export typed instances
export type App = typeof app;
export { io };
export type TypedSocket = Parameters<Parameters<typeof io.on>[1]>[0];
