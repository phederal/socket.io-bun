/**
 * Server & WebSocket
 * Main file of backend with full TypeScript support
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from './ws';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from './shared/types/socket.types';
import { serveStatic } from 'hono/bun';

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
	hostname: 'localhost',
	port: 8443,
	fetch: app.fetch,
	development: false,
	maxRequestBodySize: 128 * 1024 * 1024,
	idleTimeout: 120,

	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
		idleTimeout: 120,
		maxPayloadLength: 16 * 1024 * 1024,
		publishToSelf: false,
	},

	tls: {
		key: Bun.file(import.meta.dir + '/dev/localhost-key.pem'),
		cert: Bun.file(import.meta.dir + '/dev/localhost.pem'),
	},
});

// Set Bun server instance for Socket.IO publishing BEFORE setting up events
io.setBunServer(server);

import './test/test-server';

io.on('connection', (socket) => {
	console.log(`🎉 [INDEX] Socket ${socket.id} connected successfully!`);
	console.log(`📊 [INDEX] Total sockets: ${io.socketsCount}`);

	// ✅ Базовые обработчики событий
	socket.on('ping', () => {
		console.log(`📡 [INDEX] PING received from ${socket.id}`);
		socket.emit('pong');
		console.log(`📡 [INDEX] PONG sent to ${socket.id}`);
	});

	socket.on('message', (data) => {
		socket.emit('message', `Echo: ${data}`);
		socket.broadcast.emit('message', `${socket.id} says: ${data}`);
	});

	socket.on('disconnect', (reason) => {
		console.log(`❌ [INDEX] Socket ${socket.id} disconnected: ${reason}`);
		console.log(`📊 [INDEX] Remaining sockets: ${io.socketsCount}`);
	});

	// ✅ Отправляем приветственное сообщение через несколько секунд
	setTimeout(() => {
		console.log(`💬 [INDEX] Sending welcome message to ${socket.id}`);
		try {
			const success = socket.emit('message', `Welcome ${socket.id}! Server is ready.`);
			console.log(`💬 [INDEX] Welcome message sent: ${success}`);
		} catch (error) {
			console.error(`💬 [INDEX] Error sending welcome message:`, error);
		}
	}, 2000);

	// // ✅ Тестируем broadcast
	// setTimeout(() => {
	// 	console.log(`📢 [INDEX] Broadcasting notification...`);
	// 	try {
	// 		io.emit('message', `New user ${socket.id} joined! Total: ${io.socketsCount}`);
	// 	} catch (error) {
	// 		console.error(`📢 [INDEX] Error broadcasting:`, error);
	// 	}
	// }, 3000);
});

// Дополнительная отладка
io.on('connect', (socket) => {
	console.log(`🔗 [INDEX] Connect event received for ${socket.id}`);
});

console.log('[INDEX] Event handlers registered');

// if (process.env.NODE_ENV === 'development') {
console.log(`🚀 Server listening on https://${server.hostname}:${server.port}`);
console.log(`📡 WebSocket endpoint: wss://${server.hostname}:${server.port}/ws`);
console.log(`💬 Chat namespace: wss://${server.hostname}:${server.port}/ws/chat`);
console.log();
// }

// ✅ Export typed instances
export type App = typeof app;
export { io };
export type TypedSocket = Parameters<Parameters<typeof io.on>[1]>[0];
