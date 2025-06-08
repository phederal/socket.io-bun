// test-client-types.ts
// Файл для тестирования типизации на стороне клиента socket.io-client

import { io as clientIO, Socket } from 'socket.io-client';

// Те же интерфейсы событий, что и на сервере
interface ServerToClientEvents {
	// Простые события
	pong: () => void;
	welcome: (message: string) => void;

	// События с объектами
	user_joined: (user: { id: string; name: string; avatar?: string }) => void;
	user_left: (userId: string) => void;

	// События сообщений
	new_message: (message: {
		id: string;
		content: string;
		authorId: string;
		authorName: string;
		roomId: string;
		timestamp: string;
		mentions?: string[];
	}) => void;

	// События с acknowledgment
	notification: (data: { type: 'info' | 'warning' | 'error'; message: string }, ack: (received: boolean) => void) => void;

	// События состояния
	typing_indicator: (data: { userId: string; roomId: string; isTyping: boolean }) => void;
	room_members_updated: (data: { roomId: string; members: Array<{ id: string; name: string; role: 'admin' | 'member' }> }) => void;

	// Системные события
	server_message: (message: string, priority: 'low' | 'medium' | 'high') => void;
}

interface ClientToServerEvents {
	// Базовые события
	hello: (message: string) => void;
	ping: () => void;

	// События с acknowledgment
	login: (credentials: { username: string; password: string }, callback: (success: boolean, token?: string) => void) => void;
	join_room: (roomId: string, callback: (success: boolean, members?: string[]) => void) => void;

	// События с complex data
	send_message: (
		data: {
			content: string;
			roomId: string;
			mentions?: string[];
			attachments?: Array<{ type: 'image' | 'file'; url: string; name: string }>;
		},
		callback?: (messageId: string) => void,
	) => void;

	// События без данных
	disconnect_request: () => void;
	typing_start: (roomId: string) => void;
	typing_stop: (roomId: string) => void;

	// События с массивами
	bulk_update: (updates: Array<{ id: string; data: any }>) => void;
}

// Создаем типизированного клиента
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = clientIO('wss://localhost:8443', {
	path: '/ws',
	transports: ['websocket'],
	auth: {
		token: 'your-jwt-token',
	},
	timeout: 10000,
	forceNew: true,
});

// Тестируем обработчики событий от сервера
socket.on('connect', () => {
	console.log('Connected to server:', socket.id);

	// Отправляем типизированное событие серверу
	socket.emit('hello', 'Client connected!');

	// Событие с acknowledgment
	socket.emit(
		'login',
		{
			username: 'testuser',
			password: 'testpass',
		},
		(success, token) => {
			// success должен быть boolean, token должен быть string | undefined
			if (success) {
				console.log('Login successful, token:', token);
			} else {
				console.log('Login failed');
			}
		},
	);
});

socket.on('welcome', (message) => {
	// message должен быть string
	console.log('Welcome message:', message);
});

socket.on('pong', () => {
	// Событие без параметров
	console.log('Received pong');
});

socket.on('user_joined', (user) => {
	// user должен соответствовать интерфейсу
	console.log('User joined:', user.name, 'ID:', user.id);
	if (user.avatar) {
		console.log('Avatar:', user.avatar);
	}
});

socket.on('user_left', (userId) => {
	// userId должен быть string
	console.log('User left:', userId);
});

socket.on('new_message', (message) => {
	// message должен соответствовать интерфейсу
	console.log(`[${message.roomId}] ${message.authorName}: ${message.content}`);
	console.log('Message ID:', message.id);
	console.log('Timestamp:', message.timestamp);

	if (message.mentions && message.mentions.length > 0) {
		console.log('Mentions:', message.mentions);
	}
});

socket.on('notification', (data, ack) => {
	// data должен соответствовать интерфейсу, ack должен быть функцией
	console.log(`[${data.type.toUpperCase()}] ${data.message}`);

	// Подтверждаем получение
	ack(true);
});

socket.on('typing_indicator', (data) => {
	// data должен соответствовать интерфейсу
	if (data.isTyping) {
		console.log(`User ${data.userId} is typing in ${data.roomId}`);
	} else {
		console.log(`User ${data.userId} stopped typing in ${data.roomId}`);
	}
});

socket.on('room_members_updated', (data) => {
	// data должен соответствовать интерфейсу
	console.log(`Room ${data.roomId} members updated:`);
	data.members.forEach((member) => {
		console.log(`- ${member.name} (${member.role})`);
	});
});

socket.on('server_message', (message, priority) => {
	// message должен быть string, priority должен быть 'low' | 'medium' | 'high'
	console.log(`[${priority.toUpperCase()}] Server: ${message}`);
});

// Тестируем отправку событий на сервер
function testClientEvents() {
	// Простое событие
	socket.emit('ping');

	// Событие с данными
	socket.emit('hello', 'Hello from client!');

	// Событие с acknowledgment
	socket.emit('join_room', 'general', (success, members) => {
		if (success) {
			console.log('Joined room, members:', members);

			// Теперь можем отправлять сообщения
			socket.emit(
				'send_message',
				{
					content: 'Hello everyone!',
					roomId: 'general',
					mentions: ['user123'],
					attachments: [{ type: 'image', url: 'https://example.com/image.jpg', name: 'screenshot.jpg' }],
				},
				(messageId) => {
					console.log('Message sent with ID:', messageId);
				},
			);
		}
	});

	// События typing
	socket.emit('typing_start', 'general');

	setTimeout(() => {
		socket.emit('typing_stop', 'general');
	}, 2000);

	// Bulk update
	socket.emit('bulk_update', [
		{ id: '1', data: { status: 'active' } },
		{ id: '2', data: { status: 'inactive' } },
		{ id: '3', data: { status: 'pending' } },
	]);
}

