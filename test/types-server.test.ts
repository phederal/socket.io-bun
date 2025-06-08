// test-server-types.ts
import { Server } from '../src/index';
import type { Socket } from '../src/socket';

// Определяем типы событий для тестирования
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
	notification: (data: { type: 'info' | 'warning' | 'error'; message: string }, ack: (response: boolean) => void) => void;

	// События состояния
	typing_indicator: (data: { userId: string; roomId: string; isTyping: boolean }) => void;
	room_members_updated: (data: { roomId: string; members: Array<{ id: string; name: string; role: 'admin' | 'member' }> }) => void;

	// Системные события
	server_message: (message: string, priority: 'low' | 'medium' | 'high') => void;
}

interface InterServerEvents {
	// События между серверами
	server_stats: (stats: { connections: number; rooms: number; messages: number }) => void;
	broadcast_announcement: (message: string) => void;
}

interface SocketData {
	user?: {
		id: string;
		name: string;
		email: string;
		role: 'admin' | 'user' | 'moderator';
	};
	session?: {
		id: string;
		loginTime: string;
		lastActivity: string;
	};
	preferences?: {
		theme: 'light' | 'dark';
		notifications: boolean;
		language: string;
	};
}

// Создаем типизированный сервер
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>({
	pingTimeout: 20000,
	pingInterval: 25000,
	connectTimeout: 45000,
});

// Тестируем основные обработчики событий
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) => {
	console.log('New connection:', socket.id);

	// Проверяем доступ к данным сокета
	console.log('User:', socket.data.user?.name);
	console.log('Session:', socket.data.session?.id);

	// Тестируем типизированные события от клиента
	socket.on('hello', (message) => {
		// message должен быть типа string
		console.log('Received hello:', message);
		socket.emit('welcome', `Hello, ${message}!`);
	});

	socket.on('ping', () => {
		// Событие без параметров
		socket.emit('pong');
	});

	socket.on('login', (credentials, callback) => {
		// credentials должен иметь типы { username: string; password: string }
		console.log('Login attempt:', credentials.username);

		if (credentials.username === 'admin' && credentials.password === 'secret') {
			// Устанавливаем данные пользователя
			socket.data.user = {
				id: socket.id,
				name: credentials.username,
				email: `${credentials.username}@example.com`,
				role: 'admin',
			};

			callback(true, 'jwt-token-here');
		} else {
			callback(false);
		}
	});

	socket.on('join_room', (roomId, callback) => {
		// roomId должен быть string
		socket.join(roomId);

		// Уведомляем других в комнате
		socket.to(roomId).emit('user_joined', {
			id: socket.id,
			name: socket.data.user?.name || 'Anonymous',
			avatar: undefined,
		});

		callback(true, ['user1', 'user2', socket.id]);
	});

	socket.on('send_message', (data, callback) => {
		// data должен соответствовать интерфейсу
		console.log('Message in room:', data.roomId, 'content:', data.content);

		const messageId = `msg_${Date.now()}`;

		// Отправляем всем в комнате
		io.to(data.roomId).emit('new_message', {
			id: messageId,
			content: data.content,
			authorId: socket.id,
			authorName: socket.data.user?.name || 'Anonymous',
			roomId: data.roomId,
			timestamp: new Date().toISOString(),
			mentions: data.mentions,
		});

		// Вызываем callback если он есть
		callback?.(messageId);
	});

	socket.on('typing_start', (roomId) => {
		socket.to(roomId).emit('typing_indicator', {
			userId: socket.id,
			roomId,
			isTyping: true,
		});
	});

	socket.on('bulk_update', (updates) => {
		// updates должен быть массивом
		console.log('Processing bulk updates:', updates.length);
		updates.forEach((update) => {
			console.log('Update:', update.id, update.data);
		});
	});

	socket.on('disconnect', (reason) => {
		console.log('Socket disconnected:', socket.id, reason);

		// Уведомляем все комнаты о выходе пользователя
		socket.rooms.forEach((roomId) => {
			if (roomId !== socket.id) {
				socket.to(roomId).emit('user_left', socket.id);
			}
		});
	});
});

// Тестируем namespace
const chatNamespace = io.of('/chat');
chatNamespace.on('connection', (socket) => {
	console.log('Chat namespace connection:', socket.id);

	socket.on('send_message', (data, callback) => {
		// Тот же обработчик, но в namespace
		const messageId = `chat_${Date.now()}`;

		chatNamespace.to(data.roomId).emit('new_message', {
			id: messageId,
			content: data.content,
			authorId: socket.id,
			authorName: socket.data.user?.name || 'Anonymous',
			roomId: data.roomId,
			timestamp: new Date().toISOString(),
			mentions: data.mentions,
		});

		callback?.(messageId);
	});
});

// Тестируем dynamic namespace с regex
const gameNamespace = io.of(/^\/game-\d+$/);
gameNamespace.on('connection', (socket) => {
	console.log('Game namespace connection:', socket.nsp.name, socket.id);
});

// Тестируем broadcasting
io.emit('server_message', 'Server is starting...', 'medium');

// Тестируем комнаты
io.to('general').emit('server_message', 'Welcome to general room!', 'low');
io.except('muted').emit('server_message', 'Important announcement!', 'high');

// Тестируем модификаторы
io.volatile.emit('server_message', 'This might not be delivered', 'low');
io.local.emit('server_message', 'Local server message', 'medium');

io.timeout(5000).emit('notification', { type: 'info', message: 'Test notification' }, (err, responses) => {
	if (err) {
		console.error('Notification timeout');
	} else {
		console.log('Notification responses:', responses);
	}
});

// Тестируем utility методы
async function testUtilityMethods() {
	// Получаем все сокеты
	const allSockets = await io.fetchSockets();
	console.log('Total sockets:', allSockets.length);

	// Получаем сокеты в комнате
	const roomSockets = await io.in('general').fetchSockets();
	console.log('Sockets in general:', roomSockets.length);

	// Добавляем всех в комнату
	io.socketsJoin('announcement');

	// Удаляем из комнаты
	io.in('general').socketsLeave('announcement');

	// Отключаем всех в комнате
	io.in('spam').disconnectSockets(true);
}

// Тестируем middleware
io.use((socket, next) => {
	// Проверяем авторизацию
	const token = socket.handshake.auth.token;

	if (!token) {
		return next(new Error('Authentication required'));
	}

	// Устанавливаем данные пользователя
	socket.data.user = {
		id: 'user123',
		name: 'Test User',
		email: 'test@example.com',
		role: 'user',
	};

	next();
});

// Middleware для namespace
chatNamespace.use((socket, next) => {
	if (socket.data.user?.role !== 'admin') {
		return next(new Error('Chat access denied'));
	}
	next();
});

export { io, chatNamespace, gameNamespace };
