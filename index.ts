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
    // ✅ ПРАВИЛЬНО - подключение к дефолтному namespace
    const socket = io('wss://' + window.location.hostname + ':8443', {
        path: '/ws',
        transports: ['websocket'],
		forceNew: true
    });

    socket.on('connect', () => {
    console.log('✅ Connected:', socket.id);
});

socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
});

// Проверяем состояние соединения каждые 2 секунды
setInterval(() => {
    console.log('🔍 Socket status:', {
        connected: socket.connected,
        id: socket.id,
        sendBuffer: socket.sendBuffer.length,
        receiveBuffer: socket.receiveBuffer.length
    });
}, 2000);

    // Тестовые функции в глобальном scope
    window.testPing = () => {
        console.log('📡 Sending PING...');
        socket.emit('ping');
    };

    window.testMessage = () => {
        console.log('📨 Sending MESSAGE...');
        socket.emit('message', 'Hello from browser!');
    };
	setTimeout(() => {
		testMessage(), testPing();
	testMessage(), testPing();
	testMessage(), testPing();
	}, 1000)
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

io.on('connection', (socket) => {
	console.log('📡 Socket listeners:', socket.eventNames().length);

	// ✅ Проверим что socket.on() работает
	socket.on('ping', () => {
		console.log('📡 PING received from', socket.id);
		socket.emit('pong');
		console.log('📡 PONG sent to', socket.id);
	});

	io.emit('message', 'hello');
	io.sockets.on('connect', (socket) => {
		socket.emit('message', 'hello');
	});
	socket.on('message', (data) => {
		console.log('📨 MESSAGE received from', socket.id, ':', data);
		socket.emit('message', `Echo: ${data}`);
	});

	socket.on('disconnect', (reason) => {
		console.log('❌ DISCONNECT:', socket.id, 'reason:', reason);
	});

	console.log('📡 Socket listeners:', socket.eventNames());

	setTimeout(() => {
		console.log('📡 Sending MESSAGE...');
		const a = socket.emit('message', 'New user connected!');
		console.log(a);
	}, 2000);
});

if (process.env.NODE_ENV === 'development') {
	console.log(`🚀 Server listening on https://${server.hostname}:${server.port}`);
	console.log(`📡 WebSocket endpoint: wss://${server.hostname}:${server.port}/ws`);
	console.log(`💬 Chat namespace: wss://${server.hostname}:${server.port}/ws/chat`);
	console.log();
}

// ✅ Export typed instances
export type App = typeof app;
export { io };
export type TypedSocket = Parameters<Parameters<typeof io.on>[1]>[0];
