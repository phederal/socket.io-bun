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
const app = new Hono();

// Add middleware to set mock user and session for testing
app.use('/ws/*', async (c, next) => {
	// In production, this would come from your authentication middleware
	c.get('user' as never);
	c.get('session' as never);

	await next();
});

app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// ==== Fully Typed Socket.IO Usage ====

// ✅ Main namespace with full typing
io.on('connection', (socket) => {
	console.log(`Socket ${socket.id} connected to namespace ${socket.nsp}`);

	// ✅ Typed socket.data access
	socket.data.user = {
		id: socket.id,
		name: `User_${socket.id.slice(0, 8)}`,
		email: `${socket.id}@example.com`,
	};

	// Join socket to a room based on user ID
	socket.join(`user:${socket.id}`);

	// ✅ Fully typed event handlers with IntelliSense
	socket.on('ping', () => {
		socket.emit('pong');
	});

	socket.on('message', (data) => {
		// data is automatically typed as string
		console.log(`Message from ${socket.id}:`, data);

		// Echo back to sender with typing
		socket.emit('message', `Echo: ${data}`);

		// Broadcast to all other clients with typing
		socket.broadcast.emit('message', `${socket.id} says: ${data}`);
	});

	socket.on('chat_message', (data) => {
		// data is automatically typed as { room: string; message: string }
		const { room, message } = data;
		console.log(`Chat message to ${room}:`, message);

		// Typed room operations
		socket.join(room);
		socket.to(room).emit('chat_message', {
			from: socket.id,
			room,
			message,
			timestamp: new Date().toISOString(),
		});
	});

	socket.on('join_room', (room) => {
		// room is automatically typed as string
		socket.join(room);
		socket.emit('room_joined', room);
		socket.to(room).emit('user_joined', { userId: socket.id, room });
		console.log(`Socket ${socket.id} joined room: ${room}`);
	});

	socket.on('leave_room', (room) => {
		// room is automatically typed as string
		socket.leave(room);
		socket.emit('room_left', room);
		socket.to(room).emit('user_left', { userId: socket.id, room });
		console.log(`Socket ${socket.id} left room: ${room}`);
	});

	// ✅ Typed acknowledgments
	socket.on('get_user_info', (callback) => {
		// callback is automatically typed
		callback({
			id: socket.id,
			name: socket.data.user?.name || 'Unknown',
		});
	});

	// ✅ Multiple parameter events with typing
	socket.on('update_position', (x, y, z) => {
		// x, y, z are automatically typed as numbers
		console.log(`Position update from ${socket.id}:`, { x, y, z });

		socket.broadcast.emit('position_update', {
			userId: socket.id,
			x,
			y,
			z,
		});
	});

	// ✅ Typing indicators
	socket.on('typing_start', (room) => {
		socket.to(room).emit('user_typing', { userId: socket.id, room });
	});

	socket.on('typing_stop', (room) => {
		socket.to(room).emit('user_stopped_typing', { userId: socket.id, room });
	});

	socket.on('disconnect', (reason) => {
		console.log(`Socket ${socket.id} disconnected: ${reason}`);
	});
});

// ✅ Typed namespace example
const chatNamespace = io.of('/chat');
chatNamespace.on('connection', (socket) => {
	console.log(`Socket ${socket.id} connected to chat namespace`);

	socket.on('chat_message', (data) => {
		// Fully typed data parameter
		const { room, message } = data;

		// Broadcast to all clients in chat namespace with typing
		chatNamespace.emit('chat_message', {
			from: socket.id,
			room,
			message,
			timestamp: new Date().toISOString(),
		});
	});

	socket.on('join_room', (room) => {
		socket.join(room);
		chatNamespace.to(room).emit('notification', `${socket.id} joined the chat`);
	});
});

// ✅ Typed broadcasting examples
setInterval(() => {
	// Broadcast with full typing
	io.emit('notification', 'Server heartbeat');
	io.to('vip-users').emit('notification', 'VIP message');
	io.except('banned-users').emit('notification', 'General announcement');
}, 30000);

// ✅ Typed middleware
io.use((socket, next) => {
	const auth = socket.handshake.auth;

	if (!auth.user) {
		return next(new Error('Authentication required'));
	}

	// Typed socket.data assignment
	socket.data.session = {
		id: auth.session?.id || 'anonymous',
		authenticated: true,
		connectedAt: new Date().toISOString(),
	};

	next();
});

// Run Server
export const server = Bun.serve({
	hostname: process.env.APP_ENV === 'development' ? 'localhost' : '0.0.0.0',
	port: process.env.APP_ENV === 'development' ? 8443 : Number(process.env.APP_PORT) || 3000,
	fetch: app.fetch,
	development: process.env.APP_ENV === 'development',
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
		process.env.APP_ENV === 'development'
			? {
					key: Bun.file(import.meta.dir + '/dev/localhost-key.pem'),
					cert: Bun.file(import.meta.dir + '/dev/localhost.pem'),
			  }
			: undefined,
});

// Set Bun server instance for Socket.IO publishing
io.setBunServer(server);

if (process.env.APP_ENV === 'development') {
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
