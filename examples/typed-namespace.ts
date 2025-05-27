/**
 * Пример правильной типизации namespace с полными типами
 */

import { io } from '../socket/server';
import type { EventsMap, SocketData } from '../types/socket.types';

// ==== 1. Определяем события для Chat namespace ====

interface ChatClientEvents extends EventsMap {
	// Отправка сообщений
	send_message: (data: { message: string; room: string }) => void;
	send_private_message: (data: { message: string; targetUserId: string }) => void;

	// Управление комнатами
	join_room: (roomId: string) => void;
	leave_room: (roomId: string) => void;
	create_room: (
		data: { name: string; isPrivate: boolean },
		callback: (roomId: string) => void
	) => void;

	// Статус печати
	typing_start: (roomId: string) => void;
	typing_stop: (roomId: string) => void;

	// Получение информации
	get_room_users: (roomId: string, callback: (users: ChatUser[]) => void) => void;
	get_message_history: (roomId: string, callback: (messages: ChatMessage[]) => void) => void;
}

interface ChatServerEvents extends EventsMap {
	// Сообщения
	new_message: (message: ChatMessage) => void;
	private_message: (message: PrivateMessage) => void;

	// События комнат
	room_joined: (data: { roomId: string; user: ChatUser }) => void;
	room_left: (data: { roomId: string; userId: string }) => void;
	room_created: (room: ChatRoom) => void;
	user_joined_room: (data: { roomId: string; user: ChatUser }) => void;
	user_left_room: (data: { roomId: string; userId: string }) => void;

	// Статус печати
	user_typing: (data: { roomId: string; userId: string; username: string }) => void;
	user_stopped_typing: (data: { roomId: string; userId: string }) => void;

	// Ошибки и уведомления
	error: (error: { code: number; message: string }) => void;
	notification: (message: string) => void;
}

// Типы данных для сокета в Chat namespace
interface ChatSocketData extends SocketData {
	user: {
		id: string;
		username: string;
		avatar?: string;
		status: 'online' | 'away' | 'busy';
	};
	currentRooms: string[];
	lastSeen: Date;
}

// Интерфейсы для данных
interface ChatMessage {
	id: string;
	content: string;
	authorId: string;
	authorName: string;
	roomId: string;
	timestamp: string;
	type: 'text' | 'image' | 'file';
}

interface PrivateMessage {
	id: string;
	content: string;
	fromId: string;
	fromName: string;
	toId: string;
	timestamp: string;
}

interface ChatUser {
	id: string;
	username: string;
	avatar?: string;
	status: 'online' | 'away' | 'busy';
	joinedAt?: string;
}

interface ChatRoom {
	id: string;
	name: string;
	isPrivate: boolean;
	memberCount: number;
	createdAt: string;
	createdBy: string;
}

// ==== 2. Создаем типизированный namespace ====

const chatNamespace = io.of<
	ChatClientEvents, // События от клиента
	ChatServerEvents, // События к клиенту
	{}, // Inter-server события (пустые)
	ChatSocketData // Данные сокета
>('/chat');

// ==== 3. Типизированные обработчики событий ====

