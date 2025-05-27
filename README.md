# ⚠️ Warning

I make significant adjustments to the library code on a daily basis, so please do not use this library for your production projects until version 1.0.0 is ready. Any questions would be appreciated.

# socket.io-bun

A fully-typed Socket.IO implementation for Bun runtime with Hono framework integration.

## Features

-   🚀 **Native Bun WebSocket support** - No Engine.IO overhead
-   📝 **Full TypeScript support** - Complete type safety for events and data
-   🔥 **High performance** - Direct Bun WebSocket integration
-   🏠 **Namespaces & Rooms** - Complete Socket.IO API compatibility
-   ✅ **Acknowledgments** - Full support for ack callbacks
-   🔌 **Middleware support** - Authentication and validation
-   📡 **Broadcasting** - Room-based and namespace broadcasting

## Installation

```bash
bun install
```

## Basic Usage

### 1. Server Setup

```typescript
import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from './ws';

const app = new Hono();

// Add authentication middleware
app.use('/ws/*', async (c, next) => {
	c.set('user', { id: 'user123', name: 'John Doe' });
	c.set('session', { id: 'session123', authenticated: true });
	await next();
});

app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Socket.IO events
io.on('connection', (socket) => {
	console.log(`Socket ${socket.id} connected`);

	socket.on('message', (data) => {
		socket.broadcast.emit('message', `${socket.id}: ${data}`);
	});

	socket.on('disconnect', (reason) => {
		console.log(`Socket ${socket.id} disconnected: ${reason}`);
	});
});

const server = Bun.serve({
	port: 3000,
	fetch: app.fetch,
	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
	},
});

io.setBunServer(server);
```

### 2. Type Definitions

Define your events in `shared/types/socket.types.ts`:

```typescript
export interface ClientToServerEvents {
	message: (data: string) => void;
	chat_message: (data: { room: string; message: string }) => void;
	join_room: (room: string) => void;
	get_user_info: (callback: (data: { id: string; name: string }) => void) => void;
}

export interface ServerToClientEvents {
	message: (data: string) => void;
	chat_message: (data: {
		from: string;
		room: string;
		message: string;
		timestamp: string;
	}) => void;
	notification: (message: string) => void;
}
```

### 3. Typed Namespaces

```typescript
interface ChatEvents {
	send_message: (data: { message: string; room: string }) => void;
	join_room: (room: string) => void;
}

interface ChatServerEvents {
	new_message: (data: { user: string; message: string; timestamp: string }) => void;
	user_joined: (data: { user: string; room: string }) => void;
}

const chatNamespace = io.of<ChatEvents, ChatServerEvents>('/chat');

chatNamespace.on('connection', (socket) => {
	// Fully typed socket with IntelliSense
	socket.on('send_message', (data) => {
		// data is typed as { message: string; room: string }
		const { message, room } = data;

		chatNamespace.to(room).emit('new_message', {
			user: socket.id,
			message,
			timestamp: new Date().toISOString(),
		});
	});
});
```

### 4. Rooms & Broadcasting

```typescript
io.on('connection', (socket) => {
	// Join rooms
	socket.join('room1');
	socket.join(['room2', 'room3']);

	// Broadcast to rooms
	socket.to('room1').emit('notification', 'Hello room1!');
	socket.to(['room1', 'room2']).emit('notification', 'Hello multiple rooms!');

	// Broadcast to all except specific sockets/rooms
	socket.broadcast.emit('notification', 'Hello everyone!');
	io.except('room1').emit('notification', 'Hello everyone except room1!');

	// Namespace broadcasting
	io.emit('notification', 'Server announcement');
});
```

### 5. Acknowledgments

```typescript
// Server-side acknowledgments
socket.on('get_user_info', (callback) => {
	callback({ id: socket.id, name: 'John Doe' });
});

// Client->Server with acknowledgment
socket.emit('ping', 'Hello', (response) => {
	console.log('Server responded:', response);
});

// Broadcast with acknowledgments
io.timeout(5000).emit('ping', (err, responses) => {
	if (err) {
		console.error('Some clients did not respond:', err);
	} else {
		console.log('All responses:', responses);
	}
});
```

### 6. Middleware

```typescript
io.use((socket, next) => {
	const token = socket.handshake.auth.token;

	if (!token) {
		return next(new Error('Authentication required'));
	}

	// Add user data to socket
	socket.data.user = {
		id: 'user123',
		name: 'John Doe',
		email: 'john@example.com',
	};

	next();
});
```

## API Reference

### Socket Methods

-   `socket.emit(event, data, ack?)` - Send event to this socket
-   `socket.broadcast.emit(event, data)` - Send to all except this socket
-   `socket.to(room).emit(event, data)` - Send to specific room(s)
-   `socket.join(room)` - Join room(s)
-   `socket.leave(room)` - Leave room
-   `socket.disconnect(close?)` - Disconnect socket

### Namespace Methods

-   `namespace.emit(event, data)` - Send to all sockets in namespace
-   `namespace.to(room).emit(event, data)` - Send to room in namespace
-   `namespace.except(room).emit(event, data)` - Send to all except room/socket
-   `namespace.socketsJoin(room)` - Make all sockets join room
-   `namespace.socketsLeave(room)` - Make all sockets leave room

### Server Methods

-   `io.emit(event, data)` - Send to all connected sockets
-   `io.to(room).emit(event, data)` - Send to room across all namespaces
-   `io.of(name)` - Get/create namespace
-   `io.use(middleware)` - Add middleware

## Development

```bash
mkcert -install
mkcert localhost
```

```bash
# Install dependencies
bun install

# Run development server
bun run index.ts

# The server will start on https://localhost:8443 (development)
# WebSocket endpoint: wss://localhost:8443/ws
```

## Production Notes

-   Set `APP_ENV=production` for production mode
-   Configure proper TLS certificates
-   Set `APP_PORT` environment variable for custom port
-   Use proper authentication middleware instead of mock data

## Type Safety

This implementation provides complete type safety:

-   ✅ Event names are validated at compile time
-   ✅ Event data types are enforced
-   ✅ Acknowledgment callbacks are typed
-   ✅ Socket.data is fully typed
-   ✅ Namespace events are isolated and typed

## Performance

-   Uses Bun's native WebSocket implementation
-   No Engine.IO overhead
-   Direct message passing without protocol translation
-   Efficient msgpack encoding for binary data
-   Optimized room management with native Maps

## License

MIT
