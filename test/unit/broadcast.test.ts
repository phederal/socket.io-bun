/**
 * Unit tests for BroadcastOperator class
 */

import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { BroadcastOperator } from '../../socket/broadcast';

// Mock adapter
class MockAdapter {
	nsp = {
		sockets: new Map(),
	};

	getSockets = mock((rooms?: Set<string>) => {
		if (!rooms || rooms.size === 0) {
			return new Set(['socket1', 'socket2', 'socket3']);
		}
		if (rooms.has('room1')) {
			return new Set(['socket1', 'socket2']);
		}
		if (rooms.has('room2')) {
			return new Set(['socket2', 'socket3']);
		}
		return new Set();
	});
}

// Mock socket
class MockSocket {
	id: string;
	connected = true;
	ws = { readyState: 1 };

	emit = mock(() => true);
	emitBinary = mock(() => true);
	emitFast = mock(() => true);
	emitBatch = mock(() => 1);
	join = mock(() => {});
	leave = mock(() => {});
	disconnect = mock(() => {});

	constructor(id: string) {
		this.id = id;
	}
}

describe('BroadcastOperator', () => {
	let mockAdapter: MockAdapter;
	let broadcast: BroadcastOperator;

	beforeEach(() => {
		mockAdapter = new MockAdapter();

		// Setup mock sockets
		mockAdapter.nsp.sockets.set('socket1', new MockSocket('socket1'));
		mockAdapter.nsp.sockets.set('socket2', new MockSocket('socket2'));
		mockAdapter.nsp.sockets.set('socket3', new MockSocket('socket3'));

		broadcast = new BroadcastOperator(mockAdapter as any);
	});

	describe('Room Targeting', () => {
		test('should target single room', () => {
			const targeted = broadcast.to('room1');
			expect(targeted).toBeInstanceOf(BroadcastOperator);
			expect(targeted).not.toBe(broadcast); // Should be new instance
		});

		test('should target multiple rooms', () => {
			const targeted = broadcast.to(['room1', 'room2']);
			expect(targeted).toBeInstanceOf(BroadcastOperator);
		});

		test('should use in() as alias for to()', () => {
			const targeted1 = broadcast.to('room1');
			const targeted2 = broadcast.in('room1');
			expect(targeted1).toBeInstanceOf(BroadcastOperator);
			expect(targeted2).toBeInstanceOf(BroadcastOperator);
		});

		test('should exclude rooms', () => {
			const excluded = broadcast.except('room1');
			expect(excluded).toBeInstanceOf(BroadcastOperator);
		});

		test('should exclude multiple rooms', () => {
			const excluded = broadcast.except(['room1', 'room2']);
			expect(excluded).toBeInstanceOf(BroadcastOperator);
		});

		test('should exclude socket IDs', () => {
			// 20-character string should be treated as socket ID
			const socketId = 'a'.repeat(20);
			const excluded = broadcast.except(socketId);
			expect(excluded).toBeInstanceOf(BroadcastOperator);
		});
	});

	describe('Flags', () => {
		test('should set volatile flag', () => {
			const volatile = broadcast.volatile;
			expect(volatile).toBeInstanceOf(BroadcastOperator);
		});

		test('should set compress flag', () => {
			const compressed = broadcast.compress(true);
			expect(compressed).toBeInstanceOf(BroadcastOperator);
		});

		test('should set local flag', () => {
			const local = broadcast.local;
			expect(local).toBeInstanceOf(BroadcastOperator);
		});

		test('should set binary flag', () => {
			const binary = broadcast.binary;
			expect(binary).toBeInstanceOf(BroadcastOperator);
		});

		test('should set timeout', () => {
			const timeout = broadcast.timeout(5000);
			expect(timeout).toBeInstanceOf(BroadcastOperator);
		});

		test('should chain flags', () => {
			const chained = broadcast.to('room1').binary.volatile.timeout(1000);
			expect(chained).toBeInstanceOf(BroadcastOperator);
		});
	});

	describe('Event Emission', () => {
		test('should emit to all sockets', () => {
			const result = broadcast.emit('test_event', 'test data');
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const socket2 = mockAdapter.nsp.sockets.get('socket2');
			const socket3 = mockAdapter.nsp.sockets.get('socket3');

			expect(socket1.emit).toHaveBeenCalledWith('test_event', 'test data');
			expect(socket2.emit).toHaveBeenCalledWith('test_event', 'test data');
			expect(socket3.emit).toHaveBeenCalledWith('test_event', 'test data');
		});

		test('should emit to specific room', () => {
			const result = broadcast.to('room1').emit('room_event', 'room data');
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const socket2 = mockAdapter.nsp.sockets.get('socket2');
			const socket3 = mockAdapter.nsp.sockets.get('socket3');

			expect(socket1.emit).toHaveBeenCalledWith('room_event', 'room data');
			expect(socket2.emit).toHaveBeenCalledWith('room_event', 'room data');
			expect(socket3.emit).not.toHaveBeenCalled();
		});

		test('should emit with binary flag', () => {
			const result = broadcast.binary.emit('binary_event', 'binary data');
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			expect(socket1.emitBinary).toHaveBeenCalledWith('binary_event', 'binary data');
		});

		test('should emit without data', () => {
			const result = broadcast.emit('simple_event');
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			expect(socket1.emitFast).toHaveBeenCalledWith('simple_event');
		});

		test('should handle emit failure', () => {
			// Make one socket fail
			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			socket1.emit = mock(() => false);

			const result = broadcast.emit('test_event', 'test data');
			expect(result).toBe(false); // Should return false if any socket fails
		});

		test('should skip disconnected sockets', () => {
			// Make socket disconnected
			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			socket1.connected = false;

			const result = broadcast.emit('test_event', 'test data');
			expect(result).toBe(true);
			expect(socket1.emit).not.toHaveBeenCalled();
		});

		test('should skip sockets with closed WebSocket', () => {
			// Make WebSocket closed
			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			socket1.ws.readyState = 3; // CLOSED

			const result = broadcast.emit('test_event', 'test data');
			expect(result).toBe(true);
			expect(socket1.emit).not.toHaveBeenCalled();
		});
	});

	describe('Acknowledgments', () => {
		test('should handle ACK with no target sockets', (done) => {
			// Mock adapter to return empty set
			mockAdapter.getSockets = mock(() => new Set());

			broadcast.emit('test_event', 'data', (err: any, responses: any[]) => {
				expect(err).toBeNull();
				expect(responses).toEqual([]);
				done();
			});
		});

		test('should handle ACK timeout', (done) => {
			// Speed up test
			const originalSetTimeout = global.setTimeout;
			global.setTimeout = ((callback: any) => {
				callback();
				return 1 as any;
			}) as any;

			broadcast.timeout(1).emit('test_event', 'data', (err: any, responses: any[]) => {
				expect(err).toBeInstanceOf(Error);
				expect(err.message).toContain('timeout');
				global.setTimeout = originalSetTimeout;
				done();
			});
		});

		test('should collect responses from multiple sockets', (done) => {
			// Mock sockets with ACK callbacks
			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const socket2 = mockAdapter.nsp.sockets.get('socket2');

			socket1.ackCallbacks = new Map();
			socket2.ackCallbacks = new Map();

			broadcast.emit('test_event', 'data', (err: any, responses: any[]) => {
				expect(err).toBeNull();
				expect(responses).toHaveLength(2);
				done();
			});

			// Simulate ACK responses
			setTimeout(() => {
				// Find ACK IDs and respond
				const ackId1 = Array.from(socket1.ackCallbacks.keys())[0];
				const ackId2 = Array.from(socket2.ackCallbacks.keys())[0];

				if (ackId1) {
					const callback1 = socket1.ackCallbacks.get(ackId1)?.callback;
					callback1?.(null, 'response1');
				}
				if (ackId2) {
					const callback2 = socket2.ackCallbacks.get(ackId2)?.callback;
					callback2?.(null, 'response2');
				}
			}, 10);
		});
	});

	describe('Fast Operations', () => {
		test('should emit fast without binary flag', () => {
			const result = broadcast.emitFast('fast_event', 'fast data');
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			expect(socket1.emitFast).toHaveBeenCalledWith('fast_event', 'fast data');
		});

		test('should emit fast with binary flag', () => {
			const result = broadcast.binary.emitFast('fast_binary', 'binary data');
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			expect(socket1.emitBinary).toHaveBeenCalledWith('fast_binary', 'binary data');
		});

		test('should handle fast emit failures', () => {
			// Make one socket fail
			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			socket1.emitFast = mock(() => false);

			const result = broadcast.emitFast('fast_event', 'data');
			expect(result).toBe(false);
		});
	});

	describe('Batch Operations', () => {
		test('should emit batch operations', () => {
			const operations = [
				{ event: 'event1', data: 'data1' },
				{ event: 'event2', data: 'data2', binary: true },
				{ event: 'event3', rooms: 'room1' },
			];

			const result = broadcast.emitBatch(operations);
			expect(typeof result).toBe('number');
			expect(result).toBeGreaterThan(0);
		});

		test('should handle empty batch', () => {
			const result = broadcast.emitBatch([]);
			expect(result).toBe(0);
		});

		test('should handle batch with room targeting', () => {
			const operations = [
				{ event: 'event1', data: 'data1', rooms: 'room1' },
				{ event: 'event2', data: 'data2', rooms: ['room1', 'room2'] },
			];

			const result = broadcast.emitBatch(operations);
			expect(result).toBeGreaterThanOrEqual(0);
		});
	});

	describe('Message Aliases', () => {
		test('should send message', () => {
			const emitSpy = spyOn(broadcast, 'emit');
			broadcast.send('hello world');
			expect(emitSpy).toHaveBeenCalledWith('message', 'hello world');
		});

		test('should write message', () => {
			const sendSpy = spyOn(broadcast, 'send');
			broadcast.write('hello world');
			expect(sendSpy).toHaveBeenCalledWith('hello world');
		});
	});

	describe('Socket Management', () => {
		test('should make sockets join room', () => {
			broadcast.socketsJoin('new_room');

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const socket2 = mockAdapter.nsp.sockets.get('socket2');
			const socket3 = mockAdapter.nsp.sockets.get('socket3');

			expect(socket1.join).toHaveBeenCalledWith(['new_room']);
			expect(socket2.join).toHaveBeenCalledWith(['new_room']);
			expect(socket3.join).toHaveBeenCalledWith(['new_room']);
		});

		test('should make sockets join multiple rooms', () => {
			broadcast.socketsJoin(['room1', 'room2']);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			expect(socket1.join).toHaveBeenCalledWith(['room1', 'room2']);
		});

		test('should make sockets leave room', () => {
			broadcast.socketsLeave('old_room');

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const socket2 = mockAdapter.nsp.sockets.get('socket2');
			const socket3 = mockAdapter.nsp.sockets.get('socket3');

			expect(socket1.leave).toHaveBeenCalledWith('old_room');
			expect(socket2.leave).toHaveBeenCalledWith('old_room');
			expect(socket3.leave).toHaveBeenCalledWith('old_room');
		});

		test('should disconnect all sockets', () => {
			broadcast.disconnectSockets(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const socket2 = mockAdapter.nsp.sockets.get('socket2');
			const socket3 = mockAdapter.nsp.sockets.get('socket3');

			expect(socket1.disconnect).toHaveBeenCalledWith(true);
			expect(socket2.disconnect).toHaveBeenCalledWith(true);
			expect(socket3.disconnect).toHaveBeenCalledWith(true);
		});
	});

	describe('Socket Fetching', () => {
		test('should fetch all sockets', async () => {
			const sockets = await broadcast.fetchSockets();
			expect(sockets).toHaveLength(3);

			expect(sockets[0]).toHaveProperty('id');
			expect(sockets[0]).toHaveProperty('emit');
			expect(sockets[0]).toHaveProperty('join');
			expect(sockets[0]).toHaveProperty('disconnect');
		});

		test('should fetch sockets from specific room', async () => {
			const sockets = await broadcast.to('room1').fetchSockets();
			expect(sockets).toHaveLength(2); // room1 has socket1 and socket2
		});
	});

	describe('Data Sanitization', () => {
		test('should sanitize circular references', () => {
			const circular: any = { name: 'test' };
			circular.self = circular;

			const result = broadcast.emit('test_event', circular);
			expect(result).toBe(true);

			// Should not throw and should handle circular reference
			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const callArgs = socket1.emit.mock.calls[0];
			expect(JSON.stringify(callArgs[1])).toContain('[Circular]');
		});

		test('should remove functions from data', () => {
			const dataWithFunction = {
				name: 'test',
				fn: () => 'function',
				value: 42,
			};

			const result = broadcast.emit('test_event', dataWithFunction);
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const callArgs = socket1.emit.mock.calls[0];
			expect(callArgs[1]).not.toHaveProperty('fn');
			expect(callArgs[1]).toHaveProperty('name');
			expect(callArgs[1]).toHaveProperty('value');
		});

		test('should handle null and undefined data', () => {
			expect(() => broadcast.emit('null_event', null)).not.toThrow();
			expect(() => broadcast.emit('undefined_event', undefined)).not.toThrow();
		});

		test('should handle nested objects', () => {
			const nested = {
				level1: {
					level2: {
						level3: 'deep value',
						fn: () => 'function',
					},
				},
			};

			const result = broadcast.emit('nested_event', nested);
			expect(result).toBe(true);

			const socket1 = mockAdapter.nsp.sockets.get('socket1');
			const callArgs = socket1.emit.mock.calls[0];
			expect(callArgs[1].level1.level2.level3).toBe('deep value');
			expect(callArgs[1].level1.level2).not.toHaveProperty('fn');
		});
	});
});