// ✅ socket теперь полностью типизирован!
chatNamespace.on('connection', (socket) => {
	console.log(`Chat socket ${socket.id} connected`);

	// ✅ socket.data типизирован как ChatSocketData
	socket.data.user = {
		id: socket.id,
		username: `User_${socket.id.slice(0, 8)}`,
		status: 'online',
	};
	socket.data.currentRooms = [];
	socket.data.lastSeen = new Date();

	// ✅ Все события автоматически типизированы с автокомплитом
	socket.on('send_message', (data) => {
		// data типизируется как { message: string; room: string }
		const { message, room } = data;

		// Проверяем, что пользователь в комнате
		if (!socket.data.currentRooms.includes(room)) {
			socket.emit('error', { code: 403, message: 'You are not in this room' });
			return;
		}

		const chatMessage: ChatMessage = {
			id: generateMessageId(),
			content: message,
			authorId: socket.id,
			authorName: socket.data.user.username,
			roomId: room,
			timestamp: new Date().toISOString(),
			type: 'text',
		};

		// ✅ Типизированная отправка в комнату
		chatNamespace.to(room).emit('new_message', chatMessage);
	});

	socket.on('send_private_message', (data) => {
		// data типизируется как { message: string; targetUserId: string }
		const { message, targetUserId } = data;

		const privateMessage: PrivateMessage = {
			id: generateMessageId(),
			content: message,
			fromId: socket.id,
			fromName: socket.data.user.username,
			toId: targetUserId,
			timestamp: new Date().toISOString(),
		};

		// Отправляем приватное сообщение конкретному пользователю
		chatNamespace.to(targetUserId).emit('private_message', privateMessage);
		// И отправляем копию отправителю
		socket.emit('private_message', privateMessage);
	});

	socket.on('join_room', (roomId) => {
		// roomId типизируется как string
		socket.join(roomId);
		socket.data.currentRooms.push(roomId);

		const user: ChatUser = {
			id: socket.id,
			username: socket.data.user.username,
			avatar: socket.data.user.avatar,
			status: socket.data.user.status,
			joinedAt: new Date().toISOString(),
		};

		// ✅ Типизированные события
		socket.emit('room_joined', { roomId, user });
		socket.to(roomId).emit('user_joined_room', { roomId, user });
	});

	socket.on('leave_room', (roomId) => {
		socket.leave(roomId);
		socket.data.currentRooms = socket.data.currentRooms.filter((r) => r !== roomId);

		socket.emit('room_left', { roomId, userId: socket.id });
		socket.to(roomId).emit('user_left_room', { roomId, userId: socket.id });
	});

	// ✅ Типизированные acknowledgment callbacks
	socket.on('create_room', (data, callback) => {
		// data типизируется как { name: string; isPrivate: boolean }
		// callback типизируется как (roomId: string) => void
		const { name, isPrivate } = data;

		const roomId = generateRoomId();
		const room: ChatRoom = {
			id: roomId,
			name,
			isPrivate,
			memberCount: 1,
			createdAt: new Date().toISOString(),
			createdBy: socket.id,
		};

		// Создатель автоматически присоединяется к комнате
		socket.join(roomId);
		socket.data.currentRooms.push(roomId);

		// Уведомляем всех о новой комнате (если публичная)
		if (!isPrivate) {
			chatNamespace.emit('room_created', room);
		}

		// ✅ Типизированный callback
		callback(roomId);
	});

	socket.on('get_room_users', (roomId, callback) => {
		// Получаем всех пользователей в комнате
		const users: ChatUser[] = [];
		const socketsInRoom = chatNamespace.adapter.getSockets(new Set([roomId]));

		for (const socketId of socketsInRoom) {
			const roomSocket = chatNamespace.sockets.get(socketId);
			if (roomSocket) {
				users.push({
					id: roomSocket.id,
					username: roomSocket.data.user.username,
					avatar: roomSocket.data.user.avatar,
					status: roomSocket.data.user.status,
				});
			}
		}

		// ✅ Типизированный callback
		callback(users);
	});

	socket.on('typing_start', (roomId) => {
		socket.to(roomId).emit('user_typing', {
			roomId,
			userId: socket.id,
			username: socket.data.user.username,
		});
	});

	socket.on('typing_stop', (roomId) => {
		socket.to(roomId).emit('user_stopped_typing', {
			roomId,
			userId: socket.id,
		});
	});

	socket.on('disconnect', (reason) => {
		console.log(`Chat socket ${socket.id} disconnected: ${reason}`);

		// Уведомляем все комнаты о выходе пользователя
		socket.data.currentRooms.forEach((roomId) => {
			socket.to(roomId).emit('user_left_room', {
				roomId,
				userId: socket.id,
			});
		});
	});
});

// ==== 4. Типизированные утилиты для Chat namespace ====

export function sendChatNotification(roomId: string, message: string): void {
	chatNamespace.to(roomId).emit('notification', message);
}

export function sendPrivateNotification(userId: string, message: string): void {
	chatNamespace.to(userId).emit('notification', message);
}

export function broadcastToAllChat(message: string): void {
	chatNamespace.emit('notification', message);
}

export async function getRoomUserCount(roomId: string): Promise<number> {
	const users = chatNamespace.adapter.getSockets(new Set([roomId]));
	return users.size;
}

export async function getAllChatSockets() {
	return await chatNamespace.fetchSockets();
}

// ==== 5. Вспомогательные функции ====

function generateMessageId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateRoomId(): string {
	return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Экспорт типизированного namespace
export { chatNamespace };
export type {
	ChatClientEvents,
	ChatServerEvents,
	ChatSocketData,
	ChatMessage,
	ChatUser,
	ChatRoom,
	PrivateMessage,
};
