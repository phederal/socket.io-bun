process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import type { Socket } from '../../src/socket';

describe('Namespace', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	describe('Basic Namespace Operations', () => {
		test('should create and connect to namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace connection timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					clearTimeout(timeout);
					expect(socket.nsp.name).toBe('/chat');
					expect(chatNamespace.sockets.has(socket.id)).toBe(true);
					resolve();
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});

		test('should handle multiple clients in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client1 = createClient({ namespace: '/chat' });
			const client2 = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple clients timeout')), 3000);
				let connectionCount = 0;

				chatNamespace.on('connection', (socket: Socket) => {
					connectionCount++;
					if (connectionCount === 2) {
						clearTimeout(timeout);
						expect(chatNamespace.sockets.size).toBe(2);
						resolve();
					}
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should isolate events between namespaces', async () => {
			const io = await createServer();
			const defaultNamespace = io.sockets;
			const chatNamespace = io.of('/chat');

			const defaultClient = createClient();
			const chatClient = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace isolation timeout')), 3000);
				let defaultReceived = false;
				let chatReceived = false;

				defaultClient.on('test_event', () => {
					defaultReceived = true;
					clearTimeout(timeout);
					reject(new Error('Default namespace should not receive chat event'));
				});

				chatClient.on('test_event', (data: string) => {
					chatReceived = true;
					expect(data).toBe('chat message');

					setTimeout(() => {
						if (!defaultReceived) {
							clearTimeout(timeout);
							resolve();
						}
					}, 500);
				});

				Promise.all([
					new Promise((resolve: (value?: unknown) => void) => defaultClient.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => chatClient.on('connect', resolve)),
				]).then(() => {
					chatNamespace.emit('test_event', 'chat message');
				});

				defaultClient.on('connect_error', reject);
				chatClient.on('connect_error', reject);
			});
		});
	});

	describe('Namespace Middleware', () => {
		test('should execute namespace-specific middleware', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			let middlewareExecuted = false;

			chatNamespace.use((socket, next) => {
				middlewareExecuted = true;
				expect(socket.nsp.name).toBe('/chat');
				next();
			});

			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace middleware timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					clearTimeout(timeout);
					expect(middlewareExecuted).toBe(true);
					resolve();
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});

		test('should handle middleware errors in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');

			chatNamespace.use((socket, next) => {
				next(new Error('Chat access denied'));
			});

			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace middleware error timeout')), 3000);

				chatNamespace.on('connection', () => {
					clearTimeout(timeout);
					reject(new Error('Should not connect with middleware error'));
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					expect(error.message).toContain('Chat access denied');
					resolve();
				});
			});
		});

		test('should execute multiple middleware in order', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const executionOrder: number[] = [];

			chatNamespace.use((socket, next) => {
				executionOrder.push(1);
				next();
			});

			chatNamespace.use((socket, next) => {
				executionOrder.push(2);
				next();
			});

			chatNamespace.use((socket, next) => {
				executionOrder.push(3);
				next();
			});

			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple middleware timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					clearTimeout(timeout);
					expect(executionOrder).toEqual([1, 2, 3]);
					resolve();
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});
	});

	describe('Namespace Broadcasting', () => {
		test('should broadcast to all clients in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client1 = createClient({ namespace: '/chat' });
			const client2 = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace broadcast timeout')), 3000);
				let receivedCount = 0;

				const checkMessage = (message: string) => {
					expect(message).toBe('namespace broadcast');
					receivedCount++;
					if (receivedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('chat_message', checkMessage);
				client2.on('chat_message', checkMessage);

				Promise.all([
					new Promise((resolve: (value?: unknown) => void) => client1.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => client2.on('connect', resolve)),
				]).then(() => {
					chatNamespace.emit('chat_message', 'namespace broadcast');
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should broadcast to specific room in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client1 = createClient({ namespace: '/chat' });
			const client2 = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace room broadcast timeout')), 3000);
				let client1Received = false;
				let client2Received = false;
				let clientsCount = 0;
				chatNamespace.on('connection', (socket: Socket) => {
					clientsCount++;
					if (clientsCount === 1) {
						socket.join('room1');
					}
				});

				client1.on('room_chat', (message: string) => {
					client1Received = true;
					expect(message).toBe('room message');

					setTimeout(() => {
						if (!client2Received) {
							clearTimeout(timeout);
							resolve();
						}
					}, 500);
				});

				client2.on('room_chat', () => {
					client2Received = true;
					clearTimeout(timeout);
					reject(new Error('Client2 should not receive room message'));
				});

				Promise.all([
					new Promise((resolve: (value?: unknown) => void) => client1.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => client2.on('connect', resolve)),
				]).then(() => {
					setTimeout(() => {
						chatNamespace.to('room1').emit('room_chat', 'room message');
					}, 100);
				});
			});
		});

		test('should exclude specific rooms in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client1 = createClient({ namespace: '/chat' });
			const client2 = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace except timeout')), 3000);
				let client1Received = false;
				let client2Received = false;
				let clientsCount = 0;

				chatNamespace.on('connection', (socket: Socket) => {
					clientsCount++;
					if (clientsCount === 1) {
						socket.join('excluded');
					}
				});

				client1.on('except_chat', () => {
					client1Received = true;
					clearTimeout(timeout);
					reject(new Error('Client1 should not receive message'));
				});

				client2.on('except_chat', (message: string) => {
					client2Received = true;
					expect(message).toBe('except message');

					setTimeout(() => {
						if (!client1Received) {
							clearTimeout(timeout);
							resolve();
						}
					}, 500);
				});

				Promise.all([
					new Promise((resolve: (value?: unknown) => void) => client1.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => client2.on('connect', resolve)),
				]).then(() => {
					setTimeout(() => {
						chatNamespace.except('excluded').emit('except_chat', 'except message');
					}, 100);
				});
			});
		});
	});

	describe('Namespace Room Management', () => {
		test('should handle joining rooms in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace join timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					socket.join('chat-room');
					expect(socket.rooms.has('chat-room')).toBe(true);
					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});

		test('should handle leaving rooms in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace leave timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					socket.join('chat-room');
					expect(socket.rooms.has('chat-room')).toBe(true);

					socket.leave('chat-room');
					expect(socket.rooms.has('chat-room')).toBe(false);

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});

		test('should fetch sockets in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client1 = createClient({ namespace: '/chat' });
			const client2 = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace fetch timeout')), 3000);

				Promise.all([
					new Promise((resolve: (value?: unknown) => void) => client1.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => client2.on('connect', resolve)),
				]).then(async () => {
					try {
						const sockets = await chatNamespace.fetchSockets();
						expect(sockets).toHaveLength(2);
						clearTimeout(timeout);
						resolve();
					} catch (error) {
						clearTimeout(timeout);
						reject(error);
					}
				});
			});
		});

		test('should make sockets join rooms in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace sockets join timeout')), 3000);

				client.on('connect', () => {
					setTimeout(async () => {
						try {
							chatNamespace.socketsJoin('test-room');
							const sockets = await chatNamespace.in('test-room').fetchSockets();
							expect(sockets).toHaveLength(1);
							clearTimeout(timeout);
							resolve();
						} catch (error) {
							clearTimeout(timeout);
							reject(error);
						}
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should make sockets leave rooms in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace sockets leave timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					socket.join('test-room');
				});

				client.on('connect', () => {
					setTimeout(async () => {
						try {
							let sockets = await chatNamespace.in('test-room').fetchSockets();
							expect(sockets).toHaveLength(1);

							chatNamespace.socketsLeave('test-room');

							setTimeout(async () => {
								sockets = await chatNamespace.in('test-room').fetchSockets();
								expect(sockets).toHaveLength(0);
								clearTimeout(timeout);
								resolve();
							}, 100);
						} catch (error) {
							clearTimeout(timeout);
							reject(error);
						}
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should disconnect sockets in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace disconnect timeout')), 3000);

				client.on('disconnect', () => {
					clearTimeout(timeout);
					resolve();
				});

				client.on('connect', () => {
					chatNamespace.disconnectSockets();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Namespace Modifiers', () => {
		test('should handle volatile events in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 2000);

				client.on('volatile_test', () => {
					clearTimeout(timeout);
					reject(new Error('Volatile event should not be guaranteed'));
				});

				client.on('connect', () => {
					client.disconnect();
					chatNamespace.volatile.emit('volatile_test', 'test');
				});
			});
		});

		test('should handle local events in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace local timeout')), 3000);

				client.on('local_test', (message: string) => {
					clearTimeout(timeout);
					expect(message).toBe('local namespace message');
					resolve();
				});

				client.on('connect', () => {
					chatNamespace.local.emit('local_test', 'local namespace message');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle compression in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace compression timeout')), 3000);

				client.on('compress_test', (message: string) => {
					clearTimeout(timeout);
					expect(message).toBe('compressed namespace message');
					resolve();
				});

				client.on('connect', () => {
					chatNamespace.compress(true).emit('compress_test', 'compressed namespace message');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Namespace Utility Methods', () => {
		test('should send message event in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace send timeout')), 3000);

				client.on('message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('namespace message');
					resolve();
				});

				client.on('connect', () => {
					chatNamespace.send('namespace message');
				});

				client.on('connect_error', reject);
			});
		});

		test('should write message event in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace write timeout')), 3000);

				client.on('message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('namespace write');
					resolve();
				});

				client.on('connect', () => {
					chatNamespace.write('namespace write');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Namespace Socket Management', () => {
		test('should remove socket from namespace on disconnect', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket removal timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					const socketId = socket.id;
					expect(chatNamespace.sockets.has(socketId)).toBe(true);

					socket.on('disconnect', () => {
						setTimeout(() => {
							expect(chatNamespace.sockets.has(socketId)).toBe(false);
							clearTimeout(timeout);
							resolve();
						}, 100);
					});

					// Disconnect the socket
					socket.disconnect();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle socket errors in namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket error timeout')), 3000);

				chatNamespace.on('connection', (socket: Socket) => {
					socket.on('error', (error: Error) => {
						clearTimeout(timeout);
						expect(error.message).toBe('Test error');
						resolve();
					});

					// Simulate an error
					socket.emit('error', new Error('Test error'));
				});

				client.on('connect_error', reject);
			});
		});
	});
});
