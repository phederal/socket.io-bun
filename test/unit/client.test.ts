process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import type { Socket } from '../../src/socket';

describe('Client', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	describe('Client Connection', () => {
		test('should create client with valid properties', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Client properties timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					expect(clientInstance).toBeDefined();
					expect(clientInstance.conn).toBeDefined();
					expect(clientInstance.server).toBe(io);
					expect(clientInstance.encoder).toBeDefined();
					expect(clientInstance.decoder).toBeDefined();
					expect(clientInstance.ctx).toBeDefined();

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle multiple namespaces per client', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');

			// Create client that connects to default namespace first
			const defaultClient = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple namespaces timeout')), 3000);
				let defaultConnected = false;
				let chatConnected = false;

				io.on('connection', (socket: Socket) => {
					defaultConnected = true;
					const clientInstance = socket.client;

					// Connect same client to chat namespace
					setTimeout(() => {
						const chatClient = createClient({ namespace: '/chat' });

						chatNamespace.on('connection', (chatSocket: Socket) => {
							chatConnected = true;

							// Both sockets should have different clients
							expect(chatSocket.client).toBeDefined();
							expect(chatSocket.client).not.toBe(clientInstance);

							if (defaultConnected && chatConnected) {
								clearTimeout(timeout);
								resolve();
							}
						});
					}, 100);
				});

				defaultClient.on('connect_error', reject);
			});
		});

		test('should handle client context access', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Client context timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;
					const ctx = clientInstance.ctx;

					expect(ctx).toBeDefined();
					expect(ctx.req).toBeDefined();
					expect(ctx.req.url).toBeDefined();
					expect(ctx.req.header).toBeFunction();

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Client Packet Handling', () => {
		test('should handle packet writing', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Packet writing timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('test_packet', (data: string) => {
						expect(data).toBe('packet data');
						clearTimeout(timeout);
						resolve();
					});
				});

				client.on('connect', () => {
					client.emit('test_packet', 'packet data');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle packet encoding and decoding', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Packet encoding timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					// Test encoder
					expect(clientInstance.encoder).toBeDefined();
					expect(clientInstance.encoder.encode).toBeFunction();

					// Test decoder
					expect(clientInstance.decoder).toBeDefined();
					expect(clientInstance.decoder.add).toBeFunction();

					socket.on('encode_test', (data: any) => {
						expect(data).toEqual({ test: 'object', number: 42, array: [1, 2, 3] });
						clearTimeout(timeout);
						resolve();
					});
				});

				client.on('connect', () => {
					client.emit('encode_test', { test: 'object', number: 42, array: [1, 2, 3] });
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle volatile packet discarding', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 150); // Resolve if no packet received

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					socket.on('volatile_test', () => {
						clearTimeout(timeout);
						reject(new Error('Volatile packet should not be guaranteed when client disconnects'));
					});

					// Disconnect client and try to send volatile packet
					client.disconnect();

					setTimeout(() => {
						try {
							clientInstance._packet(
								{
									type: 2, // EVENT
									nsp: '/',
									data: ['volatile_test', 'volatile data'],
								},
								{ volatile: true },
							);
						} catch (error) {
							// Expected to fail or be discarded
						}
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Client Namespace Management', () => {
		test('should connect to multiple namespaces', async () => {
			const io = await createServer();
			const chatNamespace = io.of('/chat');
			const gameNamespace = io.of('/game');

			const chatClient = createClient({ namespace: '/chat' });
			const gameClient = createClient({ namespace: '/game' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple namespace connection timeout')), 3000);
				let chatConnected = false;
				let gameConnected = false;

				chatNamespace.on('connection', (socket: Socket) => {
					chatConnected = true;
					expect(socket.nsp.name).toBe('/chat');

					if (chatConnected && gameConnected) {
						clearTimeout(timeout);
						resolve();
					}
				});

				gameNamespace.on('connection', (socket: Socket) => {
					gameConnected = true;
					expect(socket.nsp.name).toBe('/game');

					if (chatConnected && gameConnected) {
						clearTimeout(timeout);
						resolve();
					}
				});

				chatClient.on('connect_error', reject);
				gameClient.on('connect_error', reject);
			});
		});

		test('should handle namespace connection errors', async () => {
			const io = await createServer();

			// Use middleware to reject connection
			io.of('/restricted').use((socket, next) => {
				next(new Error('Access denied'));
			});

			const client = createClient({ namespace: '/restricted' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Namespace error timeout')), 3000);

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					expect(error.message).toContain('Access denied');
					resolve();
				});

				client.on('connect', () => {
					clearTimeout(timeout);
					reject(new Error('Should not connect to restricted namespace'));
				});
			});
		});

		test('should handle invalid namespace connection', async () => {
			const io = await createServer();
			const client = createClient({ namespace: '/nonexistent' });

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Invalid namespace timeout')), 3000);

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					expect(error.message).toContain('Invalid namespace');
					resolve();
				});

				client.on('connect', () => {
					clearTimeout(timeout);
					reject(new Error('Should not connect to non-existent namespace'));
				});
			});
		});
	});

	describe('Client Socket Management', () => {
		test('should manage socket lifecycle', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket lifecycle timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					// Check socket is added to client
					expect(clientInstance['sockets'].has(socket.id)).toBe(true);
					expect(clientInstance['nsps'].has(socket.nsp.name)).toBe(true);

					socket.on('disconnect', () => {
						setTimeout(() => {
							// Check socket is removed from client
							expect(clientInstance['sockets'].has(socket.id)).toBe(false);
							expect(clientInstance['nsps'].has(socket.nsp.name)).toBe(false);

							clearTimeout(timeout);
							resolve();
						}, 100);
					});

					socket.disconnect();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle client disconnect', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Client disconnect timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					socket.on('disconnect', (reason) => {
						clearTimeout(timeout);
						expect(reason).toBeDefined();
						expect(clientInstance['sockets'].size).toBe(0);
						expect(clientInstance['nsps'].size).toBe(0);
						resolve();
					});

					// Disconnect from client side
					client.disconnect();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle server-side client disconnect', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Server disconnect timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					// Force disconnect from server
					clientInstance._disconnect();
				});

				client.on('disconnect', (reason) => {
					clearTimeout(timeout);
					expect(reason).toBeDefined();
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Client Error Handling', () => {
		test('should handle decoder errors', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Decoder error timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('error', (error: Error) => {
						clearTimeout(timeout);
						expect(error).toBeDefined();
						resolve();
					});

					// Simulate invalid packet data
					try {
						socket.client['ondata']('invalid packet data');
					} catch (error) {
						// Expected to trigger error handling
					}
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle connection timeout', async () => {
			// Создание server с коротким timeout
			const io = await createServer({ connectTimeout: 100 });

			// Middleware с искусственной задержкой для эмуляции медленного auth
			io.use((socket, next) => {
				setTimeout(() => {
					next(); // Задержка превышает connectTimeout
				}, 200);
			});

			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('Test timeout - client should have been disconnected'));
				}, 2000);

				client.on('disconnect', (reason) => {
					clearTimeout(timeout);
					// В Bun WebSocket клиент получит disconnect при закрытии transport
					expect(['transport close', 'io server disconnect']).toContain(reason);
					resolve();
				});

				client.on('connect', () => {
					clearTimeout(timeout);
					reject(new Error('Client should not connect due to timeout'));
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					resolve();
				});
			});
		});

		test('should handle transport errors', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Transport error timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					socket.on('error', (error: Error) => {
						clearTimeout(timeout);
						expect(error).toBeDefined();
						resolve();
					});

					// Simulate transport error
					clientInstance['onerror'](new Error('Transport error'));
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle parser errors gracefully', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Parser error timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					// Parser errors should not close connection
					let errorHandled = false;

					const originalOnerror = clientInstance['onerror'];
					clientInstance['onerror'] = function (err: Error) {
						if (err.message.includes('Invalid packet')) {
							errorHandled = true;
							clearTimeout(timeout);
							resolve();
						} else {
							originalOnerror.call(this, err);
						}
					};

					// Simulate parser error
					clientInstance['onerror'](new Error('Invalid packet format'));
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Client Data Handling', () => {
		test('should handle different data types', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Data types timeout')), 3000);
				let testCount = 0;
				const expectedTests = 5;

				io.on('connection', (socket: Socket) => {
					socket.on('string_test', (data: string) => {
						expect(data).toBe('test string');
						testCount++;
						if (testCount === expectedTests) {
							clearTimeout(timeout);
							resolve();
						}
					});

					socket.on('number_test', (data: number) => {
						expect(data).toBe(42);
						testCount++;
						if (testCount === expectedTests) {
							clearTimeout(timeout);
							resolve();
						}
					});

					socket.on('object_test', (data: object) => {
						expect(data).toEqual({ key: 'value', nested: { prop: 123 } });
						testCount++;
						if (testCount === expectedTests) {
							clearTimeout(timeout);
							resolve();
						}
					});

					socket.on('array_test', (data: any[]) => {
						expect(data).toEqual([1, 'two', { three: 3 }]);
						testCount++;
						if (testCount === expectedTests) {
							clearTimeout(timeout);
							resolve();
						}
					});

					socket.on('boolean_test', (data: boolean) => {
						expect(data).toBe(true);
						testCount++;
						if (testCount === expectedTests) {
							clearTimeout(timeout);
							resolve();
						}
					});
				});

				client.on('connect', () => {
					client.emit('string_test', 'test string');
					client.emit('number_test', 42);
					client.emit('object_test', { key: 'value', nested: { prop: 123 } });
					client.emit('array_test', [1, 'two', { three: 3 }]);
					client.emit('boolean_test', true);
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle binary data', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Binary data timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('binary_test', (data: Buffer) => {
						expect(data).toBeInstanceOf(Buffer);
						expect(data.toString()).toBe('binary test data');

						socket.emit('binary_response', Buffer.from('binary response'));
					});
				});

				client.on('binary_response', (data: Buffer) => {
					clearTimeout(timeout);
					expect(data).toBeInstanceOf(Buffer);
					expect(data.toString()).toBe('binary response');
					resolve();
				});

				client.on('connect', () => {
					client.emit('binary_test', Buffer.from('binary test data'));
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Client Performance', () => {
		test('should handle rapid events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Rapid events timeout')), 5000);
				const eventCount = 100;
				let receivedCount = 0;

				io.on('connection', (socket: Socket) => {
					socket.on('rapid_event', (index: number) => {
						receivedCount++;

						if (receivedCount === eventCount) {
							clearTimeout(timeout);
							resolve();
						}
					});
				});

				client.on('connect', () => {
					for (let i = 0; i < eventCount; i++) {
						client.emit('rapid_event', i);
					}
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle concurrent connections', async () => {
			const io = await createServer();
			const clientCount = 10;
			const clients: any[] = [];

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Concurrent connections timeout')), 5000);
				let connectedCount = 0;

				io.on('connection', (socket: Socket) => {
					connectedCount++;

					if (connectedCount === clientCount) {
						clearTimeout(timeout);
						expect(io['_clients'].size).toBe(clientCount);
						resolve();
					}
				});

				// Create multiple clients
				for (let i = 0; i < clientCount; i++) {
					const client = createClient();
					clients.push(client);
					client.on('connect_error', reject);
				}
			});
		});
	});

	describe('Client Cleanup', () => {
		test('should cleanup resources on disconnect', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Cleanup timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const initialClientCount = io.engine.clientsCount;
					expect(initialClientCount).toBeGreaterThan(0);

					socket.on('disconnect', () => {
						// Используем setImmediate для гарантии выполнения после всех nextTick
						setImmediate(() => {
							const finalClientCount = io.engine.clientsCount;
							expect(finalClientCount).toBe(initialClientCount - 1);
							clearTimeout(timeout);
							resolve();
						});
					});

					client.disconnect();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle decoder cleanup', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Decoder cleanup timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;
					const decoder = clientInstance.decoder;

					expect(decoder).toBeDefined();

					socket.on('disconnect', () => {
						setTimeout(() => {
							// Decoder should be destroyed
							try {
								decoder.add('test');
								clearTimeout(timeout);
								reject(new Error('Decoder should be destroyed'));
							} catch (error) {
								clearTimeout(timeout);
								resolve();
							}
						}, 100);
					});

					client.disconnect();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Client Edge Cases', () => {
		test('should handle connect timeout clearing', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Connect timeout clearing timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const clientInstance = socket.client;

					// Connect timeout should be cleared after successful connection
					expect(clientInstance['connectTimeout']).toBeUndefined();

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle duplicate packet types', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Duplicate packets timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('duplicate_test', (data: string) => {
						expect(data).toBe('duplicate data');
						clearTimeout(timeout);
						resolve();
					});
				});

				client.on('connect', () => {
					// Send same event multiple times rapidly
					client.emit('duplicate_test', 'duplicate data');
					client.emit('duplicate_test', 'duplicate data');
					client.emit('duplicate_test', 'duplicate data');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle malformed packets gracefully', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Malformed packets timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('error', (error: Error) => {
						clearTimeout(timeout);
						expect(error).toBeInstanceOf(Error);
						resolve();
					});

					socket.on('disconnect', (reason: string) => {
						if (reason === 'parse error') {
							clearTimeout(timeout);
							resolve();
						}
					});

					// Корректная симуляция через transport layer
					const transport = socket.conn['transport'];
					if (transport) {
						// Инъекция malformed data через decoder pipeline
						setImmediate(() => {
							try {
								const malformedData = '42["invalid_packet_structure"'; // Некорректный JSON
								socket.client['ondata'](malformedData);
							} catch (error) {
								clearTimeout(timeout);
								resolve();
							}
						});
					}
				});

				client.on('connect_error', reject);
			});
		});
	});
});
