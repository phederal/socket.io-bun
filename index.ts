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

app.get('/', (c) =>
	c.html(`
	<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Socket.IO Bun Client</title>
</head>
<body>
  <h1>Socket.IO Bun Client</h1>
  <script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
  <script>
    const socket = io('wss://'+ window.location.hostname +':8443', { path: '/ws', transports: ['websocket'], transportOptions: {
    websocket: {
      path: "/ws/"
    }
  } }); // Замените на адрес вашего сервера

    socket.on('connect', () => {
      console.log('Connected:', socket.id);
    });

    socket.on('message', (data) => {
      console.log('Received message:', data);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected');
    });

    // Пример отправки сообщения
    socket.emit('message', { hello: 'world' });
  </script>
</body>
</html>

	`)
);

app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Create server first
export const server = Bun.serve({
	hostname: process.env.NODE_ENV === 'development' ? 'localhost' : '0.0.0.0',
	port: process.env.NODE_ENV === 'development' ? 8443 : Number(process.env.APP_PORT) || 3000,
	fetch: app.fetch,
	development: process.env.NODE_ENV === 'development',
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

	tls:
		process.env.NODE_ENV === 'development'
			? {
					key: Bun.file(import.meta.dir + '/dev/localhost-key.pem'),
					cert: Bun.file(import.meta.dir + '/dev/localhost.pem'),
			  }
			: undefined,
});

// Set Bun server instance for Socket.IO publishing BEFORE setting up events
io.setBunServer(server);

// Добавьте ЭТО в index.ts перед io.on('connection', ...)
console.log('Registering connection handler on:', io.sockets.eventNames());
console.log('Current listeners before:', io.sockets.listenerCount('connection'));
io.on('connection', (socket) => {
	console.log('🎯 CONNECTION HANDLER TRIGGERED000___!!', socket.id);
	console.log('TEST SOCKET =', socket.id, 'connected');
	console.log('Socket', socket.id, 'connected to namespace', socket.nsp);

	// ✅ Проверим что socket.on() работает
	socket.on('ping', () => {
		console.log('📡 PING received from', socket.id);
		socket.emit('pong');
		console.log('📡 PONG sent to', socket.id);
	});

	socket.on('message', (data) => {
		console.log('📨 MESSAGE received from', socket.id, ':', data);
		socket.emit('message', `Echo: ${data}`);
	});

	socket.on('disconnect', (reason) => {
		console.log('❌ DISCONNECT:', socket.id, 'reason:', reason);
	});
});

// ✅ Typed broadcasting examples
setInterval(() => {
	// Broadcast with full typing
	io.emit('notification', 'Server heartbeat');
	io.to('vip-users').emit('notification', 'VIP message');
	io.except('banned-users').emit('notification', 'General announcement');
}, 30000);

console.log('Current listeners after:', io.sockets.listenerCount('connection'));

if (process.env.NODE_ENV === 'development') {
	console.log(`🚀 Server listening on https://${server.hostname}:${server.port}`);
	console.log(`📡 WebSocket endpoint: wss://${server.hostname}:${server.port}/ws`);
	console.log(`💬 Chat namespace: wss://${server.hostname}:${server.port}/ws/chat`);
	console.log(`✨ TypeScript typing enabled for all Socket.IO events`);
}

// ✅ Export typed instances
export type App = typeof app;
export { io };
export type TypedSocket = Parameters<Parameters<typeof io.on>[1]>[0];

// ✅ Utility functions with typing
export function broadcastToRoom<K extends keyof ServerToClientEvents>(
	room: string,
	event: K,
	...args: Parameters<ServerToClientEvents[K]>
): void {
	io.to(room).emit(event, ...args);
}

export function sendNotificationToUser(userId: string, message: string): void {
	io.to(`user:${userId}`).emit('notification', message);
}

export function getConnectedSocketsCount(): number {
	return io.socketsCount;
}
