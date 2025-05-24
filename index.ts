/**
 * Server & WebSocket
 * Main file of backend
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from './ws';

// App
const app = new Hono();

// WebSocket routes
app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Example Socket.IO usage
io.on('connection', (socket) => {
	console.log(`Socket ${socket.id} connected to namespace ${socket.nsp}`);

	// Join socket to a room based on user ID
	socket.join(`user:${socket.id}`);

	// Handle ping
	socket.on('ping', () => {
		socket.emit('pong');
	});

	// Handle messages
	socket.on('message', (data) => {
		console.log(`Message from ${socket.id}:`, data);

		// Echo back to sender
		socket.emit('message', `Echo: ${data}`);

		// Broadcast to all other clients
		socket.broadcast.emit('message', `${socket.id} says: ${data}`);
	});

	// Handle room join
	socket.on('join_room', (room) => {
		socket.join(room);
		socket.emit('room_joined', room);
		socket.to(room).emit('notification', `${socket.id} joined room ${room}`);
	});

	// Handle room leave
	socket.on('leave_room', (room) => {
		socket.leave(room);
		socket.emit('room_left', room);
		socket.to(room).emit('notification', `${socket.id} left room ${room}`);
	});

	socket.on('disconnect', (reason) => {
		console.log(`Socket ${socket.id} disconnected: ${reason}`);
	});
});

// Example namespace usage
const chatNamespace = io.of('/chat');
chatNamespace.on('connection', (socket) => {
	console.log(`Socket ${socket.id} connected to chat namespace`);

	socket.on('chat_message', (data) => {
		// Broadcast to all clients in chat namespace
		chatNamespace.emit('chat_message', {
			from: socket.id,
			message: data.message,
			timestamp: new Date().toISOString(),
		});
	});
});

// Run Server
export const server = Bun.serve({
	hostname: process.env.APP_ENV === 'development' ? 'localhost' : '0.0.0.0',
	port: process.env.APP_ENV === 'development' ? 8443 : Number(process.env.APP_PORT) || 3000,
	fetch: app.fetch,
	development: process.env.APP_ENV === 'development',
	maxRequestBodySize: 128 * 1024 * 1024, // 128 MB
	idleTimeout: 120, // 120 sec

	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
		idleTimeout: 120, // 120 sec
		maxPayloadLength: 16 * 1024 * 1024, // 16 MB
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
}

// Types (RPC)
export type App = typeof app;
