/**
 * Example of fully typed Socket.IO usage
 */

import { io } from '../socket/server';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	InterServerEvents,
	SocketData,
	EventsMap,
} from '../types/socket.types';

// ==== 1. Базовое использование с типизацией ====

io.on('connection', (socket) => {
	console.log(`Socket ${socket.id} connected`);

	// ✅ Типизированные события - автокомплит работает
	socket.on('ping', () => {
		socket.emit('pong'); // ✅ Типизировано
	});

	socket.on('message', (data) => {
		// data автоматически типизируется как string
		console.log('Message received:', data);

		// ✅ Типизированный broadcast
		socket.broadcast.emit('message', `${socket.id}: ${data}`);
	});

	socket.on('chat_message', (data) => {
		// data автоматически типизируется как { room: string; message: string }
		const { room, message } = data;

		// ✅ Типизированные room операции
		socket.to(room).emit('chat_message', {
			from: socket.id,
			room,
			message,
			timestamp: new Date().toISOString(),
		});
	});

	socket.on('join_room', (room) => {
		// room автоматически типизируется как string
		socket.join(room);

		// ✅ Типизированные события с автокомплитом
		socket.emit('room_joined', room);
		socket.to(room).emit('user_joined', { userId: socket.id, room });
	});

	// ✅ Acknowledgment с типизацией
	socket.on('get_user_info', (callback) => {
		// callback автоматически типизируется
		callback({ id: socket.id, name: 'User Name' });
	});

	// ✅ События с множественными параметрами
	socket.on('update_position', (x, y, z) => {
		// x, y, z автоматически типизируются как number
		socket.broadcast.emit('position_update', {
			userId: socket.id,
			x,
			y,
			z,
		});
	});

	socket.on('disconnect', (reason) => {
		console.log(`Socket ${socket.id} disconnected: ${reason}`);
	});
});

// ==== 2. Типизированные namespace ====

interface ChatEvents extends EventsMap {
	send_chat: (data: { message: string; channel: string }) => void;
	join_channel: (channel: string) => void;
	leave_channel: (channel: string) => void;
}

interface ChatEmitEvents extends EventsMap {
	new_message: (data: {
		id: string;
		user: string;
		message: string;
		channel: string;
		timestamp: string;
	}) => void;
	user_joined_channel: (data: { user: string; channel: string }) => void;
	user_left_channel: (data: { user: string; channel: string }) => void;
}

// ✅ Создание типизированного namespace
const chatNamespace = io.of<ChatEvents, ChatEmitEvents>('/chat');

chatNamespace.on('connection', (socket) => {
	console.log(`Chat socket ${socket.id} connected`);

	// ✅ Типизация специфичная для namespace
	socket.on('send_chat', (data) => {
		// data типизируется как { message: string; channel: string }
		const { message, channel } = data;

		chatNamespace.to(channel).emit('new_message', {
			id: generateMessageId(),
			user: socket.id,
			message,
			channel,
			timestamp: new Date().toISOString(),
		});
	});

	socket.on('join_channel', (channel) => {
		socket.join(channel);
		socket.to(channel).emit('user_joined_channel', {
			user: socket.id,
			channel,
		});
	});
});

// ==== 3. Typed Middleware ====

io.use((socket, next) => {
	// Типизированная middleware
	const token = socket.handshake.auth.token;

	if (!token) {
		return next(new Error('Authentication error'));
	}

	// Типизированные socket.data
	socket.data.user = {
		id: socket.id,
		name: 'Authenticated User',
		email: 'user@example.com',
	};

	next();
});

// ==== 4. Broadcasting с типизацией ====

// ✅ Типизированный broadcast к комнатам
io.to('room1').emit('notification', 'Hello room1!');
io.to(['room1', 'room2']).emit('notification', 'Hello multiple rooms!');
io.except('admin-room').emit('notification', 'Hello everyone except admins!');

// ✅ Типизированный broadcast с acknowledgment
io.timeout(5000).emit('notification', 'Urgent message', (err, responses) => {
	if (err) {
		console.error('Some clients did not acknowledge:', err);
	} else {
		console.log('All clients acknowledged:', responses);
	}
});

// ==== 5. Вспомогательные функции ====

function generateMessageId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ✅ Типизированные utility функции
export function broadcastToRoom<T extends keyof ServerToClientEvents>(
	room: string,
	event: T,
	...data: Parameters<ServerToClientEvents[T]>
): void {
	io.to(room).emit(event, ...data);
}

export function sendNotificationToUser(userId: string, message: string): void {
	io.to(`user:${userId}`).emit('notification', message);
}

// ✅ Type guards для проверки событий
export function isValidChatMessage(data: any): data is { room: string; message: string } {
	return (
		typeof data === 'object' &&
		typeof data.room === 'string' &&
		typeof data.message === 'string' &&
		data.room.length > 0 &&
		data.message.length > 0
	);
}

// Экспорт типизированного io для использования в других файлах
export { io };
export type { ClientToServerEvents, ServerToClientEvents, ChatEvents, ChatEmitEvents };
