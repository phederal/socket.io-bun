process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import type { Socket } from '../../src/socket';
import { sleep } from '../utils';

describe('Connection/Transport Layer', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	describe('WebSocket Connection Lifecycle', () => {
		test('should establish WebSocket connection with proper handshake', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Connection timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					// Verify handshake details
					expect(socket.handshake).toBeDefined();
					expect(socket.handshake.headers).toBeDefined();
					expect(socket.handshake.time).toBeDefined();
					expect(socket.handshake.address).toBeDefined();
					expect(socket.handshake.issued).toBeNumber();
					expect(socket.handshake.url).toBeDefined();
					expect(socket.handshake.query).toBeDefined();
					expect(socket.handshake.auth).toBeDefined();
				});

				client.on('connect', () => {
					clearTimeout(timeout);
					expect(client.connected).toBe(true);
					expect(client.id).toBeDefined();
					expect(typeof client.id).toBe('string');
					resolve();
				});

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});

		test('should handle WebSocket disconnect properly', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Disconnect timeout')), 3000);
				let serverSocket: Socket;

				io.on('connection', (socket: Socket) => {
					serverSocket = socket;

					socket.on('disconnect', (reason) => {
						expect(reason).toBe('client namespace disconnect');
						expect(socket.connected).toBe(false);
					});
				});

				client.on('disconnect', (reason) => {
					clearTimeout(timeout);
					expect(client.connected).toBe(false);
					expect(reason).toBeDefined();

					// Verify server socket state
					if (serverSocket) {
						setTimeout(() => {
							expect(serverSocket.connected).toBe(false);
						}, 100);
					}
					resolve();
				});

				client.on('connect', () => {
					expect(client.connected).toBe(true);
					// client.disconnect();
					setImmediate(() => client.disconnect());
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle server-side disconnect with proper cleanup', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Server disconnect timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					// Test server-initiated disconnect
					expect(socket.connected).toBe(true);
					socket.disconnect();

					setTimeout(() => {
						expect(socket.connected).toBe(false);
					}, 100);
				});

				client.on('disconnect', (reason) => {
					clearTimeout(timeout);
					expect(client.connected).toBe(false);
					expect(reason).toBe('io server disconnect');
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle forced connection close', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Forced close timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					// Monitor transport layer close event
					socket.conn.on('close', (reason) => {
						expect(['transport close', 'forced close']).toContain(reason);
					});

					setTimeout(() => {
						socket.disconnect(true); // force=true closes underlying transport
					}, 100);
				});

				// Client transport close event
				client.on('disconnect', (reason) => {
					clearTimeout(timeout);
					expect(client.connected).toBe(false);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('ReadyState Management', () => {
		test('should properly track connection readyState transitions', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('ReadyState timeout')), 3000);
				const transportStates: number[] = [];

				io.on('connection', (socket: Socket) => {
					// Access Engine.IO transport readyState
					expect(socket.conn.readyState).toBe(WebSocket.OPEN);
					transportStates.push(socket.conn.readyState);

					// Monitor transport layer close
					socket.conn.on('close', () => {
						expect(socket.conn.readyState).toBe(WebSocket.CLOSED);
						transportStates.push(socket.conn.readyState);
					});
				});

				client.on('connect', () => {
					// Client connected at Socket.IO layer
					expect(client.connected).toBe(true);
					client.disconnect();
				});

				client.on('disconnect', () => {
					clearTimeout(timeout);
					expect(client.connected).toBe(false);
					// for abstract connection (socket.io-bun) use nextTick
					setImmediate(() => {
						expect(transportStates).toContain(WebSocket.OPEN);
						expect(transportStates).toContain(WebSocket.CLOSED);
					});
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle rapid connect/disconnect cycles', async () => {
			const io = await createServer();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Rapid cycles timeout')), 5000);
				let connectionCount = 0;
				let disconnectionCount = 0;
				const targetCycles = 3;

				io.on('connection', (socket: Socket) => {
					connectionCount++;
					expect(socket.connected).toBe(true);

					socket.on('disconnect', () => {
						disconnectionCount++;
						expect(socket.connected).toBe(false);

						if (disconnectionCount === targetCycles) {
							clearTimeout(timeout);
							process.nextTick(() => {
								expect(connectionCount).toBe(targetCycles);
								expect(disconnectionCount).toBe(targetCycles);
							});
							resolve();
						}
					});
				});

				// Create multiple rapid connections
				for (let i = 0; i < targetCycles; i++) {
					setTimeout(() => {
						const client = createClient();
						client.on('connect', () => {
							setTimeout(() => client.disconnect(), 50);
						});
						client.on('connect_error', reject);
					}, i * 100);
				}
			});
		});
	});

	describe('Ping/Pong Mechanism', () => {
		test('should handle ping/pong heartbeat correctly', async () => {
			// Create server with shorter ping intervals for testing
			const io = await createServer({
				// These options would be passed to engine options
				pingTimeout: 1000,
				pingInterval: 500,
			});
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Heartbeat timeout')), 3000);
				let heartbeatReceived = false;

				io.on('connection', (socket: Socket) => {
					// Listen for heartbeat events from engine layer
					socket.conn.on('heartbeat', () => {
						heartbeatReceived = true;
						expect(heartbeatReceived).toBe(true);
						resolve();
					});

					// Verify ping/pong mechanism by checking heartbeat
					setTimeout(() => {
						clearTimeout(timeout);
						reject();
					}, 1500); // Wait for at least one ping cycle
				});

				client.on('connect_error', reject);
			});
		});

		test('should detect ping timeout and disconnect', async () => {
			const io = await createServer({
				pingTimeout: 500,
				pingInterval: 200,
			});
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Ping timeout test failed')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('disconnect', (reason) => {
						clearTimeout(timeout);
						expect(reason).toBe('ping timeout');
						resolve();
					});

					// Simulate client not responding to pings by accessing raw WebSocket
					setTimeout(() => {
						const engineSocket = socket.conn as any;
						const transport = engineSocket.transport;

						// Override emit to filter packet events
						const originalEmit = transport.emit.bind(transport);
						transport.emit = function (event: string, ...args: any[]) {
							// Filter only packet events
							if (event === 'packet') {
								const type = args[0]?.type;
								// ignore pongs
								if (type === 'pong') {
									return false;
								}
							}
							return originalEmit(event, ...args);
						};
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should maintain connection with proper ping/pong responses', async () => {
			const io = await createServer({
				pingTimeout: 1000,
				pingInterval: 300,
			});
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 2000); // Expect connection to remain alive
				let disconnected = false;

				io.on('connection', (socket: Socket) => {
					socket.on('disconnect', () => {
						disconnected = true;
						clearTimeout(timeout);
						reject(new Error('Connection should not have been disconnected'));
					});
				});

				client.on('disconnect', () => {
					disconnected = true;
					clearTimeout(timeout);
					reject(new Error('Client should not have disconnected'));
				});

				client.on('connect', () => {
					// Wait for multiple ping cycles
					setTimeout(() => {
						clearTimeout(timeout);
						expect(disconnected).toBe(false);
						expect(client.connected).toBe(true);
						resolve();
					}, 1500);
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Network Error Handling', () => {
		test('should handle transport errors gracefully', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Transport error timeout')), 3000);
				let errorHandled = false;

				io.on('connection', (socket: Socket) => {
					socket.on('error', (error) => {
						errorHandled = true;
						expect(error).toBeInstanceOf(Error);
					});

					socket.on('disconnect', (reason) => {
						clearTimeout(timeout);
						expect(['transport error', 'transport close', 'parse error']).toContain(reason);
						resolve();
					});

					// Simulate transport error by accessing underlying connection
					setTimeout(() => {
						socket.conn['transport'].emit('error', new Error('Simulated transport error'));
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle malformed packet data', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Malformed packet timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.on('error', (error) => {
						expect(error).toBeInstanceOf(Error);
					});

					socket.on('disconnect', (reason) => {
						clearTimeout(timeout);
						expect(reason).toBe('parse error');
						resolve();
					});

					// Send malformed data directly to transport
					setTimeout(() => {
						const transport = socket.conn['transport'];
						if (transport) {
							// Simulate malformed packet
							transport.emit('packet', { type: 'invalid', data: null });
						}
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle connection drops during data transmission', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Connection drop timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					// Monitor transport layer close event
					socket.conn.on('close', (reason) => {
						clearTimeout(timeout);
						expect(['transport close', 'transport error']).toContain(reason);
						resolve();
					});

					// Start data transmission
					const interval = setInterval(() => {
						if (socket.connected) {
							socket.emit('test_data', 'transmission data');
						}
					}, 50);

					setTimeout(() => {
						clearInterval(interval);
						// Force close underlying WebSocket transport
						if (socket['ws'] && socket['ws'].readyState === WebSocket.OPEN) {
							socket['ws'].close();
						}
					}, 200);
				});

				client.on('test_data', () => {
					// Data reception acknowledgment
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Large Message Handling', () => {
		test('should handle large text messages', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Large message timeout')), 5000);
				const sizeBytes = 1024 * 100; // 100KB text message
				const largeMessage = 'x'.repeat(sizeBytes);

				io.on('connection', (socket: Socket) => {
					socket.on('large_message', (data: string) => {
						expect(data).toBe(largeMessage);
						expect(data.length).toBe(sizeBytes);
						socket.emit('large_response', largeMessage);
					});
				});

				client.on('large_response', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe(largeMessage);
					expect(data.length).toBe(sizeBytes);
					resolve();
				});

				client.on('connect', () => {
					client.emit('large_message', largeMessage);
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle large binary messages', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Large binary timeout')), 5000);
				const sizeBytes = 1024 * 50; // 50KB text message
				const largeBinary = new Uint8Array(sizeBytes); // 50KB binary
				largeBinary.fill(42);

				io.on('connection', (socket: Socket) => {
					socket.on('large_binary', (data: Uint8Array) => {
						expect(data).toBeInstanceOf(Uint8Array);
						expect(data.length).toBe(sizeBytes);
						expect(data[0]).toBe(42);
						socket.emit('binary_response', data);
					});
				});

				client.on('binary_response', (data: Uint8Array) => {
					clearTimeout(timeout);
					expect(data).toBeInstanceOf(Uint8Array);
					expect(data.length).toBe(sizeBytes);
					expect(data[0]).toBe(42);
					resolve();
				});

				client.on('connect', () => {
					client.emit('large_binary', largeBinary);
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle message fragmentation correctly', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Fragmentation timeout')), 3000);
				const messages: string[] = [];
				const expectedMessages = ['chunk1', 'chunk2', 'chunk3'];

				io.on('connection', (socket: Socket) => {
					socket.on('message_chunk', (data: string) => {
						messages.push(data);
						if (messages.length === expectedMessages.length) {
							expect(messages).toEqual(expectedMessages);
							socket.emit('all_chunks_received', messages);
						}
					});
				});

				client.on('all_chunks_received', (receivedMessages: string[]) => {
					clearTimeout(timeout);
					expect(receivedMessages).toEqual(expectedMessages);
					resolve();
				});

				client.on('connect', () => {
					// Send multiple messages rapidly to test fragmentation handling
					expectedMessages.forEach((msg, index) => {
						setTimeout(() => {
							client.emit('message_chunk', msg);
						}, index * 10);
					});
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Connection Timeout Handling', () => {
		test('should handle connection timeout during handshake', async () => {
			// This test requires a server with very short connect timeout
			const io = await createServer({
				auth: {
					user: false,
					session: false,
				},
			});

			// Create client but don't provide required auth
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Connection timeout test failed')), 3000);

				client.on('connect_error', (error) => {
					clearTimeout(timeout);
					expect(error).toBeDefined();
					expect(error.message).toMatch(/unauthorized|timeout/i);
					resolve();
				});

				client.on('connect', () => {
					clearTimeout(timeout);
					reject(new Error('Should not have connected without proper auth'));
				});
			});
		});

		test('should cleanup resources on connection timeout', async () => {
			const io = await createServer();
			let serverSocket: Socket;

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Cleanup timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					serverSocket = socket;

					socket.on('disconnect', (reason) => {
						clearTimeout(timeout);
						expect(reason).toBeDefined();

						// Verify cleanup
						expect(socket.connected).toBe(false);
						expect(socket.rooms.size).toBe(0);
						resolve();
					});
				});

				const client = createClient();

				client.on('connect', () => {
					// Forcefully close connection to simulate timeout
					setTimeout(() => {
						// Access underlying transport through socket.io client API
						const engine = client.io.engine;
						if (engine.transport['socket']) {
							engine.transport['socket'].close();
						} else {
							// Fallback to standard disconnect
							client.disconnect();
						}
					}, 100);
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle multiple simultaneous connection timeouts', async () => {
			const io = await createServer();
			const clientCount = 5;
			let disconnectedCount = 0;

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple timeouts test failed')), 5000);

				io.on('connection', (socket: Socket) => {
					socket.on('disconnect', () => {
						disconnectedCount++;
						if (disconnectedCount === clientCount) {
							clearTimeout(timeout);
							resolve();
						}
					});
				});

				// Create multiple clients and force timeouts
				for (let i = 0; i < clientCount; i++) {
					const client = createClient();
					client.on('connect', () => {
						// Force close the underlying WebSocket if accessible
						setTimeout(() => {
							if (client.connected) {
								// Access underlying transport if available through socket.io client API
								const engine = client.io?.engine;
								if (engine.transport['socket']) {
									engine.transport['socket'].close();
								} else {
									// Fallback to client disconnect
									client.disconnect();
								}
							}
						}, 100 + i * 10); // Staggered timeouts
					});
					client.on('connect_error', reject);
				}
			});
		});
	});
});
