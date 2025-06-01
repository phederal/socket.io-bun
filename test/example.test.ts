process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { testEnv, sleep } from '#test/utils';
import type { Socket } from '@/socket';

describe('Example test', () => {
	const { createServer, cleanup } = testEnv();

	beforeEach(() => {
		cleanup();
	});

	afterEach(() => {
		cleanup();
		console.log('\n');
	});

	test('should successfully connect client to server', async () => {
		/** */
		const { io, createClient } = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

			/** client events */
			client.on('connect', async () => {
				clearTimeout(timeout);
				expect(client.connected).toBe(true);
				expect(client.id).toBeDefined();
				resolve();
			});

			client.on('connect_error', (error: any) => {
				clearTimeout(timeout);
				reject(error);
			});

			// client.on('disconnect', (reason: any) => {
			// 	console.log(`Client: Disconnected due to: ${reason}`);
			// });
		});
	});

	test('should exchange events between client and server', async () => {
		/** */
		const { io, createClient } = await createServer();
		const client = createClient();
		/** */
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Event exchange timeout')), 5000);

			/** server events */
			io.on('connection', (socket: Socket) => {
				socket.on('test_event', async (data: any) => {
					socket.emit('test_response', `Server received: ${data}`);
				});
			});

			/** client events */
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
