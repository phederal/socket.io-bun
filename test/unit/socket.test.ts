/**
 * Socket tests с реальным сервером и Socket.IO клиентом
 * Изолированный проблемный тест для диагностики
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestServer, createSocketIOClient } from '../utils/test-helper';
import type { createTestServerType } from '../utils/test-helper';

import { type Socket as SocketIo } from 'socket.io-client';
import { type Socket } from '../../socket';

describe('Socket Tests', () => {
	let server: createTestServerType;
	let client: SocketIo;

	beforeEach(async () => {
		server = await createTestServer();
	});

	afterEach(async () => {
		if (client?.connected) {
			client.disconnect();
		}
		server.cleanup();
	});

	test('should successfully connect client to server', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

			client = createSocketIOClient(server.url);

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

			client.on('disconnect', (reason: any) => {
				// console.log(`Client: Disconnected due to: ${reason}`);
			});
		});
	});

	test('should exchange events between client and server', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Event exchange timeout')), 5000);

			/** server events */
			server.io.on('connection', (socket: Socket) => {
				socket.on('test_event', (data: any) => {
					socket.emit('test_response', `Server received: ${data}`);
				});
			});

			/** client events */
			client = createSocketIOClient(server.url);

			client.on('test_response', (response: any) => {
				clearTimeout(timeout);
				expect(response).toBe('Server received: hello from client');
				resolve();
			});

			client.on('connect', () => {
				client.emit('test_event', 'hello from client');
			});

			client.on('connect_error', (error: any) => {
				console.error(`Client: Connection error:`, error);
				clearTimeout(timeout);
				reject(error);
			});

			// console.log(client);
		});
	});
});
