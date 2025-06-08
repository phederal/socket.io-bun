// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from './utils/test-env';
import type { Socket } from '../src/socket';

interface User {
	id: string;
	name: string;
	status: 'online' | 'away' | 'busy' | 'offline';
	friends: string[];
}

interface ChatMessage {
	id: string;
	content: string;
	authorId: string;
	authorName: string;
	roomId: string;
	timestamp: string;
	type: 'text' | 'system' | 'private';
	mentions?: string[];
}

interface ChatRoom {
	id: string;
	name: string;
	type: 'public' | 'private' | 'direct';
	members: string[];
	admins: string[];
	createdBy: string;
	createdAt: string;
}

interface FriendRequest {
	id: string;
	fromUserId: string;
	toUserId: string;
	fromUserName: string;
	status: 'pending' | 'accepted' | 'rejected';
	timestamp: string;
}

interface ChatClientEvents {
	user_connect: (userData: { name: string; status: User['status'] }) => void;
	user_disconnect: () => void;
	send_message: (data: { content: string; roomId: string; mentions?: string[] }, callback: (success: boolean, messageId?: string) => void) => void;
	send_private_message: (data: { content: string; targetUserId: string }, callback: (success: boolean, messageId?: string) => void) => void;
	edit_message: (data: { messageId: string; newContent: string }) => void;
	delete_message: (messageId: string) => void;
	create_room: (data: { name: string; type: 'public' | 'private'; members?: string[] }, callback: (success: boolean, roomId?: string) => void) => void;
	join_room: (roomId: string, callback: (success: boolean) => void) => void;
	leave_room: (roomId: string) => void;
	get_room_members: (roomId: string, callback: (members: User[]) => void) => void;
	send_friend_request: (targetUserId: string, callback: (success: boolean, error?: string) => void) => void;
	accept_friend_request: (requestId: string) => void;
	reject_friend_request: (requestId: string) => void;
	remove_friend: (friendId: string) => void;
	get_friends_list: (callback: (friends: User[]) => void) => void;
	update_status: (status: User['status']) => void;
	typing_start: (roomId: string) => void;
	typing_stop: (roomId: string) => void;
	broadcast_to_friends: (data: { message: string; type: string }, callback: (responses: Array<{ userId: string; success: boolean }>) => void) => void;
	notify_room_members: (data: { roomId: string; notification: string }, callback: (deliveredCount: number) => void) => void;
}

interface ChatServerEvents {
	user_joined: (user: User) => void;
	user_left: (userId: string) => void;
	user_status_changed: (data: { userId: string; status: User['status'] }) => void;
	friends_list_updated: (friends: User[]) => void;
	new_message: (message: ChatMessage) => void;
	message_edited: (data: { messageId: string; newContent: string; editedAt: string }) => void;
	message_deleted: (messageId: string) => void;
	private_message: (message: ChatMessage) => void;
	room_created: (room: ChatRoom) => void;
	joined_room: (room: ChatRoom) => void;
	left_room: (data: { roomId: string; userId: string }) => void;
	room_members_updated: (data: { roomId: string; members: User[] }) => void;
	friend_request_received: (request: FriendRequest) => void;
	friend_request_accepted: (data: { fromUserId: string; fromUserName: string }) => void;
	friend_request_rejected: (data: { fromUserId: string }) => void;
	friend_added: (friend: User) => void;
	friend_removed: (data: { friendId: string }) => void;
	typing_indicator: (data: { userId: string; userName: string; roomId: string; isTyping: boolean }) => void;
	mention_notification: (data: { messageId: string; roomId: string; fromUser: string }) => void;
	friend_broadcast: (data: { fromUserId: string; fromUserName: string; message: string; type: string }) => void;
	room_notification: (data: { roomId: string; notification: string; fromUserId: string }) => void;
	error: (error: { code: string; message: string }) => void;
	connection_confirmed: (userData: User) => void;
}

