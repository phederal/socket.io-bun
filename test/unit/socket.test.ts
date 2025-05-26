/**
 * Socket tests с реальным сервером и Socket.IO клиентом
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestServer, createSocketIOClient } from '../utils/test-helper';

describe('Socket Tests', () => {
	let testServer: any;
	let client: any;

	beforeEach(async () => {
		testServer = await createTestServer();
	});

	afterEach(async () => {
		if (client?.connected) {
			client.disconnect();
		}
		testServer.cleanup();
	});

	test('should connect and disconnect', async () => {
		client = await createSocketIOClient(testServer.url);

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

			client.on('connect', () => {
				clearTimeout(timeout);
				expect(client.connected).toBe(true);
				expect(client.id).toBeDefined();
				resolve();
			});

			client.on('connect_error', (error: any) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should emit and receive events', async () => {
		// Настраиваем server-side обработчик ПЕРЕД подключением клиента
		testServer.io.on('connection', (socket: any) => {
			socket.on('test_message', (data: any) => {
				socket.emit('test_response', `Echo: ${data}`);
			});
		});

		client = createSocketIOClient(testServer.url);

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Test timeout')), 5000);

			client.on('connect', () => {
				client.on('test_response', (data: any) => {
					clearTimeout(timeout);
					expect(data).toBe('Echo: hello world');
					resolve();
				});

				client.emit('test_message', 'hello world');
			});

			client.on('connect_error', reject);
		});
	});

	test('should handle acknowledgments', async () => {
		// Server-side ACK handler ПЕРЕД подключением
		testServer.io.on('connection', (socket: any) => {
			socket.on('get_data', (data: any, callback: any) => {
				callback({ result: `processed_${data}` });
			});
		});

		client = createSocketIOClient(testServer.url);

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('ACK timeout')), 5000);

			client.on('connect', () => {
				client.emit('get_data', 'test_input', (response: any) => {
					clearTimeout(timeout);
					expect(response.result).toBe('processed_test_input');
					resolve();
				});
			});

			client.on('connect_error', reject);
		});
	});

	test('should handle rooms', async () => {
		// Server-side room handling ПЕРЕД подключением
		testServer.io.on('connection', (socket: any) => {
			socket.on('join_room', (room: string) => {
				socket.join(room);
			});

			socket.on('room_message', (data: any) => {
				testServer.io.to(data.room).emit('room_broadcast', data.message);
			});
		});

		const client1 = createSocketIOClient(testServer.url);
		const client2 = createSocketIOClient(testServer.url);

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Room test timeout')), 5000);
			let responsesReceived = 0;

			const checkComplete = () => {
				responsesReceived++;
				if (responsesReceived === 2) {
					clearTimeout(timeout);
					client1.disconnect();
					client2.disconnect();
					resolve();
				}
			};

			client1.on('connect', () => {
				client1.emit('join_room', 'test_room');

				client1.on('room_broadcast', (message: any) => {
					expect(message).toBe('Hello room!');
					checkComplete();
				});
			});

			client2.on('connect', () => {
				client2.emit('join_room', 'test_room');

				client2.on('room_broadcast', (message: any) => {
					expect(message).toBe('Hello room!');
					checkComplete();
				});

				// Даем время на присоединение к комнате
				setTimeout(() => {
					client1.emit('room_message', { room: 'test_room', message: 'Hello room!' });
				}, 200);
			});

			client1.on('connect_error', reject);
			client2.on('connect_error', reject);
		});
	});

	test('should handle binary events', async () => {
		client = await createSocketIOClient(testServer.url);

		// Server-side binary handler
		testServer.io.on('connection', (socket: any) => {
			socket.on('binary_test', (data: any) => {
				socket.emitBinary('binary_response', `Binary: ${data}`);
			});
		});

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Binary test timeout')), 5000);

			client.on('connect', () => {
				client.on('binary_response', (data: any) => {
					clearTimeout(timeout);
					expect(data).toBe('Binary: test data');
					resolve();
				});

				client.emit('binary_test', 'test data');
			});

			client.on('connect_error', reject);
		});
	});

	test('should handle multiple clients broadcasting', async () => {
		const client1 = await createSocketIOClient(testServer.url);
		const client2 = await createSocketIOClient(testServer.url);
		const client3 = await createSocketIOClient(testServer.url);

		// Server-side broadcast handler
		testServer.io.on('connection', (socket: any) => {
			socket.on('broadcast_test', (data: any) => {
				socket.broadcast.emit('broadcast_received', data);
			});
		});

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Broadcast test timeout')), 5000);
			let responsesReceived = 0;

			const checkComplete = () => {
				responsesReceived++;
				if (responsesReceived === 2) {
					// client2 и client3 должны получить
					clearTimeout(timeout);
					client1.disconnect();
					client2.disconnect();
					client3.disconnect();
					resolve();
				}
			};

			client1.on('connect', () => {
				// client1 не должен получить свой broadcast
				client1.on('broadcast_received', () => {
					reject(new Error('Sender should not receive broadcast'));
				});
			});

			client2.on('connect', () => {
				client2.on('broadcast_received', (data: any) => {
					expect(data).toBe('broadcast message');
					checkComplete();
				});
			});

			client3.on('connect', () => {
				client3.on('broadcast_received', (data: any) => {
					expect(data).toBe('broadcast message');
					checkComplete();
				});

				// Даем время всем подключиться
				setTimeout(() => {
					client1.emit('broadcast_test', 'broadcast message');
				}, 200);
			});

			[client1, client2, client3].forEach((c) => c.on('connect_error', reject));
		});
	});
});