// Тестируем emitWithAck (если поддерживается)
async function testEmitWithAck() {
	try {
		const [success, token] = await socket.emitWithAck('login', {
			username: 'asyncuser',
			password: 'asyncpass',
		});

		if (success) {
			console.log('Async login successful, token:', token);
		}
	} catch (error) {
		console.error('Async login failed:', error);
	}
}

// Тестируем обработку ошибок
socket.on('connect_error', (error) => {
	console.error('Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
	console.log('Disconnected from server:', reason);
});

socket.on('error', (error) => {
	console.error('Socket error:', error);
});

// Тестируем namespace клиентов
const chatSocket: Socket<ServerToClientEvents, ClientToServerEvents> = clientIO('wss://localhost:8443/chat', {
	path: '/ws',
	transports: ['websocket'],
	auth: {
		token: 'your-jwt-token',
	},
});

chatSocket.on('connect', () => {
	console.log('Connected to chat namespace:', chatSocket.id);

	chatSocket.emit(
		'send_message',
		{
			content: 'Hello from chat namespace!',
			roomId: 'chat-general',
		},
		(messageId) => {
			console.log('Chat message sent:', messageId);
		},
	);
});

chatSocket.on('new_message', (message) => {
	console.log(`[CHAT:${message.roomId}] ${message.authorName}: ${message.content}`);
});

// Dynamic namespace
const gameSocket: Socket<ServerToClientEvents, ClientToServerEvents> = clientIO('wss://localhost:8443/game-123', {
	path: '/ws',
	transports: ['websocket'],
});

gameSocket.on('connect', () => {
	console.log('Connected to game namespace:', gameSocket.id);
});

// Вспомогательные функции для тестирования
class ChatClient {
	private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
	private currentRoom?: string;

	constructor(serverUrl: string, token: string) {
		this.socket = clientIO(serverUrl, {
			path: '/ws',
			transports: ['websocket'],
			auth: { token },
		});

		this.setupEventHandlers();
	}

	private setupEventHandlers() {
		this.socket.on('connect', () => {
			console.log('Chat client connected');
		});

		this.socket.on('new_message', (message) => {
			this.handleNewMessage(message);
		});

		this.socket.on('user_joined', (user) => {
			console.log(`${user.name} joined the chat`);
		});

		this.socket.on('typing_indicator', (data) => {
			if (data.roomId === this.currentRoom && data.isTyping) {
				console.log(`${data.userId} is typing...`);
			}
		});
	}

	async login(username: string, password: string): Promise<boolean> {
		return new Promise((resolve) => {
			this.socket.emit('login', { username, password }, (success) => {
				resolve(success);
			});
		});
	}

	async joinRoom(roomId: string): Promise<string[] | null> {
		return new Promise((resolve) => {
			this.socket.emit('join_room', roomId, (success, members) => {
				if (success) {
					this.currentRoom = roomId;
					resolve(members || []);
				} else {
					resolve(null);
				}
			});
		});
	}

	sendMessage(content: string, mentions?: string[]): Promise<string> {
		if (!this.currentRoom) {
			return Promise.reject(new Error('Not in a room'));
		}

		return new Promise((resolve, reject) => {
			this.socket.emit(
				'send_message',
				{
					content,
					roomId: this.currentRoom!,
					mentions,
				},
				(messageId) => {
					if (messageId) {
						resolve(messageId);
					} else {
						reject(new Error('Failed to send message'));
					}
				},
			);
		});
	}

	startTyping() {
		if (this.currentRoom) {
			this.socket.emit('typing_start', this.currentRoom);
		}
	}

	stopTyping() {
		if (this.currentRoom) {
			this.socket.emit('typing_stop', this.currentRoom);
		}
	}

	private handleNewMessage(message: ServerToClientEvents['new_message'] extends (arg: infer T) => void ? T : never) {
		console.log(`[${message.roomId}] ${message.authorName}: ${message.content}`);

		// Проверяем упоминания
		if (message.mentions && message.mentions.includes(this.socket.id || '')) {
			console.log('🔔 You were mentioned!');
		}
	}

	disconnect() {
		this.socket.disconnect();
	}
}

// Пример использования типизированного клиента
async function exampleUsage() {
	const client = new ChatClient('wss://localhost:8443', 'user-token');

	const loginSuccess = await client.login('testuser', 'password123');
	if (!loginSuccess) {
		console.error('Login failed');
		return;
	}

	const members = await client.joinRoom('general');
	if (!members) {
		console.error('Failed to join room');
		return;
	}

	console.log('Room members:', members);

	// Отправляем сообщение с упоминанием
	try {
		const messageId = await client.sendMessage('Hello everyone! @user123', ['user123']);
		console.log('Message sent:', messageId);
	} catch (error) {
		console.error('Failed to send message:', error);
	}

	// Симулируем набор текста
	client.startTyping();
	setTimeout(() => {
		client.stopTyping();
	}, 3000);
}

export { socket, chatSocket, gameSocket, ChatClient, exampleUsage };
