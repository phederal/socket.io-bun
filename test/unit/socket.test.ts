/**
 * Simple ACK test for Socket class
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestServer, createSocketIOClient } from '../utils/test-env';
import type { createTestServerType } from '../utils/test-env';
import type { Socket as SocketIOClient } from 'socket.io-client';
import type { Socket } from '../../src/socket';

describe('Simple ACK Test', () => {
	let server: createTestServerType;
	let client: SocketIOClient;
	let serverSocket: Socket;

	beforeEach(async () => {
		server = await createTestServer();

		return new Promise<void>((resolve) => {
			server.io.on('connection', (socket: Socket) => {
				serverSocket = socket;
				resolve();
			});

			client = createSocketIOClient(server);
		});
	});

	afterEach(async () => {
		if (client?.connected) {
			client.disconnect();
		}
		server.cleanup();
	});

	test('basic server to client ACK', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('ACK timeout')), 5000);

			client.on('test_event', (callback: Function) => {
				callback('response_data');
			});

			serverSocket.emit('test_event', (response: string) => {
				clearTimeout(timeout);
				expect(response).toBe('response_data');
				resolve();
			});
		});
	});

	test('basic client to server ACK', async () => {
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('ACK timeout')), 5000);

			serverSocket.on('client_event', (callback: Function) => {
				callback('server_response');
			});

			client.emit('client_event', (response: string) => {
				clearTimeout(timeout);
				expect(response).toBe('server_response');
				resolve();
			});
		});
	});
});
