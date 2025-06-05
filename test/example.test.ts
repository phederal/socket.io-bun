process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from './utils/test-env';
import type { Socket } from '../src/socket';

describe('Socket.IO Example Tests', () => {
	const { createServer, createClient, cleanup, testEnv } = new TestEnvironment();

	afterEach(() => cleanup());

	test('should successfully connect client to server', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

			client.on('connect', () => {
				clearTimeout(timeout);
				expect(client.connected).toBe(true);
				expect(client.id).toBeDefined();
				resolve();
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should exchange events between client and server', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Event exchange timeout')), 5000);

			// Server events
			io.on('connection', (socket: Socket) => {
				socket.on('test_event', (data: string) => {
					socket.emit('test_response', `Server received: ${data}`);
				});
			});

			// Client events
			client.on('test_response', (response: string) => {
				clearTimeout(timeout);
				expect(response).toBe('Server received: hello from client');
				resolve();
			});

			client.on('connect', () => {
				client.emit('test_event', 'hello from client');
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle acknowledgments', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('ACK timeout')), 5000);

			io.on('connection', (socket: Socket) => {
				socket.on('test_ack', (data: string, callback: Function) => {
					callback(`ACK: ${data}`);
				});
			});

			client.on('connect', () => {
				client.emit('test_ack', 'ack test', (response: string) => {
					clearTimeout(timeout);
					try {
						expect(response).toBe('ACK: ack test');
						resolve();
					} catch (error) {
						reject(error);
					}
				});
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle multiple clients', async () => {
		/** */
		const io = await createServer();
		const client1 = createClient();
		const client2 = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Multiple clients timeout')), 5000);
			let connectedCount = 0;

			const checkConnections = () => {
				connectedCount++;
				if (connectedCount === 2) {
					clearTimeout(timeout);
					expect(testEnv.clientsConnectedCount).toBe(2);
					expect(client1.id).not.toBe(client2.id);
					resolve();
				}
			};

			client1.on('connect', checkConnections);
			client2.on('connect', checkConnections);

			client1.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
			client2.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle room operations', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Room operations timeout')), 5000);

			io.on('connection', (socket: Socket) => {
				socket.join('test-room');
				io.to('test-room').emit('room_broadcast', 'Hello room!');
			});

			client.on('room_broadcast', (message: string) => {
				clearTimeout(timeout);
				expect(message).toBe('Hello room!');
				resolve();
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle namespaces', async () => {
		/** */
		const io = await createServer();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Namespace timeout')), 5000);

			const chatNamespace = io.of('/chat');

			chatNamespace.on('connection', (socket: Socket) => {
				clearTimeout(timeout);
				expect(socket.nsp.name).toBe('/chat');
				resolve();
			});

			const client = createClient({ namespace: '/chat' });

			client.on('connect', () => {
				expect(client['nsp']).toBe('/chat');
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle disconnection', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Disconnection timeout')), 5000);

			client.on('connect', () => {
				expect(client.connected).toBe(true);
				client.disconnect();
			});

			client.on('disconnect', () => {
				clearTimeout(timeout);
				expect(client.connected).toBe(false);
				resolve();
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle server-side disconnection', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Server disconnection timeout')), 5000);

			io.on('connection', (socket: Socket) => {
				socket.disconnect();
			});

			client.on('disconnect', () => {
				clearTimeout(timeout);
				expect(client.connected).toBe(false);
				resolve();
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});

	test('should handle binary data', async () => {
		/** */
		const io = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Binary data timeout')), 5000);

			io.on('connection', (socket: Socket) => {
				socket.on('binary_test', (data) => {
					expect(data).toBeInstanceOf(Buffer);
					socket.emit('binary_response', Buffer.from('response'));
				});
			});

			client.on('connect', () => {
				const binaryData = Buffer.from('test binary data');
				client.emit('binary_test', binaryData);
			});

			client.on('binary_response', (response: Buffer) => {
				clearTimeout(timeout);
				expect(response).toBeInstanceOf(Buffer);
				expect(response.toString()).toBe('response');
				resolve();
			});

			client.on('connect_error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
	});
});
