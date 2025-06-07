process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import type { Socket } from '../../src/socket';

describe('BroadcastOperator', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	describe('Basic Broadcasting', () => {
		test('should broadcast to all connected clients', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Broadcast timeout')), 3000);
				let receivedCount = 0;

				const checkMessage = (data: string) => {
					expect(data).toBe('broadcast message');
					receivedCount++;
					if (receivedCount === 3) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('broadcast_event', checkMessage);
				client2.on('broadcast_event', checkMessage);
				client3.on('broadcast_event', checkMessage);

				Promise.all([
					new Promise((resolve: (value?: unknown) => void) => client1.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => client2.on('connect', resolve)),
					new Promise((resolve: (value?: unknown) => void) => client3.on('connect', resolve)),
				]).then(() => {
					io.emit('broadcast_event', 'broadcast message');
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});

		test('should broadcast to empty room', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 100); // Resolve if no message

				client.on('empty_room_event', () => {
					clearTimeout(timeout);
					reject(new Error('Should not receive message for empty room'));
				});

				client.on('connect', () => {
					io.to('empty-room').emit('empty_room_event', 'empty room message');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Room Broadcasting', () => {
		test('should broadcast to specific room', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Room broadcast timeout')), 3000);
				let connectCount = 0;
				let inRoomReceived = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1 || connectCount === 2) {
						socket.join('test-room');
					}

					if (connectCount === 3) {
						io.to('test-room').emit('room_event', 'room message');
					}
				});

				const checkInRoom = (data: string) => {
					expect(data).toBe('room message');
					inRoomReceived++;
					if (inRoomReceived === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('room_event', checkInRoom);
				client2.on('room_event', checkInRoom);
				client3.on('room_event', () => {
					clearTimeout(timeout);
					reject(new Error('Client not in room should not receive message'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});

		test('should broadcast to multiple rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Multiple rooms broadcast timeout')), 3000);
				let connectCount = 0;
				let receivedCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						socket.join('room1');
					} else if (connectCount === 2) {
						socket.join('room2');
					}
					// client3 не регистрируется в комнатах

					if (connectCount === 3) {
						io.to(['room1', 'room2']).emit('multi_room_event', 'multi room message');
					}
				});

				const checkMessage = (data: string) => {
					expect(data).toBe('multi room message');
					receivedCount++;
					if (receivedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('multi_room_event', checkMessage);
				client2.on('multi_room_event', checkMessage);
				client3.on('multi_room_event', () => {
					clearTimeout(timeout);
					reject(new Error('Client3 should not receive message'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});

		test('should use in() alias for to()', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('In alias timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					socket.join('alias-room');
					io.in('alias-room').emit('alias_event', 'alias message');
				});

				client.on('alias_event', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('alias message');
					resolve();
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Exclusion Broadcasting', () => {
		test('should exclude specific rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Except broadcast timeout')), 3000);
				let connectCount = 0;
				let includedCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						socket.join('excluded-room');
					}

					if (connectCount === 3) {
						io.except('excluded-room').emit('except_event', 'except message');
					}
				});

				client1.on('except_event', () => {
					clearTimeout(timeout);
					reject(new Error('Excluded client should not receive message'));
				});

				const checkIncluded = (data: string) => {
					expect(data).toBe('except message');
					includedCount++;
					if (includedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client2.on('except_event', checkIncluded);
				client3.on('except_event', checkIncluded);

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});

		test('should chain to() and except()', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Chain broadcast timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						socket.join(['include-room', 'exclude-room']);
					} else if (connectCount === 2) {
						socket.join('include-room');
					}

					if (connectCount === 3) {
						io.to('include-room').except('exclude-room').emit('chain_event', 'chain message');
					}
				});

				client1.on('chain_event', () => {
					clearTimeout(timeout);
					reject(new Error('Client1 should be excluded'));
				});

				client2.on('chain_event', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('chain message');
					resolve();
				});

				client3.on('chain_event', () => {
					clearTimeout(timeout);
					reject(new Error('Client3 should not receive message'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});
	});

	describe('Broadcast Modifiers', () => {
		test('should handle volatile broadcasts', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => resolve(), 100);

				client.on('volatile_broadcast', () => {
					clearTimeout(timeout);
					reject(new Error('Volatile broadcast should not be guaranteed'));
				});

				client.on('connect', () => {
					client.disconnect();
					io.volatile.emit('volatile_broadcast', 'volatile message');
				});
			});
		});

		test('should handle local broadcasts', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Local broadcast timeout')), 3000);

				client.on('local_broadcast', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('local message');
					resolve();
				});

				client.on('connect', () => {
					io.local.emit('local_broadcast', 'local message');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle compression in broadcasts', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Compress broadcast timeout')), 3000);

				client.on('compress_broadcast', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('compressed message');
					resolve();
				});

				client.on('connect', () => {
					io.compress(true).emit('compress_broadcast', 'compressed message');
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle timeout in broadcasts', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Timeout broadcast test timeout')), 5000);

				client.on('connect', () => {
					io.timeout(1000).emit('timeout_broadcast', 'timeout data', (err: Error) => {
						clearTimeout(timeout);
						expect(err).toBeDefined();
						expect(err.message).toContain('timed out');
						resolve();
					});
				});

				// Client doesn't respond to trigger timeout
				client.on('timeout_broadcast', () => {
					// Don't call callback
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Broadcast with Acknowledgments', () => {
		test('should handle emitWithAck broadcasts', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('EmitWithAck broadcast timeout')), 3000);
				let connectCount = 0;

				io.on('connection', () => {
					connectCount++;

					if (connectCount === 2) {
						setTimeout(async () => {
							try {
								const responses = await io.timeout(1000).emitWithAck('ack_broadcast', 'ack data');
								clearTimeout(timeout);
								expect(responses).toHaveLength(2);
								expect(responses).toContain('ack1');
								expect(responses).toContain('ack2');
								resolve();
							} catch (error) {
								clearTimeout(timeout);
								reject(error);
							}
						}, 50);
					}
				});

				client1.on('ack_broadcast', (data: string, callback: Function) => {
					expect(data).toBe('ack data');
					callback('ack1');
				});

				client2.on('ack_broadcast', (data: string, callback: Function) => {
					expect(data).toBe('ack data');
					callback('ack2');
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should handle room-specific emitWithAck', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Room emitWithAck timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						socket.join('ack-room');
					}

					if (connectCount === 2) {
						setTimeout(async () => {
							try {
								const responses = await io.to('ack-room').emitWithAck('room_ack_broadcast', 'room ack data');
								clearTimeout(timeout);
								expect(responses).toHaveLength(1);
								expect(responses[0]).toBe('room ack1');
								resolve();
							} catch (error) {
								clearTimeout(timeout);
								reject(error);
							}
						}, 50);
					}
				});

				client1.on('room_ack_broadcast', (data: string, callback: Function) => {
					expect(data).toBe('room ack data');
					callback('room ack1');
				});

				client2.on('room_ack_broadcast', () => {
					clearTimeout(timeout);
					reject(new Error('Client2 should not receive room message'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});
	});

	describe('Broadcast Utility Methods', () => {
		test('should fetch sockets with filters', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Fetch sockets timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1 || connectCount === 2) {
						socket.join('fetch-room');
					}

					if (connectCount === 3) {
						setTimeout(async () => {
							try {
								const allSockets = await io.fetchSockets();
								expect(allSockets).toHaveLength(3);

								const roomSockets = await io.in('fetch-room').fetchSockets();
								expect(roomSockets).toHaveLength(2);

								clearTimeout(timeout);
								resolve();
							} catch (error) {
								clearTimeout(timeout);
								reject(error);
							}
						}, 50);
					}
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});

		test('should make sockets join rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Sockets join timeout')), 3000);
				let connectCount = 0;

				io.on('connection', () => {
					connectCount++;

					if (connectCount === 2) {
						setTimeout(async () => {
							try {
								io.socketsJoin('new-room');

								setTimeout(async () => {
									const roomSockets = await io.in('new-room').fetchSockets();
									expect(roomSockets).toHaveLength(2);
									clearTimeout(timeout);
									resolve();
								}, 50);
							} catch (error) {
								clearTimeout(timeout);
								reject(error);
							}
						}, 50);
					}
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should make sockets leave rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Sockets leave timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;
					socket.join('leave-room');

					if (connectCount === 2) {
						setTimeout(async () => {
							try {
								let roomSockets = await io.in('leave-room').fetchSockets();
								expect(roomSockets).toHaveLength(2);

								io.socketsLeave('leave-room');

								setTimeout(async () => {
									roomSockets = await io.in('leave-room').fetchSockets();
									expect(roomSockets).toHaveLength(0);
									clearTimeout(timeout);
									resolve();
								}, 50);
							} catch (error) {
								clearTimeout(timeout);
								reject(error);
							}
						}, 50);
					}
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should disconnect sockets with filters', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Disconnect sockets timeout')), 3000);
				let connectCount = 0;
				let disconnectedCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1 || connectCount === 2) {
						socket.join('disconnect-room');
					}

					if (connectCount === 3) {
						setTimeout(() => {
							io.in('disconnect-room').disconnectSockets();
						}, 50);
					}
				});

				const onDisconnect = () => {
					disconnectedCount++;
					if (disconnectedCount === 2) {
						setTimeout(() => {
							expect(client3.connected).toBe(true);
							clearTimeout(timeout);
							resolve();
						}, 100);
					}
				};

				client1.on('disconnect', onDisconnect);
				client2.on('disconnect', onDisconnect);
				client3.on('disconnect', () => {
					clearTimeout(timeout);
					reject(new Error('Client3 should not be disconnected'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});
	});

	describe('Chained Broadcasting', () => {
		test('should chain multiple modifiers', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Chained modifiers timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;

					if (connectCount === 1) {
						socket.join('target-room');
					} else if (connectCount === 2) {
						socket.join(['target-room', 'exclude-room']);
					}

					if (connectCount === 3) {
						setTimeout(() => {
							io.to('target-room').except('exclude-room').compress(true).emit('chained_event', 'chained message');
						}, 50);
					}
				});

				client1.on('chained_event', (data: string) => {
					clearTimeout(timeout);
					expect(data).toBe('chained message');
					resolve();
				});

				client2.on('chained_event', () => {
					clearTimeout(timeout);
					reject(new Error('Client2 should be excluded'));
				});

				client3.on('chained_event', () => {
					clearTimeout(timeout);
					reject(new Error('Client3 should not receive message'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});
	});
});