describe('Chat System', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	let chatRooms: Map<string, ChatRoom>;
	let userSessions: Map<string, User>;
	let friendRequests: Map<string, FriendRequest>;
	let messages: Map<string, ChatMessage>;

	beforeEach(() => {
		chatRooms = new Map();
		userSessions = new Map();
		friendRequests = new Map();
		messages = new Map();
	});

	afterEach(() => cleanup());

	// Вспомогательная функция для настройки сервера
	const setupServer = async () => {
		const io = await createServer();

		io.on('connection', (socket: Socket<ChatClientEvents, ChatServerEvents>) => {
			let currentUser: User | null = null;

			socket.on('user_connect', (userData) => {
				currentUser = {
					id: socket.id,
					name: userData.name,
					status: userData.status,
					friends: [],
				};

				userSessions.set(socket.id, currentUser);
				socket.join('online_users');
				socket.emit('connection_confirmed', currentUser);
				socket.broadcast.emit('user_joined', currentUser);
			});

			socket.on('create_room', (data, callback) => {
				if (!currentUser) return callback(false);

				const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
				const room: ChatRoom = {
					id: roomId,
					name: data.name,
					type: data.type,
					members: [currentUser.id],
					admins: [currentUser.id],
					createdBy: currentUser.id,
					createdAt: new Date().toISOString(),
				};

				if (data.members) {
					room.members.push(...data.members.filter((id) => id !== currentUser.id));
				}

				chatRooms.set(roomId, room);
				socket.join(roomId);

				room.members.forEach((memberId) => {
					if (memberId !== currentUser!.id) {
						const memberSocket = io.sockets.sockets.get(memberId);
						if (memberSocket) {
							memberSocket.join(roomId);
							memberSocket.emit('joined_room', room);
						}
					}
				});

				socket.emit('room_created', room);
				callback(true, roomId);
			});

			socket.on('join_room', (roomId, callback) => {
				const room = chatRooms.get(roomId);
				if (!room || !currentUser) return callback(false);

				if (!room.members.includes(currentUser.id)) {
					room.members.push(currentUser.id);
				}

				socket.join(roomId);
				socket.emit('joined_room', room);
				callback(true);
			});

			socket.on('send_message', (data, callback) => {
				if (!currentUser) return callback(false);

				const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
				const message: ChatMessage = {
					id: messageId,
					content: data.content,
					authorId: currentUser.id,
					authorName: currentUser.name,
					roomId: data.roomId,
					timestamp: new Date().toISOString(),
					type: 'text',
					mentions: data.mentions,
				};

				messages.set(messageId, message);
				io.to(data.roomId).emit('new_message', message);

				if (data.mentions && data.mentions.length > 0) {
					data.mentions.forEach((mentionedUserId) => {
						const mentionedSocket = io.sockets.sockets.get(mentionedUserId);
						if (mentionedSocket) {
							mentionedSocket.emit('mention_notification', {
								messageId,
								roomId: data.roomId,
								fromUser: currentUser!.name,
							});
						}
					});
				}

				callback(true, messageId);
			});

			socket.on('send_private_message', (data, callback) => {
				if (!currentUser) return callback(false);

				const messageId = `pm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
				const message: ChatMessage = {
					id: messageId,
					content: data.content,
					authorId: currentUser.id,
					authorName: currentUser.name,
					roomId: `direct_${currentUser.id}_${data.targetUserId}`,
					timestamp: new Date().toISOString(),
					type: 'private',
				};

				messages.set(messageId, message);

				const targetSocket = io.sockets.sockets.get(data.targetUserId);
				if (targetSocket) {
					targetSocket.emit('private_message', message);
					socket.emit('private_message', message);
					callback(true, messageId);
				} else {
					callback(false);
				}
			});

			socket.on('send_friend_request', (targetUserId, callback) => {
				if (!currentUser || targetUserId === currentUser.id) {
					return callback(false, 'Invalid target user');
				}

				const targetUser = userSessions.get(targetUserId);
				if (!targetUser) {
					return callback(false, 'User not found');
				}

				const requestId = `freq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
				const friendRequest: FriendRequest = {
					id: requestId,
					fromUserId: currentUser.id,
					toUserId: targetUserId,
					fromUserName: currentUser.name,
					status: 'pending',
					timestamp: new Date().toISOString(),
				};

				friendRequests.set(requestId, friendRequest);

				const targetSocket = io.sockets.sockets.get(targetUserId);
				if (targetSocket) {
					targetSocket.emit('friend_request_received', friendRequest);
				}

				callback(true);
			});

			socket.on('accept_friend_request', (requestId) => {
				const request = friendRequests.get(requestId);
				if (!request || request.toUserId !== currentUser?.id) return;

				request.status = 'accepted';

				const fromUser = userSessions.get(request.fromUserId);
				if (fromUser && currentUser) {
					fromUser.friends.push(currentUser.id);
					currentUser.friends.push(fromUser.id);

					const fromSocket = io.sockets.sockets.get(request.fromUserId);
					if (fromSocket) {
						fromSocket.emit('friend_request_accepted', {
							fromUserId: currentUser.id,
							fromUserName: currentUser.name,
						});
						fromSocket.emit('friend_added', currentUser);
					}

					socket.emit('friend_added', fromUser);
				}
			});

			socket.on('broadcast_to_friends', (data, callback) => {
				if (!currentUser) return callback([]);

				const responses: Array<{ userId: string; success: boolean }> = [];
				currentUser.friends.forEach((friendId) => {
					const friendSocket = io.sockets.sockets.get(friendId);
					if (friendSocket) {
						friendSocket.emit('friend_broadcast', {
							fromUserId: currentUser!.id,
							fromUserName: currentUser!.name,
							message: data.message,
							type: data.type,
						});
						responses.push({ userId: friendId, success: true });
					} else {
						responses.push({ userId: friendId, success: false });
					}
				});

				callback(responses);
			});

			socket.on('notify_room_members', (data, callback) => {
				const room = chatRooms.get(data.roomId);
				if (!room || !currentUser) return callback(0);

				let deliveredCount = 0;
				room.members.forEach((memberId) => {
					if (memberId !== currentUser!.id) {
						const memberSocket = io.sockets.sockets.get(memberId);
						if (memberSocket) {
							memberSocket.emit('room_notification', {
								roomId: data.roomId,
								notification: data.notification,
								fromUserId: currentUser!.id,
							});
							deliveredCount++;
						}
					}
				});

				callback(deliveredCount);
			});

			socket.on('typing_start', (roomId) => {
				if (!currentUser) return;
				socket.to(roomId).emit('typing_indicator', {
					userId: currentUser.id,
					userName: currentUser.name,
					roomId,
					isTyping: true,
				});
			});

			socket.on('edit_message', (data) => {
				const message = messages.get(data.messageId);
				if (!message || message.authorId !== currentUser?.id) return;

				message.content = data.newContent;
				io.to(message.roomId).emit('message_edited', {
					messageId: data.messageId,
					newContent: data.newContent,
					editedAt: new Date().toISOString(),
				});
			});

			socket.on('disconnect', () => {
				if (currentUser) {
					userSessions.delete(currentUser.id);
					socket.broadcast.emit('user_left', currentUser.id);
				}
			});
		});

		return io;
	};

	describe('User Authentication', () => {
		test('should authenticate users successfully', async () => {
			const io = await setupServer();
			const aliceClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Authentication timeout')), 3000);

				aliceClient.on('connection_confirmed', (user) => {
					clearTimeout(timeout);
					expect(user.name).toBe('Alice');
					expect(user.status).toBe('online');
					expect(user.id).toBeDefined();
					resolve();
				});

				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				aliceClient.on('connect_error', reject);
			});
		});

		test('should broadcast user joined to other clients', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('User joined broadcast timeout')), 3000);

				bobClient.on('user_joined', (user) => {
					clearTimeout(timeout);
					expect(user.name).toBe('Alice');
					resolve();
				});

				aliceClient.on('connection_confirmed', () => {
					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				});

				bobClient.on('connection_confirmed', () => {
					// Alice подключается после Bob
					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				});

				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});
	});

	describe('Room Management', () => {
		test('should create public room successfully', async () => {
			const io = await setupServer();
			const aliceClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Room creation timeout')), 3000);

				aliceClient.on('connection_confirmed', () => {
					aliceClient.emit('create_room', { name: 'General Chat', type: 'public' }, (success, roomId) => {
						clearTimeout(timeout);
						expect(success).toBe(true);
						expect(roomId).toBeDefined();
						resolve();
					});
				});

				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				aliceClient.on('connect_error', reject);
			});
		});

		test('should create private room with members', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Private room creation timeout')), 3000);
				let aliceConnected = false;
				let bobConnected = false;

				const checkBothConnected = () => {
					if (aliceConnected && bobConnected) {
						aliceClient.emit(
							'create_room',
							{
								name: 'Private Group',
								type: 'private',
								members: [bobClient.id!],
							},
							(success, roomId) => {
								clearTimeout(timeout);
								expect(success).toBe(true);
								expect(roomId).toBeDefined();
								resolve();
							},
						);
					}
				};

				aliceClient.on('connection_confirmed', () => {
					aliceConnected = true;
					checkBothConnected();
				});

				bobClient.on('connection_confirmed', () => {
					bobConnected = true;
					checkBothConnected();
				});

				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});

		test('should join existing room', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Join room timeout')), 3000);
				let roomId = '';

				aliceClient.on('connection_confirmed', () => {
					aliceClient.emit('create_room', { name: 'Test Room', type: 'public' }, (success, createdRoomId) => {
						roomId = createdRoomId!;
					});
				});

				bobClient.on('connection_confirmed', () => {
					setTimeout(() => {
						bobClient.emit('join_room', roomId, (success) => {
							clearTimeout(timeout);
							expect(success).toBe(true);
							resolve();
						});
					}, 100);
				});

				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});
	});

	describe('Messaging', () => {
		test('should send message to room', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Message sending timeout')), 3000);
				let aliceConnected = false;
				let bobConnected = false;
				let roomId = '';

				// Bob получает сообщение в комнате
				bobClient.on('new_message', (message) => {
					clearTimeout(timeout);
					expect(message.content).toBe('Hello everyone!');
					expect(message.authorName).toBe('Alice');
					expect(message.type).toBe('text');
					expect(message.roomId).toBe(roomId);
					resolve();
				});

				// Проверяем что оба пользователя подключились
				const checkBothConnected = () => {
					if (aliceConnected && bobConnected) {
						// Создаем комнату с Bob в качестве участника
						aliceClient.emit('create_room', { name: 'Test Room', type: 'public', members: [bobClient.id!] }, (success, createdRoomId) => {
							expect(success).toBe(true);
							expect(createdRoomId).toBeDefined();
							roomId = createdRoomId!;

							// Небольшая задержка чтобы убедиться что Bob добавлен в комнату
							setTimeout(() => {
								aliceClient.emit('send_message', { content: 'Hello everyone!', roomId }, (success, messageId) => {
									expect(success).toBe(true);
									expect(messageId).toBeDefined();
								});
							}, 50);
						});
					}
				};

				aliceClient.on('connection_confirmed', () => {
					aliceConnected = true;
					checkBothConnected();
				});

				bobClient.on('connection_confirmed', () => {
					bobConnected = true;
					checkBothConnected();
				});

				// Подключаем пользователей
				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });

				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});

		test('should send private message', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Private message timeout')), 3000);
				let aliceConnected = false;
				let bobConnected = false;

				// Bob получает приватное сообщение
				bobClient.on('private_message', (message) => {
					clearTimeout(timeout);
					expect(message.content).toBe('Hi Bob, private message!');
					expect(message.authorName).toBe('Alice');
					expect(message.type).toBe('private');
					resolve();
				});

				// Проверяем что оба пользователя подключились
				const checkBothConnected = () => {
					if (aliceConnected && bobConnected) {
						// Отправляем приватное сообщение только когда оба подключились
						aliceClient.emit('send_private_message', { content: 'Hi Bob, private message!', targetUserId: bobClient.id! }, (success, messageId) => {
							expect(success).toBe(true);
							expect(messageId).toBeDefined();
						});
					}
				};

				aliceClient.on('connection_confirmed', () => {
					aliceConnected = true;
					checkBothConnected();
				});

				bobClient.on('connection_confirmed', () => {
					bobConnected = true;
					checkBothConnected();
				});

				// Подключаем пользователей
				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });

				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});

		test('should handle message mentions', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Mention timeout')), 3000);
				let aliceConnected = false;
				let bobConnected = false;
				let roomId = '';

				bobClient.on('mention_notification', (data) => {
					clearTimeout(timeout);
					expect(data.fromUser).toBe('Alice');
					expect(data.roomId).toBe(roomId);
					resolve();
				});

				const checkBothConnected = () => {
					if (aliceConnected && bobConnected) {
						aliceClient.emit('create_room', { name: 'Test Room', type: 'public', members: [bobClient.id!] }, (success, createdRoomId) => {
							roomId = createdRoomId!;
							setTimeout(() => {
								aliceClient.emit(
									'send_message',
									{
										content: `Hey @${bobClient.id}, check this out!`,
										roomId,
										mentions: [bobClient.id!],
									},
									(success) => {
										expect(success).toBe(true);
									},
								);
							}, 50);
						});
					}
				};

				aliceClient.on('connection_confirmed', () => {
					aliceConnected = true;
					checkBothConnected();
				});

				bobClient.on('connection_confirmed', () => {
					bobConnected = true;
					checkBothConnected();
				});

				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});

		test('should edit message', async () => {
			const io = await setupServer();
			const aliceClient = createClient();
			const bobClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Edit message timeout')), 3000);
				let aliceConnected = false;
				let bobConnected = false;
				let roomId = '';
				let messageId = '';

				bobClient.on('message_edited', (data) => {
					clearTimeout(timeout);
					expect(data.messageId).toBe(messageId);
					expect(data.newContent).toBe('Updated message content');
					expect(data.editedAt).toBeDefined();
					resolve();
				});

				const checkBothConnected = () => {
					if (aliceConnected && bobConnected) {
						aliceClient.emit('create_room', { name: 'Test Room', type: 'public', members: [bobClient.id!] }, (success, createdRoomId) => {
							roomId = createdRoomId!;
							setTimeout(() => {
								aliceClient.emit('send_message', { content: 'Original message', roomId }, (success, createdMessageId) => {
									messageId = createdMessageId!;
									// Редактируем сообщение
									setTimeout(() => {
										aliceClient.emit('edit_message', {
											messageId,
											newContent: 'Updated message content',
										});
									}, 50);
								});
							}, 50);
						});
					}
				};

				aliceClient.on('connection_confirmed', () => {
					aliceConnected = true;
					checkBothConnected();
				});

				bobClient.on('connection_confirmed', () => {
					bobConnected = true;
					checkBothConnected();
				});

				aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
				bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
				aliceClient.on('connect_error', reject);
				bobClient.on('connect_error', reject);
			});
		});

		describe('Friends System', () => {
			test('should send friend request', async () => {
				const io = await setupServer();
				const aliceClient = createClient();
				const bobClient = createClient();

				return new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('Friend request timeout')), 3000);
					let aliceConnected = false;
					let bobConnected = false;

					bobClient.on('friend_request_received', (request) => {
						clearTimeout(timeout);
						expect(request.fromUserName).toBe('Alice');
						expect(request.status).toBe('pending');
						resolve();
					});

					const checkBothConnected = () => {
						if (aliceConnected && bobConnected) {
							aliceClient.emit('send_friend_request', bobClient.id!, (success, error) => {
								expect(success).toBe(true);
								expect(error).toBeUndefined();
							});
						}
					};

					aliceClient.on('connection_confirmed', () => {
						aliceConnected = true;
						checkBothConnected();
					});

					bobClient.on('connection_confirmed', () => {
						bobConnected = true;
						checkBothConnected();
					});

					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
					bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
					aliceClient.on('connect_error', reject);
					bobClient.on('connect_error', reject);
				});
			});

			test('should accept friend request', async () => {
				const io = await setupServer();
				const aliceClient = createClient();
				const bobClient = createClient();

				return new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('Accept friend request timeout')), 3000);
					let aliceConnected = false;
					let bobConnected = false;
					let requestId = '';

					aliceClient.on('friend_request_accepted', (data) => {
						clearTimeout(timeout);
						expect(data.fromUserName).toBe('Bob');
						resolve();
					});

					bobClient.on('friend_request_received', (request) => {
						requestId = request.id;
						bobClient.emit('accept_friend_request', requestId);
					});

					const checkBothConnected = () => {
						if (aliceConnected && bobConnected) {
							aliceClient.emit('send_friend_request', bobClient.id!, (success) => {
								expect(success).toBe(true);
							});
						}
					};

					aliceClient.on('connection_confirmed', () => {
						aliceConnected = true;
						checkBothConnected();
					});

					bobClient.on('connection_confirmed', () => {
						bobConnected = true;
						checkBothConnected();
					});

					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
					bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
					aliceClient.on('connect_error', reject);
					bobClient.on('connect_error', reject);
				});
			});
		});

		describe('Group Operations with ACK', () => {
			test('should broadcast to friends with acknowledgment', async () => {
				const io = await setupServer();
				const aliceClient = createClient();
				const bobClient = createClient();

				return new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('Friend broadcast timeout')), 3000);
					let aliceConnected = false;
					let bobConnected = false;
					let requestId = '';

					bobClient.on('friend_broadcast', (data) => {
						expect(data.fromUserName).toBe('Alice');
						expect(data.message).toBe('Hello all my friends!');
						expect(data.type).toBe('announcement');
					});

					bobClient.on('friend_request_received', (request) => {
						requestId = request.id;
						bobClient.emit('accept_friend_request', requestId);
					});

					aliceClient.on('friend_added', () => {
						// Теперь отправляем групповое сообщение
						aliceClient.emit('broadcast_to_friends', { message: 'Hello all my friends!', type: 'announcement' }, (responses) => {
							clearTimeout(timeout);
							expect(responses).toHaveLength(1);
							expect(responses[0]?.userId).toBe(bobClient.id);
							expect(responses[0]?.success).toBe(true);
							resolve();
						});
					});

					const checkBothConnected = () => {
						if (aliceConnected && bobConnected) {
							aliceClient.emit('send_friend_request', bobClient.id!, (success) => {
								expect(success).toBe(true);
							});
						}
					};

					aliceClient.on('connection_confirmed', () => {
						aliceConnected = true;
						checkBothConnected();
					});

					bobClient.on('connection_confirmed', () => {
						bobConnected = true;
						checkBothConnected();
					});

					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
					bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
					aliceClient.on('connect_error', reject);
					bobClient.on('connect_error', reject);
				});
			});

			test('should notify room members with delivery count', async () => {
				const io = await setupServer();
				const aliceClient = createClient();
				const bobClient = createClient();
				const charlieClient = createClient();

				return new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('Room notification timeout')), 3000);
					let aliceConnected = false;
					let bobConnected = false;
					let charlieConnected = false;
					let roomId = '';

					bobClient.on('room_notification', (data) => {
						expect(data.notification).toBe('Meeting starts in 5 minutes');
						expect(data.fromUserId).toBe(aliceClient.id);
					});

					charlieClient.on('room_notification', (data) => {
						expect(data.notification).toBe('Meeting starts in 5 minutes');
						expect(data.fromUserId).toBe(aliceClient.id);
					});

					const checkAllConnected = () => {
						if (aliceConnected && bobConnected && charlieConnected) {
							aliceClient.emit(
								'create_room',
								{
									name: 'Meeting Room',
									type: 'private',
									members: [bobClient.id!, charlieClient.id!],
								},
								(success, createdRoomId) => {
									roomId = createdRoomId!;
									setTimeout(() => {
										// Теперь отправляем уведомление
										aliceClient.emit('notify_room_members', { roomId, notification: 'Meeting starts in 5 minutes' }, (deliveredCount) => {
											clearTimeout(timeout);
											expect(deliveredCount).toBe(2); // Bob и Charlie
											resolve();
										});
									}, 100);
								},
							);
						}
					};

					aliceClient.on('connection_confirmed', () => {
						aliceConnected = true;
						checkAllConnected();
					});

					bobClient.on('connection_confirmed', () => {
						bobConnected = true;
						checkAllConnected();
					});

					charlieClient.on('connection_confirmed', () => {
						charlieConnected = true;
						checkAllConnected();
					});

					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
					bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
					charlieClient.emit('user_connect', { name: 'Charlie', status: 'away' });
					aliceClient.on('connect_error', reject);
					bobClient.on('connect_error', reject);
					charlieClient.on('connect_error', reject);
				});
			});
		});

		describe('Real-time Features', () => {
			test('should handle typing indicators', async () => {
				const io = await setupServer();
				const aliceClient = createClient();
				const bobClient = createClient();

				return new Promise<void>((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('Typing indicator timeout')), 3000);
					let aliceConnected = false;
					let bobConnected = false;
					let roomId = '';

					bobClient.on('typing_indicator', (data) => {
						clearTimeout(timeout);
						expect(data.userName).toBe('Alice');
						expect(data.isTyping).toBe(true);
						expect(data.roomId).toBe(roomId);
						resolve();
					});

					const checkBothConnected = () => {
						if (aliceConnected && bobConnected) {
							aliceClient.emit('create_room', { name: 'Test Room', type: 'public', members: [bobClient.id!] }, (success, createdRoomId) => {
								roomId = createdRoomId!;
								setTimeout(() => {
									aliceClient.emit('typing_start', roomId);
								}, 50);
							});
						}
					};

					aliceClient.on('connection_confirmed', () => {
						aliceConnected = true;
						checkBothConnected();
					});

					bobClient.on('connection_confirmed', () => {
						bobConnected = true;
						checkBothConnected();
					});

					aliceClient.emit('user_connect', { name: 'Alice', status: 'online' });
					bobClient.emit('user_connect', { name: 'Bob', status: 'online' });
					aliceClient.on('connect_error', reject);
					bobClient.on('connect_error', reject);
				});
			});
		});
	});
});
