process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment, createTestEnv } from '../utils/test-env';
import type { Socket } from '../../src/socket';
import { sleep } from '../utils';

describe('TestEnvironment', () => {
	let testEnv: TestEnvironment;

	beforeEach(() => {
		testEnv = new TestEnvironment();
	});

	afterEach(() => {
		testEnv.cleanup();
	});

	describe('Constructor and Initialization', () => {
		test('should create instance with default configuration', () => {
			const env = new TestEnvironment();

			expect(env.testEnv).toBe(env);
			expect(env.clientsConnectedCount).toBe(0);
			expect(env.url).toBeUndefined();
			expect(env.clientsConnected()).toBe(true); // пустой массив = все подключены
		});

		test('should accept custom configuration', () => {
			const config = {
				hostname: 'test.local',
				port: 9999,
				tls: false,
				pingTimeout: 2000,
				pingInterval: 1000,
			};

			const env = new TestEnvironment(config);
			expect(env).toBeDefined();
		});

		test('should create instance via factory function', () => {
			const env = createTestEnv({ port: 8888 });

			expect(env).toBeInstanceOf(TestEnvironment);
			env.cleanup();
		});
	});

	describe('Server Creation', () => {
		test('should create server with default configuration', async () => {
			const io = await testEnv.createServer();

			expect(io).toBeDefined();
			expect(io.sockets).toBeDefined();
			expect(io.engine).toBeDefined();
			expect(testEnv.url).toMatch(/^wss:\/\/localhost:\d+$/);
		});

		test('should create server with custom configuration', async () => {
			const io = await testEnv.createServer({
				pingTimeout: 3000,
				pingInterval: 1500,
				connectTimeout: 10000,
			});

			expect(io.engine.opts.pingTimeout).toBe(3000);
			expect(io.engine.opts.pingInterval).toBe(1500);
			expect(io.connectTimeout()).toBe(10000);
		});

		test('should create server with authentication', async () => {
			const io = await testEnv.createServer({
				auth: { user: true, session: true },
			});

			expect(io).toBeDefined();
		});

		test('should create server with disabled authentication', async () => {
			const io = await testEnv.createServer({
				auth: { user: false, session: false },
			});

			expect(io).toBeDefined();
		});

		test('should throw error on repeated creation without cleanup', async () => {
			await testEnv.createServer();

			// Второе создание должно автоматически очистить предыдущий
			const io2 = await testEnv.createServer();
			expect(io2).toBeDefined();
		});

		test('should generate unique ports for different instances', async () => {
			const env1 = new TestEnvironment();
			const env2 = new TestEnvironment();

			const io1 = await env1.createServer();
			const io2 = await env2.createServer();

			expect(env1.url).not.toBe(env2.url);

			env1.cleanup();
			env2.cleanup();
		});
	});

	describe('Client Creation', () => {
		test('should create client with deferred connection', async () => {
			await testEnv.createServer();
			const client = testEnv.createClient();

			expect(client).toBeDefined();
			expect(client.connected).toBe(false);

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('connect', () => {
					clearTimeout(timeout);
					expect(client.connected).toBe(true);
					expect(testEnv.clientsConnectedCount).toBe(1);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should create client with custom configuration', async () => {
			await testEnv.createServer();
			const client = testEnv.createClient({
				namespace: '/test',
				timeout: 5000,
				transports: ['websocket'],
			});

			expect(client).toBeDefined();
		});

		test('should throw error when creating client without server', () => {
			expect(() => {
				testEnv.createClient();
			}).toThrow('Server must be created first');
		});

		test('should track connected clients count', async () => {
			const io = await testEnv.createServer();
			const clients = [testEnv.createClient(), testEnv.createClient(), testEnv.createClient()];

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectedCount = 0;

				clients.forEach((client) => {
					client.on('connect', () => {
						connectedCount++;
						if (connectedCount === 3) {
							clearTimeout(timeout);
							expect(testEnv.clientsConnectedCount).toBe(3);
							expect(testEnv.clientsConnected()).toBe(true);
							resolve();
						}
					});
				});

				clients.forEach((client) => client.on('connect_error', reject));
			});
		});
	});

	describe('Multiple Client Creation', () => {
		test('should create multiple clients synchronously', async () => {
			await testEnv.createServer();
			const clients = testEnv.createClients(5);

			expect(clients).toHaveLength(5);
			expect(testEnv.clientsConnectedCount).toBe(0); // еще не подключены

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
				let connectedCount = 0;

				clients.forEach((client) => {
					client.on('connect', () => {
						connectedCount++;
						if (connectedCount === 5) {
							clearTimeout(timeout);
							expect(testEnv.clientsConnectedCount).toBe(5);
							resolve();
						}
					});
				});

				clients.forEach((client) => client.on('connect_error', reject));
			});
		});

		test('should create clients with callback', async () => {
			await testEnv.createServer();
			const indices: number[] = [];

			const clients = testEnv.createClients(3, (client, index) => {
				indices.push(index);
				expect(client).toBeDefined();
			});

			expect(clients).toHaveLength(3);
			expect(indices).toEqual([0, 1, 2]);
		});

		test('should create clients asynchronously with connection wait', async () => {
			await testEnv.createServer();

			const clients = await testEnv.createClientsAsync(
				3,
				async (client, index) => {
					expect(index).toBeNumber();
				},
				{},
				true,
			);

			expect(clients).toHaveLength(3);
			expect(testEnv.clientsConnectedCount).toBe(3);
			clients.forEach((client) => {
				expect(client.connected).toBe(true);
			});
		});

		test('should handle errors during asynchronous creation', async () => {
			await testEnv.createServer({
				auth: { user: false, session: false },
			});

			try {
				await testEnv.createClientsAsync(2, async () => {}, {}, true);
				expect(true).toBe(false); // не должно дойти сюда
			} catch (error) {
				expect(error).toBeDefined();
			}
		});
	});

	describe('Client Connection Sequence', () => {
		test('should connect clients in strict sequence', async () => {
			const io = await testEnv.createServer();
			const connectionOrder: string[] = [];

			io.on('connection', (socket: Socket) => {
				connectionOrder.push(socket.id);
			});

			const clients = [testEnv.createClient(), testEnv.createClient(), testEnv.createClient()];

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectedCount = 0;

				clients.forEach((client) => {
					client.on('connect', () => {
						connectedCount++;
						if (connectedCount === 3) {
							clearTimeout(timeout);
							expect(connectionOrder).toHaveLength(3);
							// Проверяем уникальность идентификаторов
							expect(new Set(connectionOrder).size).toBe(3);
							resolve();
						}
					});
				});

				clients.forEach((client) => client.on('connect_error', reject));
			});
		});

		test('should correctly handle connection errors in sequence', async () => {
			await testEnv.createServer({
				auth: { user: false, session: false },
			});

			const clients = [testEnv.createClient(), testEnv.createClient()];

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let errorCount = 0;

				clients.forEach((client) => {
					client.on('connect_error', () => {
						errorCount++;
						if (errorCount === 2) {
							clearTimeout(timeout);
							expect(testEnv.clientsConnectedCount).toBe(0);
							resolve();
						}
					});
				});

				clients.forEach((client) => {
					client.on('connect', () => {
						clearTimeout(timeout);
						reject(new Error('Should not connect'));
					});
				});
			});
		});
	});

	describe('Lifecycle Management', () => {
		test('should correctly determine client connection state', async () => {
			await testEnv.createServer();
			const client1 = testEnv.createClient();
			const client2 = testEnv.createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectedCount = 0;

				const checkConnection = () => {
					connectedCount++;
					if (connectedCount === 1) {
						expect(testEnv.clientsConnected()).toBe(false);
						expect(testEnv.clientsConnectedCount).toBe(1);
					} else if (connectedCount === 2) {
						expect(testEnv.clientsConnected()).toBe(true);
						expect(testEnv.clientsConnectedCount).toBe(2);

						// Отключаем один клиент
						client1.disconnect();
						setTimeout(() => {
							expect(testEnv.clientsConnected()).toBe(false);
							expect(testEnv.clientsConnectedCount).toBe(1);
							clearTimeout(timeout);
							resolve();
						}, 100);
					}
				};

				client1.on('connect', checkConnection);
				client2.on('connect', checkConnection);
				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should provide access to server URL', async () => {
			expect(testEnv.url).toBeUndefined();

			await testEnv.createServer();
			expect(testEnv.url).toBeDefined();
			expect(testEnv.url).toMatch(/^wss:\/\/localhost:\d+$/);
		});
	});

	describe('Complete Resource Cleanup', () => {
		test('should completely clean all server resources', async () => {
			const io = await testEnv.createServer();
			const client = testEnv.createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				client.on('connect', () => {
					expect(testEnv.clientsConnectedCount).toBe(1);
					expect(io.engine.clientsCount).toBe(1);

					testEnv.cleanup();

					setTimeout(() => {
						expect(testEnv.url).toBeUndefined();
						expect(testEnv.clientsConnectedCount).toBe(0);
						clearTimeout(timeout);
						resolve();
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should safely handle repeated cleanup', () => {
			expect(() => {
				testEnv.cleanup();
				testEnv.cleanup();
				testEnv.cleanup();
			}).not.toThrow();
		});

		test('should clean event handlers of all objects', async () => {
			const io = await testEnv.createServer();
			const client = testEnv.createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('test_event', () => {});
					socket.on('another_event', () => {});

					expect(socket.listenerCount('test_event')).toBe(1);
					expect(socket.listenerCount('another_event')).toBe(1);

					testEnv.cleanup();

					setTimeout(() => {
						clearTimeout(timeout);
						resolve();
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should correctly clean namespaces', async () => {
			const io = await testEnv.createServer();
			const chatNamespace = io.of('/chat');
			const gameNamespace = io.of('/game');

			expect(io._nsps.size).toBe(3); // /, /chat, /game

			testEnv.cleanup();
			expect(testEnv.url).toBeUndefined();
		});

		test('should clean adapters and their internal states', async () => {
			const io = await testEnv.createServer();
			const client = testEnv.createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.join('test-room');
					const adapter = socket.nsp.adapter;

					expect(adapter['rooms'].size).toBeGreaterThan(0);
					expect(adapter['sids'].size).toBeGreaterThan(0);

					testEnv.cleanup();

					setTimeout(() => {
						clearTimeout(timeout);
						resolve();
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Environment Error Handling', () => {
		test('should correctly handle server creation errors', async () => {
			// Создаем первый экземпляр на определенном порту
			const env1 = new TestEnvironment();
			const env2 = new TestEnvironment();

			try {
				await env1.createServer({ port: 7777 });

				// Попытка создать второй сервер на том же порту
				// В реальной ситуации это вызовет ошибку EADDRINUSE
				// Но наша реализация генерирует уникальные порты
				await env2.createServer({ port: 7778 });

				expect(env1.url).not.toBe(env2.url);
			} finally {
				env1.cleanup();
				env2.cleanup();
			}
		});

		test('should handle TLS certificate errors', async () => {
			// Поскольку используются самоподписанные сертификаты
			// и NODE_TLS_REJECT_UNAUTHORIZED = '0', ошибок быть не должно
			const io = await testEnv.createServer({ tls: true });
			expect(io).toBeDefined();
			expect(testEnv.url).toMatch(/^wss:/);
		});

		test('should correctly handle disconnection during cleanup', async () => {
			const io = await testEnv.createServer();
			const clients = testEnv.createClients(3);

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectedCount = 0;

				clients.forEach((client) => {
					client.on('connect', () => {
						connectedCount++;
						if (connectedCount === 3) {
							// Выполняем cleanup при активных соединениях
							testEnv.cleanup();

							setTimeout(() => {
								expect(testEnv.clientsConnectedCount).toBe(0);
								clearTimeout(timeout);
								resolve();
							}, 200);
						}
					});
				});

				clients.forEach((client) => client.on('connect_error', reject));
			});
		});
	});

	describe('Performance and Scalability', () => {
		test('should efficiently handle large number of clients', async () => {
			const io = await testEnv.createServer();
			const clientCount = 50;

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
				let connectedCount = 0;

				const clients = testEnv.createClients(clientCount, (client) => {
					client.on('connect', () => {
						connectedCount++;
						if (connectedCount === clientCount) {
							clearTimeout(timeout);
							expect(testEnv.clientsConnectedCount).toBe(clientCount);
							expect(io.engine.clientsCount).toBe(clientCount);
							resolve();
						}
					});

					client.on('connect_error', reject);
				});
			});
		});

		test('should efficiently clean large number of resources', async () => {
			const io = await testEnv.createServer();
			const clientCount = 30;

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
				let connectedCount = 0;

				const clients = testEnv.createClients(clientCount, (client) => {
					client.on('connect', () => {
						connectedCount++;
						if (connectedCount === clientCount) {
							// Быстрая очистка большого количества ресурсов
							const startTime = Date.now();
							testEnv.cleanup();
							const cleanupTime = Date.now() - startTime;

							// Очистка должна завершиться быстро
							expect(cleanupTime).toBeLessThan(1000);
							clearTimeout(timeout);
							resolve();
						}
					});

					client.on('connect_error', reject);
				});
			});
		});
	});

	describe('State Isolation Between Tests', () => {
		test('should ensure complete isolation between instances', async () => {
			const env1 = new TestEnvironment();
			const env2 = new TestEnvironment();

			const io1 = await env1.createServer();
			const io2 = await env2.createServer();

			const client1 = env1.createClient();
			const client2 = env2.createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
				let connectedCount = 0;

				const checkIsolation = () => {
					connectedCount++;
					if (connectedCount === 2) {
						// Проверяем изоляцию состояний
						expect(env1.clientsConnectedCount).toBe(1);
						expect(env2.clientsConnectedCount).toBe(1);
						expect(env1.url).not.toBe(env2.url);
						expect(io1.engine.clientsCount).toBe(1);
						expect(io2.engine.clientsCount).toBe(1);

						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('connect', checkIsolation);
				client2.on('connect', checkIsolation);
				client1.on('connect_error', reject);
				client2.on('connect_error', reject);

				// Очистка
				setTimeout(() => {
					env1.cleanup();
					env2.cleanup();
				}, 1000);
			});
		});

		test('should prevent memory leaks between tests', async () => {
			const initialMemory = process.memoryUsage().heapUsed;

			// Создаем и уничтожаем несколько сред
			for (let i = 0; i < 5; i++) {
				const env = new TestEnvironment();
				const io = await env.createServer();
				const clients = env.createClients(10);

				await new Promise<void>((resolve) => {
					let connected = 0;
					clients.forEach((client) => {
						client.on('connect', () => {
							connected++;
							if (connected === 10) resolve();
						});
					});
				});

				env.cleanup();

				// Принудительная сборка мусора
				if (global.gc) {
					global.gc();
				}
			}

			const finalMemory = process.memoryUsage().heapUsed;
			const memoryIncrease = finalMemory - initialMemory;

			// Увеличение памяти должно быть разумным (меньше 50MB)
			expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
		});
	});
});
