process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import type { Socket } from '../../src/socket';

describe('Socket', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	describe('Socket Connection', () => {
		test('should create socket with valid properties', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket properties timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					clearTimeout(timeout);
					expect(socket.id).toBeDefined();
					expect(socket.connected).toBe(true);
					expect(socket.disconnected).toBe(false);
					expect(socket.handshake).toBeDefined();
					expect(socket.data).toBeDefined();
					expect(socket.rooms).toBeDefined();
					expect(socket.rooms.has(socket.id)).toBe(true);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should have valid handshake data', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Handshake timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					clearTimeout(timeout);
					expect(socket.handshake.time).toBeDefined();
					expect(socket.handshake.address).toBeDefined();
					expect(socket.handshake.url).toBeDefined();
					expect(socket.handshake.headers).toBeDefined();
					expect(socket.handshake.auth).toBeDefined();
					expect(socket.handshake.issued).toBeNumber();
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle disconnect event', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Disconnect timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('disconnect', (reason) => {
						clearTimeout(timeout);
						expect(reason).toBeDefined();
						expect(socket.connected).toBe(false);
						expect(socket.disconnected).toBe(true);
						resolve();
					});

					// Disconnect from client
					client.disconnect();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle server-side disconnect', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Server disconnect timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.disconnect();
				});

				client.on('disconnect', (reason) => {
					clearTimeout(timeout);
					expect(reason).toBe('io server disconnect');
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Events', () => {
		test('should emit and receive events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Event timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('test_event', (data: string) => {
						expect(data).toBe('test data');
						socket.emit('response_event', 'response data');
					});
				});

				client.on('response_event', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('response data');
					resolve();
				});

				client.on('connect', () => {
					client.emit('test_event', 'test data');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle acknowledgments', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('ACK timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('ack_test', (data: string, callback: Function) => {
						expect(data).toBe('ack data');
						callback('ack response');
					});
				});

				client.on('connect', () => {
					client.emit('ack_test', 'ack data', (response: string) => {
						clearTimeout(timeout);
						expect(response).toBe('ack response');
						resolve();
					});
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle emitWithAck', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('EmitWithAck timeout')), 3000);

				io.on('connection', async (socket: Socket) => {
					socket.on('emitWithAck_test', (data: string, callback: Function) => {
						expect(data).toBe('emitWithAck data');
						callback('emitWithAck response');
					});
				});

				client.on('connect', () => {
					client.emitWithAck('emitWithAck_test', 'emitWithAck data').then((response) => {
						clearTimeout(timeout);
						expect(response).toBe('emitWithAck response');
						resolve();
					});
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle multiple events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple events timeout')), 3000);
				let eventCount = 0;

				io.on('connection', (socket: Socket) => {
					socket.on('event1', (data: string) => {
						expect(data).toBe('data1');
						eventCount++;
						if (eventCount === 3) {
							clearTimeout(timeout);
							resolve();
						}
					});

					socket.on('event2', (data: string) => {
						expect(data).toBe('data2');
						eventCount++;
						if (eventCount === 3) {
							clearTimeout(timeout);
							resolve();
						}
					});

					socket.on('event3', (data: string) => {
						expect(data).toBe('data3');
						eventCount++;
						if (eventCount === 3) {
							clearTimeout(timeout);
							resolve();
						}
					});
				});

				client.on('connect', () => {
					client.emit('event1', 'data1');
					client.emit('event2', 'data2');
					client.emit('event3', 'data3');
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
					socket.on('binary_event', (data: Buffer) => {
						expect(data).toBeInstanceOf(Buffer);
						expect(data.toString()).toBe('binary data');
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
					client.emit('binary_event', Buffer.from('binary data'));
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Rooms', () => {
		test('should join rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Join room timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.join('test-room');
					expect(socket.rooms.has('test-room')).toBe(true);
					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should leave rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Leave room timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.join('test-room');
					expect(socket.rooms.has('test-room')).toBe(true);

					socket.leave('test-room');
					expect(socket.rooms.has('test-room')).toBe(false);
					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should join multiple rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple rooms timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.join(['room1', 'room2', 'room3']);
					expect(socket.rooms.has('room1')).toBe(true);
					expect(socket.rooms.has('room2')).toBe(true);
					expect(socket.rooms.has('room3')).toBe(true);
					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should broadcast to room', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Room broadcast timeout')), 3000);
				let connectCount = 0;
				let serverSocket1: Socket;
				let serverSocket2: Socket;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						serverSocket1 = socket;
						socket.join('room1');
					}

					if (connectCount === 2) {
						serverSocket2 = socket;
						socket.join('room1');

						// Broadcast от первого socket - получит только второй socket
						serverSocket1.to('room1').emit('room_message', 'room test');
					}
				});

				// client1 НЕ должен получить сообщение (self-exclusion)
				client1.on('room_message', () => {
					clearTimeout(timeout);
					reject(new Error('Client1 should not receive own broadcast due to self-exclusion'));
				});

				// client2 ДОЛЖЕН получить сообщение
				client2.on('room_message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('room test');
					resolve();
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should broadcast to multiple rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple room broadcast timeout')), 3000);
				let serverSocket1: Socket;
				let serverSocket2: Socket;
				let connectCount = 0;
				let receivedCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						serverSocket1 = socket;
						socket.join('room1');
					} else if (connectCount === 2) {
						serverSocket2 = socket;
						socket.join('room2');

						// Multi-room broadcast execution
						io.to(['room1', 'room2']).emit('multi_room', 'multi test');
					}
				});

				const checkMessage = (data: string) => {
					expect(data).toBe('multi test');
					receivedCount++;
					if (receivedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('multi_room', checkMessage);
				client2.on('multi_room', checkMessage);

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});
	});

	describe('Socket Broadcasting', () => {
		test('should broadcast to all except sender', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Broadcast timeout')), 3000);
				let serverSocket1: Socket;
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						serverSocket1 = socket;
					}

					if (connectCount === 2) {
						serverSocket1.broadcast.emit('broadcast_test', 'broadcast message');
					}
				});

				client1.on('broadcast_test', () => {
					clearTimeout(timeout);
					reject(new Error('Sender should not receive broadcast'));
				});

				client2.on('broadcast_test', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('broadcast message');
					resolve();
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should handle except modifier', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Except timeout')), 3000);
				let serverSocket1: Socket;
				let serverSocket2: Socket;
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						serverSocket1 = socket;
					} else if (connectCount === 2) {
						serverSocket2 = socket;
						socket.join('excluded');
					}

					if (connectCount === 3) {
						serverSocket1.except('excluded').emit('except_test', 'except message');
					}
				});

				client1.on('except_test', () => {
					clearTimeout(timeout);
					reject(new Error('Sender should not receive message'));
				});

				client2.on('except_test', () => {
					clearTimeout(timeout);
					reject(new Error('Excluded client should not receive message'));
				});

				client3.on('except_test', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('except message');
					resolve();
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});
	});

	describe('Socket Modifiers', () => {
		test('should handle volatile events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 100);

				io.on('connection', (socket: Socket) => {
					socket.volatile.emit('volatile_test', 'volatile message');
				});

				client.on('volatile_test', () => {
					clearTimeout(timeout);
					reject(new Error('Volatile event should not be guaranteed'));
				});

				client.on('connect', () => {
					client.disconnect();
				});
			});
		});

		test('should handle compression flag', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Compression timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.compress(true).emit('compress_test', 'compressed message');
				});

				client.on('compress_test', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('compressed message');
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle timeout modifier', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Timeout test timeout')), 5000);

				io.on('connection', (socket: Socket) => {
					socket.timeout(1000).emit('timeout_test', 'timeout data', (err: Error) => {
						clearTimeout(timeout);
						expect(err).toBeDefined();
						expect(err.message).toContain('timed out');
						resolve();
					});
				});

				// Client doesn't respond to trigger timeout
				client.on('timeout_test', () => {
					// Don't call callback to trigger timeout
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Middleware', () => {
		test('should execute socket middleware', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket middleware timeout')), 3000);
				let middlewareExecuted = false;

				io.on('connection', (socket: Socket) => {
					socket.use((event, next) => {
						middlewareExecuted = true;
						expect(event[0]).toBe('test_middleware');
						next();
					});

					socket.on('test_middleware', () => {
						clearTimeout(timeout);
						expect(middlewareExecuted).toBe(true);
						resolve();
					});
				});

				client.on('connect', () => {
					client.emit('test_middleware', 'middleware data');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle middleware errors', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Middleware error timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.use((event, next) => {
						next(new Error('Middleware rejected'));
					});

					socket.on('error', (error: Error) => {
						clearTimeout(timeout);
						expect(error.message).toBe('Middleware rejected');
						resolve();
					});

					socket.on('test_error', () => {
						clearTimeout(timeout);
						reject(new Error('Event should not execute after middleware error'));
					});
				});

				client.on('connect', () => {
					client.emit('test_error', 'error data');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Any Listeners', () => {
		test('should handle onAny listeners', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('OnAny timeout')), 3000);
				let anyExecuted = false;

				io.on('connection', (socket: Socket) => {
					socket.onAny((event, ...args) => {
						anyExecuted = true;
						expect(event).toBe('any_test');
						expect(args[0]).toBe('any data');
					});

					socket.on('any_test', () => {
						clearTimeout(timeout);
						expect(anyExecuted).toBe(true);
						resolve();
					});
				});

				client.on('connect', () => {
					client.emit('any_test', 'any data');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle onAnyOutgoing listeners', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('OnAnyOutgoing timeout')), 3000);
				let outgoingExecuted = false;

				io.on('connection', (socket: Socket) => {
					socket.onAnyOutgoing((event, ...args) => {
						outgoingExecuted = true;
						expect(event).toBe('outgoing_test');
						expect(args[0]).toBe('outgoing data');
						clearTimeout(timeout);
						resolve();
					});

					socket.emit('outgoing_test', 'outgoing data');
				});

				client.on('connect_error', reject);
			});
		});

		test('should remove any listeners', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 2000);

				io.on('connection', (socket: Socket) => {
					const listener = (event: string) => {
						clearTimeout(timeout);
						reject(new Error('Listener should be removed'));
					};

					socket.onAny(listener);
					socket.offAny(listener);

					socket.emit('removed_test', 'test');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Utility Methods', () => {
		test('should send message events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Send message timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.send('socket message');
				});

				client.on('message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('socket message');
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should write message events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Write message timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.write('socket write');
				});

				client.on('message', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('socket write');
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Error Handling', () => {
		test('should handle socket errors gracefully', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Error handling timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('error', (error: Error) => {
						clearTimeout(timeout);
						expect(error).toBeDefined();
						resolve();
					});

					// Trigger an error
					socket.emit('error', new Error('Test socket error'));
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle disconnecting event', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Disconnecting timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('disconnecting', (reason) => {
						clearTimeout(timeout);
						expect(reason).toBeDefined();
						expect(socket.connected).toBe(true); // Still connected during disconnecting
						resolve();
					});

					socket.disconnect();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Connection Context', () => {
		test('should have access to connection context', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Context timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					clearTimeout(timeout);
					expect(socket.ctx).toBeDefined();
					expect(socket.conn).toBeDefined();
					expect(socket.ws).toBeDefined();
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});
});
