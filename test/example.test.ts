/**
 * Socket tests с реальным сервером и Socket.IO клиентом
 * Изолированный проблемный тест для диагностики
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { server as serverIO, client as clientIO } from '#test/utils/test-helper';
import type { Socket as SocketIo } from 'socket.io-client';
import type { createTestServerType } from '#test/utils/test-helper';
import type { Socket } from '@/socket';

describe('Example test', () => {
	let server: createTestServerType;
	let io: createTestServerType['io'];
	let client: SocketIo;

	beforeEach(async () => {
		server = await serverIO();
		io = server.io;
	});

	afterEach(async () => {
		if (client?.connected) {
			client.disconnect();
		}
		server.cleanup();
		console.log('\n Next test \n');
	});

	test('should successfully connect client to server', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

			/** client events */
			client = clientIO(server);

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
				console.log(`Client: Disconnected due to: ${reason}`);
			});
		});
	});

	test('should exchange events between client and server', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Event exchange timeout')), 5000);

			/** server events */
			console.log('🔍 Registering connection handler');

			io.on('connection', (socket: Socket) => {
				console.log('🚀 Client connected, sending test_event'); // ← Добавить лог

				socket.on('test_event', (data: any) => {
					console.log('🔍 test_event received:', data);
					socket.emit('test_response', `Server received: ${data}`);
				});
			});

			/** client events */
			client = clientIO(server);

			client.on('test_response', (response: any) => {
				client.disconnect();
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
		});
	});
});
