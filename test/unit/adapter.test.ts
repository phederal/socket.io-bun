process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TestEnvironment } from '../utils/test-env';
import { Adapter } from '../../src/socket.io-adapter';
import type { Socket } from '../../src/socket';

describe('Adapter', () => {
	const { createServer, createClient, cleanup } = new TestEnvironment();

	describe('Room Management', () => {
		test('should add socket to rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Add to rooms timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const adapter = socket.nsp.adapter;
					const additionalRooms = new Set(['room1', 'room2', 'room3']);

					adapter.addAll(socket.id, additionalRooms);

					const actualRooms = adapter.socketRooms(socket.id);
					expect(actualRooms?.has(socket.id)).toBe(true); // self-room verification
					expect(actualRooms?.has('room1')).toBe(true);
					expect(actualRooms?.has('room2')).toBe(true);
					expect(actualRooms?.has('room3')).toBe(true);
					expect(actualRooms?.size).toBe(4);

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should remove socket from specific room', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Remove from room timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const adapter = socket.nsp.adapter;
					const rooms = new Set(['room1', 'room2', 'room3']);

					adapter.addAll(socket.id, rooms);
					adapter.del(socket.id, 'room2');

					const remainingRooms = adapter.socketRooms(socket.id);
					expect(remainingRooms?.has('room1')).toBe(true);
					expect(remainingRooms?.has('room2')).toBe(false);
					expect(remainingRooms?.has('room3')).toBe(true);

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should remove socket from all rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Remove from all rooms timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const adapter = socket.nsp.adapter;
					const rooms = new Set(['room1', 'room2', 'room3']);

					adapter.addAll(socket.id, rooms);
					adapter.delAll(socket.id);

					const remainingRooms = adapter.socketRooms(socket.id);
					expect(remainingRooms).toBeUndefined();

					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle room events', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Room events timeout')), 3000);
				let testRoomCreated = false;
				let testRoomJoined = false;
				let testRoomLeft = false;
				let testRoomDeleted = false;

				io.on('connection', (socket: Socket) => {
					const adapter = socket.nsp.adapter;

					adapter.on('create-room', (room) => {
						if (room === 'test-room') testRoomCreated = true;
					});

					adapter.on('join-room', (room, socketId) => {
						if (room === 'test-room' && socketId === socket.id) {
							testRoomJoined = true;
						}
					});

					adapter.on('leave-room', (room, socketId) => {
						if (room === 'test-room' && socketId === socket.id) {
							testRoomLeft = true;
						}
					});

					adapter.on('delete-room', (room) => {
						if (room === 'test-room') {
							testRoomDeleted = true;

							expect(testRoomCreated).toBe(true);
							expect(testRoomJoined).toBe(true);
							expect(testRoomLeft).toBe(true);
							expect(testRoomDeleted).toBe(true);

							clearTimeout(timeout);
							resolve();
						}
					});

					adapter.addAll(socket.id, new Set(['test-room']));
					adapter.del(socket.id, 'test-room');
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Socket Lookup', () => {
		test('should get sockets in specific rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();
			const client3 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket lookup timeout')), 3000);
				let connectCount = 0;
				const serverSockets: Socket[] = [];

				io.on('connection', (socket: Socket) => {
					connectCount++;
					serverSockets.push(socket);

					if (connectCount === 1 || connectCount === 2) {
						socket.join('lookup-room');
					}

					if (connectCount === 3) {
						setTimeout(async () => {
							try {
								const adapter = socket.nsp.adapter;
								const socketsInRoom = await adapter.sockets(new Set(['lookup-room']));

								expect(socketsInRoom.size).toBe(2);
								expect(socketsInRoom.has(serverSockets[0]!.id)).toBe(true);
								expect(socketsInRoom.has(serverSockets[1]!.id)).toBe(true);
								expect(socketsInRoom.has(serverSockets[2]!.id)).toBe(false);

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

		test('should get socket rooms', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Socket rooms timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const adapter = socket.nsp.adapter;

					socket.join(['room1', 'room2']);

					setTimeout(() => {
						const rooms = adapter.socketRooms(socket.id);
						expect(rooms?.has('room1')).toBe(true);
						expect(rooms?.has('room2')).toBe(true);
						expect(rooms?.has(socket.id)).toBe(true);

						clearTimeout(timeout);
						resolve();
					}, 50);
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Broadcasting', () => {
		test('should broadcast to all sockets', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Broadcast all timeout')), 3000);
				let connectCount = 0;
				let receivedCount = 0;

				io.on('connection', () => {
					connectCount++;
					if (connectCount === 2) {
						io.emit('adapter_broadcast', 'broadcast message');
					}
				});

				const checkMessage = (data: string) => {
					expect(data).toBe('broadcast message');
					receivedCount++;
					if (receivedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('adapter_broadcast', checkMessage);
				client2.on('adapter_broadcast', checkMessage);

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});

		test('should broadcast to specific rooms', async () => {
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
						socket.join('adapter-room');
					}

					if (connectCount === 3) {
						setTimeout(() => {
							io.to('adapter-room').emit('adapter_room_broadcast', 'room broadcast');
						}, 50);
					}
				});

				const checkInRoom = (data: string) => {
					expect(data).toBe('room broadcast');
					inRoomReceived++;
					if (inRoomReceived === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('adapter_room_broadcast', checkInRoom);
				client2.on('adapter_room_broadcast', checkInRoom);
				client3.on('adapter_room_broadcast', () => {
					clearTimeout(timeout);
					reject(new Error('Client3 should not receive room broadcast'));
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
				client3.on('connect_error', reject);
			});
		});

		test('should handle broadcast with acknowledgments', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Broadcast ack timeout')), 3000);
				let connectCount = 0;

				io.on('connection', () => {
					connectCount++;
					if (connectCount === 2) {
						io.timeout(10).emit('adapter_ack_broadcast', 'ack broadcast', (err: any, responses: string[]) => {
							clearTimeout(timeout);
							expect(err).toBeNull();
							expect(responses).toHaveLength(2);
							expect(responses).toContain('ack1');
							expect(responses).toContain('ack2');
							resolve();
						});
					}
				});

				client1.on('adapter_ack_broadcast', (data, callback) => {
					expect(data).toBe('ack broadcast');
					callback('ack1');
				});

				client2.on('adapter_ack_broadcast', (data, callback) => {
					expect(data).toBe('ack broadcast');
					callback('ack2');
				});

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});
	});

	describe('Adapter Utilities', () => {
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
								const adapter = io.sockets.adapter;
								const roomSockets = await adapter.fetchSockets({
									rooms: new Set(['fetch-room']),
									except: new Set(),
									flags: {},
								});

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

		test('should add sockets to rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Add sockets timeout')), 3000);
				let connectCount = 0;

				io.on('connection', () => {
					connectCount++;
					if (connectCount === 2) {
						setTimeout(async () => {
							try {
								const adapter = io.sockets.adapter;

								adapter.addSockets(
									{
										rooms: new Set(),
										except: new Set(),
										flags: {},
									},
									['add-room'],
								);

								setTimeout(async () => {
									const roomSockets = await adapter.sockets(new Set(['add-room']));
									expect(roomSockets.size).toBe(2);
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

		test('should remove sockets from rooms', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Remove sockets timeout')), 3000);
				let connectCount = 0;

				io.on('connection', (socket: Socket) => {
					connectCount++;
					socket.join('remove-room');

					if (connectCount === 2) {
						setTimeout(async () => {
							try {
								const adapter = io.sockets.adapter;

								let roomSockets = await adapter.sockets(new Set(['remove-room']));
								expect(roomSockets.size).toBe(2);

								adapter.delSockets(
									{
										rooms: new Set(),
										except: new Set(),
										flags: {},
									},
									['remove-room'],
								);

								setTimeout(async () => {
									roomSockets = await adapter.sockets(new Set(['remove-room']));
									expect(roomSockets.size).toBe(0);
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

		test('should disconnect sockets', async () => {
			const io = await createServer();
			const client1 = createClient();
			const client2 = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Disconnect sockets timeout')), 3000);
				let connectCount = 0;
				let disconnectedCount = 0;

				io.on('connection', () => {
					connectCount++;
					if (connectCount === 2) {
						const adapter = io.sockets.adapter;
						adapter.disconnectSockets(
							{
								rooms: new Set(),
								except: new Set(),
								flags: {},
							},
							false,
						);
					}
				});

				const onDisconnect = () => {
					disconnectedCount++;
					if (disconnectedCount === 2) {
						clearTimeout(timeout);
						resolve();
					}
				};

				client1.on('disconnect', onDisconnect);
				client2.on('disconnect', onDisconnect);

				client1.on('connect_error', reject);
				client2.on('connect_error', reject);
			});
		});
	});

	describe('Adapter Configuration', () => {
		test('should return server count', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Server count timeout')), 3000);

				io.on('connection', async (socket: Socket) => {
					try {
						const adapter = socket.nsp.adapter;
						const serverCount = await adapter.serverCount();
						expect(serverCount).toBe(1);
						clearTimeout(timeout);
						resolve();
					} catch (error) {
						clearTimeout(timeout);
						reject(error);
					}
				});

				client.on('connect_error', reject);
			});
		});

		test('should handle adapter initialization', async () => {
			const io = await createServer();
			const adapter = io.sockets.adapter;

			expect(adapter).toBeDefined();
			expect(adapter.nsp).toBe(io.sockets);

			await adapter.init();
			await adapter.close();
		});
	});

	describe('Bun Pub/Sub Integration', () => {
		test('should subscribe to namespace topics', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Subscription timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					expect(socket['ws'].isSubscribed(socket.nsp.name)).toBe(true);
					clearTimeout(timeout);
					resolve();
				});

				client.on('connect_error', reject);
			});
		});

		test('should subscribe/unsubscribe to room topics', async () => {
			const io = await createServer();
			const client = createClient();

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Room subscription timeout')), 3000);

				io.on('connection', (socket: Socket) => {
					const roomTopic = `${socket.nsp.name}\x1ftest-room`;

					socket.join('test-room');
					setTimeout(() => {
						expect(socket['ws'].isSubscribed(roomTopic)).toBe(true);

						socket.leave('test-room');
						setTimeout(() => {
							expect(socket['ws'].isSubscribed(roomTopic)).toBe(false);
							clearTimeout(timeout);
							resolve();
						}, 50);
					}, 50);
				});

				client.on('connect_error', reject);
			});
		});
	});

	describe('Error Handling', () => {
		test('should handle invalid socket operations', async () => {
			const io = await createServer();
			const adapter = io.sockets.adapter;

			adapter.del('non-existent-socket', 'some-room');
			adapter.delAll('non-existent-socket');

			const rooms = adapter.socketRooms('non-existent-socket');
			expect(rooms).toBeUndefined();
		});

		test('should handle empty room operations', async () => {
			const io = await createServer();
			const adapter = io.sockets.adapter;

			const sockets = await adapter.sockets(new Set(['empty-room']));
			expect(sockets.size).toBe(0);

			adapter.addSockets(
				{
					rooms: new Set(['empty-room']),
					except: new Set(),
					flags: {},
				},
				['another-room'],
			);

			adapter.delSockets(
				{
					rooms: new Set(['empty-room']),
					except: new Set(),
					flags: {},
				},
				['another-room'],
			);
		});
	});
});
