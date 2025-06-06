process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import { Server } from '../../src/index';
import type { Socket } from '../../src/socket';
import { sleep } from 'bun';

describe('Server', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	afterEach(() => cleanup());

	describe('Constructor and Configuration', () => {
		test('should create server with default options', () => {
			const server = new Server();
			expect(server).toBeDefined();
			expect(server.sockets).toBeDefined();
			expect(server.sockets.name).toBe('/');
		});

		test('should create server with custom options', () => {
			const server = new Server({
				connectTimeout: 10000,
				path: '/custom',
				pingTimeout: 30000,
				pingInterval: 40000,
			});
			expect(server.connectTimeout()).toBe(10000);
			expect(server.path()).toBe('/custom');
		});

		test('should set and get path', () => {
			const server = new Server();
			expect(server.path('/socket')).toBe(server);
			expect(server.path()).toBe('/socket');
		});

		test('should set and get connectTimeout', () => {
			const server = new Server();
			expect(server.connectTimeout(15000)).toBe(server);
			expect(server.connectTimeout()).toBe(15000);
		});
	});

	describe('Namespace Management', () => {
		test('should create and return namespace', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');

			expect(chatNamespace).toBeDefined();
			expect(chatNamespace.name).toBe('/chat');
			expect(io['_nsps'].has('/chat')).toBe(true);
		});

		test('should return existing namespace', async () => {
			const io = await createServer();
			const chat1 = io.of('/chat');
			const chat2 = io.of('/chat');

			expect(chat1).toBe(chat2);
		});

		test('should normalize namespace names', async () => {
			const io = await createServer();
			const nsp1 = io.of('test');
			const nsp2 = io.of('/test');

			expect(nsp1).toBe(nsp2);
			expect(nsp1.name).toBe('/test');
		});

		test('should handle namespace connection callback', async () => {
			const io = await createServer();
			let callbackExecuted = false;

			const chatNamespace = io.of('/chat', (socket) => {
				callbackExecuted = true;
				expect(socket).toBeDefined();
			});

			const client = createClient({ namespace: '/chat' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('connect', () => {
					clearTimeout(timeout);
					expect(callbackExecuted).toBe(true);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Event Broadcasting', () => {
		test('should broadcast to all clients', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let receivedCount = 0;

				io.on('connection', (socket: Socket) => {
					io.emit('test_broadcast', 'broadcast test');
				});

				const checkMessage = (message: string) => {
					expect(message).toBe('broadcast test');
					receivedCount++;
					if (receivedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('test_broadcast', checkMessage);
				client2.on('test_broadcast', checkMessage);

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should broadcast to specific room', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectCount = 0;
				let firstSocket: Socket;

				io.on('connection', (socket: Socket) => {
					connectCount++;
					if (connectCount === 1) {
						firstSocket = socket;
					}

					if (connectCount === 2) {
						// Первый сокет в комнату
						firstSocket.join('room1');
						// Отправляем в комнату
						io.to('room1').emit('room_test', 'room message');
					}
				});

				client1.on('room_test', (data: string) => {
					expect(data).toBe('room message');
					clearTimeout(timeout);
					resolve();
				});

				client2.on('room_test', () => {
					clearTimeout(timeout);
					reject(new Error('Client2 should not receive room message'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should exclude specific rooms from broadcast', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					// Первый клиент идет в исключаемую комнату
					if (connectCount === 1) {
						socket.join('excluded-room');
					}

					// Когда оба подключились - отправляем всем кроме исключенной комнаты
					if (connectCount === 2) {
						io.except('excluded-room').emit('except_message', 'hello except');
					}
				});

				// Первый клиент НЕ должен получить сообщение
				client1.on('except_message', () => {
					clearTimeout(timeout);
					reject(new Error('Client1 should not receive message'));
				});

				// Второй клиент должен получить сообщение
				client2.on('except_message', (data: string) => {
					expect(data).toBe('hello except');

					// Ждем немного и проверяем что первый не получил
					setTimeout(() => {
						clearTimeout(timeout);
						resolve();
					}, 100);
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});
	});

	describe('Middleware', () => {
		test('should execute middleware on connection', async () => {
			const io = await createServer();
			let middlewareExecuted = false;

			io.use((socket, next) => {
				middlewareExecuted = true;
				expect(socket).toBeDefined();
				next();
			});

			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('connect', () => {
					clearTimeout(timeout);
					expect(middlewareExecuted).toBe(true);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		// Отключаем middleware error тест временно - он ломает последующие тесты
		test('should handle middleware errors', async () => {
			const io = await createServer();

			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				io.use((socket, next) => {
					next(new Error('Middleware error'));
				});

				client.on('connect', () => {
					clearTimeout(timeout);
					reject(new Error('Should not connect with middleware error'));
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					expect(error.message).toContain('Middleware error');
					resolve();
				});
			});
		});
	});

	describe('Utility Methods', () => {
		test('should send message event', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('test message');
					resolve();
				});

				client.on('connect', () => {
					io.send('test message');
				});

				client.on('connect_error', reject);
			});
		});

		test('should write message event', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('write test');
					resolve();
				});

				client.on('connect', () => {
					io.write('write test');
				});

				client.on('connect_error', reject);
			});
		});

		test('should fetch sockets', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				let connectedCount = 0;
				const onConnect = async () => {
					connectedCount++;
					if (connectedCount === 2) {
						try {
							const sockets = await io.fetchSockets();
							expect(sockets).toHaveLength(2);
							clearTimeout(timeout);
							resolve();
						} catch (error) {
							clearTimeout(timeout);
							reject(error);
						}
					}
				};

				client1.on('connect', onConnect);
				client2.on('connect', onConnect);
				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should make sockets join rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('connect', async () => {
					setTimeout(async () => {
						try {
							io.socketsJoin('test-room');
							const sockets = await io.in('test-room').fetchSockets();
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

		test('should make sockets leave rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.join('test-room');
				});

				client.on('connect', async () => {
					setTimeout(async () => {
						try {
							let sockets = await io.in('test-room').fetchSockets();
							expect(sockets).toHaveLength(1);

							io.socketsLeave('test-room');

							setTimeout(async () => {
								sockets = await io.in('test-room').fetchSockets();
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

		test('should disconnect all sockets', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let disconnectedCount = 0;

				const onDisconnect = () => {
					disconnectedCount++;
					if (disconnectedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('disconnect', onDisconnect);
				client2.on('disconnect', onDisconnect);

				let connectedCount = 0;
				const onConnect = () => {
					connectedCount++;
					if (connectedCount === 2) {
						io.disconnectSockets();
					}
				};

				client1.on('connect', onConnect);
				client2.on('connect', onConnect);
				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});
	});

	describe('Modifiers', () => {
		test('should handle local events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('local_test', (message: string) => {
					clearTimeout(timeout);
					expect(message).toBe('local message');
					resolve();
				});

				client.on('connect', () => {
					io.local.emit('local_test', 'local message');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle compression', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('compress_test', (message: string) => {
					clearTimeout(timeout);
					expect(message).toBe('compressed message');
					resolve();
				});

				client.on('connect', () => {
					io.compress(true).emit('compress_test', 'compressed message');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Server Lifecycle', () => {
		// TODO: Исправить io.close() - не отключает клиентов
		test('should close server properly', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('connect', async () => {
					client.once('disconnect', () => {
						clearTimeout(timeout);
						expect(client.connected).toBe(false);
						resolve();
					});

					try {
						await io.close();
					} catch (error) {
						clearTimeout(timeout);
						reject(error);
					}
				});

				client.on('connect_error', reject);
			});
		});

		test('should close server properly (graceful shutdown)', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 5000);

				client.on('connect', async () => {
					// ✅ Ждем disconnect события
					client.once('disconnect', () => {
						clearTimeout(timeout);
						expect(client.connected).toBe(false);
						resolve();
					});

					// Отправляем disconnect пакет клиенту
					io.disconnectSockets();

					// Ждем немного и закрываем сервер
					setTimeout(() => io.close(), 100);
				});

				client.on('connect_error', reject);
			});
		});
	});
});
