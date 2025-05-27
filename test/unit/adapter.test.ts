/**
 * Unit tests for Adapter class
 */

import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Adapter } from '../../src/adapter';

// Mock namespace
class MockNamespace {
	name = '/test';
	sockets = new Map();
	server = {
		publish: mock(() => true),
	};
}

// Mock socket
class MockSocket {
	id: string;
	connected = true;
	ws = {
		readyState: 1,
		send: mock(() => true),
	};

	constructor(id: string) {
		this.id = id;
	}
}

describe('Adapter', () => {
	let adapter: Adapter;
	let mockNamespace: MockNamespace;

	beforeEach(() => {
		mockNamespace = new MockNamespace();
		adapter = new Adapter(mockNamespace as any);
	});

	describe('Room Management', () => {
		test('should add socket to room', () => {
			adapter.addSocket('socket1', 'room1');

			const roomSockets = adapter.getRoomMembers('room1');
			expect(roomSockets.has('socket1')).toBe(true);

			const socketRooms = adapter.getSocketRooms('socket1');
			expect(socketRooms.has('room1')).toBe(true);
		});

		test('should not add socket to same room twice', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket1', 'room1');

			const roomSockets = adapter.getRoomMembers('room1');
			expect(roomSockets.size).toBe(1);
		});

		test('should remove socket from room', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.removeSocket('socket1', 'room1');

			const roomSockets = adapter.getRoomMembers('room1');
			expect(roomSockets.has('socket1')).toBe(false);

			const socketRooms = adapter.getSocketRooms('socket1');
			expect(socketRooms.has('room1')).toBe(false);
		});

		test('should delete room when empty', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.removeSocket('socket1', 'room1');

			expect(adapter.hasRoom('room1')).toBe(false);
		});

		test('should remove socket from all rooms', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket1', 'room2');
			adapter.addSocket('socket1', 'room3');

			adapter.removeSocketFromAllRooms('socket1');

			expect(adapter.getSocketRooms('socket1').size).toBe(0);
			expect(adapter.hasRoom('room1')).toBe(false);
			expect(adapter.hasRoom('room2')).toBe(false);
			expect(adapter.hasRoom('room3')).toBe(false);
		});

		test('should handle multiple sockets in same room', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room1');
			adapter.addSocket('socket3', 'room1');

			const roomSockets = adapter.getRoomMembers('room1');
			expect(roomSockets.size).toBe(3);
			expect(roomSockets.has('socket1')).toBe(true);
			expect(roomSockets.has('socket2')).toBe(true);
			expect(roomSockets.has('socket3')).toBe(true);
		});

		test('should handle socket in multiple rooms', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket1', 'room2');
			adapter.addSocket('socket1', 'room3');

			const socketRooms = adapter.getSocketRooms('socket1');
			expect(socketRooms.size).toBe(3);
			expect(socketRooms.has('room1')).toBe(true);
			expect(socketRooms.has('room2')).toBe(true);
			expect(socketRooms.has('room3')).toBe(true);
		});
	});

	describe('Socket Queries', () => {
		beforeEach(() => {
			// Setup test data
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket1', 'room2');
			adapter.addSocket('socket2', 'room1');
			adapter.addSocket('socket2', 'room3');
			adapter.addSocket('socket3', 'room2');
		});

		test('should get all sockets', () => {
			const allSockets = adapter.getSockets();
			expect(allSockets.size).toBe(3);
			expect(allSockets.has('socket1')).toBe(true);
			expect(allSockets.has('socket2')).toBe(true);
			expect(allSockets.has('socket3')).toBe(true);
		});

		test('should get sockets in specific room', () => {
			const room1Sockets = adapter.getSockets(new Set(['room1']));
			expect(room1Sockets.size).toBe(2);
			expect(room1Sockets.has('socket1')).toBe(true);
			expect(room1Sockets.has('socket2')).toBe(true);
		});

		test('should get sockets in multiple rooms', () => {
			const multiRoomSockets = adapter.getSockets(new Set(['room1', 'room2']));
			expect(multiRoomSockets.size).toBe(3); // All sockets are in at least one of these rooms
		});

		test('should get sockets in non-existent room', () => {
			const noSockets = adapter.getSockets(new Set(['nonexistent']));
			expect(noSockets.size).toBe(0);
		});

		test('should get room size', () => {
			expect(adapter.getRoomSize('room1')).toBe(2);
			expect(adapter.getRoomSize('room2')).toBe(2);
			expect(adapter.getRoomSize('room3')).toBe(1);
			expect(adapter.getRoomSize('nonexistent')).toBe(0);
		});

		test('should get all rooms', () => {
			const allRooms = adapter.getRooms();
			expect(allRooms.size).toBe(3);
			expect(allRooms.has('room1')).toBe(true);
			expect(allRooms.has('room2')).toBe(true);
			expect(allRooms.has('room3')).toBe(true);
		});

		test('should check room existence', () => {
			expect(adapter.hasRoom('room1')).toBe(true);
			expect(adapter.hasRoom('room2')).toBe(true);
			expect(adapter.hasRoom('room3')).toBe(true);
			expect(adapter.hasRoom('nonexistent')).toBe(false);
		});

		test('should get all sockets count', () => {
			const allSockets = adapter.getAllSockets();
			expect(allSockets.size).toBe(3);
		});
	});

	describe('Broadcasting', () => {
		beforeEach(() => {
			// Setup test data with mock sockets
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room1');
			adapter.addSocket('socket3', 'room2');

			// Add mock sockets to namespace
			mockNamespace.sockets.set('socket1', new MockSocket('socket1'));
			mockNamespace.sockets.set('socket2', new MockSocket('socket2'));
			mockNamespace.sockets.set('socket3', new MockSocket('socket3'));
		});

		test('should broadcast to all sockets', () => {
			const packet = new Uint8Array([1, 2, 3]);
			adapter.broadcast(packet);

			// Check that all sockets received the packet
			const socket1 = mockNamespace.sockets.get('socket1');
			const socket2 = mockNamespace.sockets.get('socket2');
			const socket3 = mockNamespace.sockets.get('socket3');

			expect(socket1.ws.send).toHaveBeenCalledWith(packet);
			expect(socket2.ws.send).toHaveBeenCalledWith(packet);
			expect(socket3.ws.send).toHaveBeenCalledWith(packet);
		});

		test('should broadcast to specific rooms', () => {
			const packet = new Uint8Array([1, 2, 3]);
			adapter.broadcast(packet, { rooms: new Set(['room1']) });

			const socket1 = mockNamespace.sockets.get('socket1');
			const socket2 = mockNamespace.sockets.get('socket2');
			const socket3 = mockNamespace.sockets.get('socket3');

			expect(socket1.ws.send).toHaveBeenCalledWith(packet);
			expect(socket2.ws.send).toHaveBeenCalledWith(packet);
			expect(socket3.ws.send).not.toHaveBeenCalled();
		});

		test('should broadcast excluding specific sockets', () => {
			const packet = new Uint8Array([1, 2, 3]);
			adapter.broadcast(packet, { except: new Set(['socket1']) });

			const socket1 = mockNamespace.sockets.get('socket1');
			const socket2 = mockNamespace.sockets.get('socket2');
			const socket3 = mockNamespace.sockets.get('socket3');

			expect(socket1.ws.send).not.toHaveBeenCalled();
			expect(socket2.ws.send).toHaveBeenCalledWith(packet);
			expect(socket3.ws.send).toHaveBeenCalledWith(packet);
		});

		test('should broadcast to rooms excluding sockets', () => {
			const packet = new Uint8Array([1, 2, 3]);
			adapter.broadcast(packet, {
				rooms: new Set(['room1']),
				except: new Set(['socket1']),
			});

			const socket1 = mockNamespace.sockets.get('socket1');
			const socket2 = mockNamespace.sockets.get('socket2');
			const socket3 = mockNamespace.sockets.get('socket3');

			expect(socket1.ws.send).not.toHaveBeenCalled();
			expect(socket2.ws.send).toHaveBeenCalledWith(packet);
			expect(socket3.ws.send).not.toHaveBeenCalled();
		});

		test('should handle disconnected sockets during broadcast', () => {
			const packet = new Uint8Array([1, 2, 3]);

			// Make socket1 disconnected
			const socket1 = mockNamespace.sockets.get('socket1');
			socket1.connected = false;
			socket1.ws.readyState = 3; // CLOSED

			adapter.broadcast(packet);

			// socket1 should be cleaned up and not receive packet
			expect(socket1.ws.send).not.toHaveBeenCalled();
		});

		test('should handle WebSocket send errors', () => {
			const packet = new Uint8Array([1, 2, 3]);

			// Make socket1 throw error on send
			const socket1 = mockNamespace.sockets.get('socket1');
			socket1.ws.send = mock(() => {
				throw new Error('Send failed');
			});

			// Should not throw, just handle the error gracefully
			expect(() => adapter.broadcast(packet)).not.toThrow();
		});

		test('should use Bun publish when server is available', () => {
			const packet = new Uint8Array([1, 2, 3]);
			adapter.broadcast(packet);

			expect(mockNamespace.server.publish).toHaveBeenCalled();
		});
	});

	describe('Event Emission', () => {
		test('should emit room events', () => {
			const createRoomSpy = spyOn(adapter, 'emit');
			const joinRoomSpy = spyOn(adapter, 'emit');
			const leaveRoomSpy = spyOn(adapter, 'emit');
			const deleteRoomSpy = spyOn(adapter, 'emit');

			adapter.addSocket('socket1', 'room1');
			expect(createRoomSpy).toHaveBeenCalledWith('create-room', 'room1');
			expect(joinRoomSpy).toHaveBeenCalledWith('join-room', 'room1', 'socket1');

			adapter.removeSocket('socket1', 'room1');
			expect(leaveRoomSpy).toHaveBeenCalledWith('leave-room', 'room1', 'socket1');
			expect(deleteRoomSpy).toHaveBeenCalledWith('delete-room', 'room1');
		});

		test('should not emit create-room for existing room', () => {
			const createRoomSpy = spyOn(adapter, 'emit');

			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room1');

			expect(createRoomSpy).toHaveBeenCalledTimes(1);
		});

		test('should not emit delete-room if room still has sockets', () => {
			const deleteRoomSpy = spyOn(adapter, 'emit');

			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room1');
			adapter.removeSocket('socket1', 'room1');

			expect(deleteRoomSpy).not.toHaveBeenCalled();
		});
	});

	describe('Cleanup', () => {
		test('should close and clean up', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room2');

			expect(adapter.getRooms().size).toBe(2);
			expect(adapter.getAllSockets().size).toBe(2);

			adapter.close();

			expect(adapter.getRooms().size).toBe(0);
			expect(adapter.getAllSockets().size).toBe(0);
		});

		test('should remove all listeners on close', () => {
			const removeAllListenersSpy = spyOn(adapter, 'removeAllListeners');
			adapter.close();
			expect(removeAllListenersSpy).toHaveBeenCalled();
		});
	});

	describe('Debug Information', () => {
		test('should provide debug info', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket1', 'room2');
			adapter.addSocket('socket2', 'room1');

			const debugInfo = adapter.getDebugInfo();

			expect(debugInfo.roomsCount).toBe(2);
			expect(debugInfo.socketsCount).toBe(2);
			expect(debugInfo.rooms).toEqual(['room1', 'room2']);
			expect(debugInfo.sockets).toEqual(['socket1', 'socket2']);
		});

		test('should show empty debug info when no data', () => {
			const debugInfo = adapter.getDebugInfo();

			expect(debugInfo.roomsCount).toBe(0);
			expect(debugInfo.socketsCount).toBe(0);
			expect(debugInfo.rooms).toEqual([]);
			expect(debugInfo.sockets).toEqual([]);
		});
	});

	describe('Edge Cases', () => {
		test('should handle removing socket from non-existent room', () => {
			expect(() => adapter.removeSocket('socket1', 'nonexistent')).not.toThrow();
		});

		test('should handle removing non-existent socket from room', () => {
			adapter.addSocket('socket1', 'room1');
			expect(() => adapter.removeSocket('socket2', 'room1')).not.toThrow();
		});

		test('should handle getting rooms for non-existent socket', () => {
			const rooms = adapter.getSocketRooms('nonexistent');
			expect(rooms.size).toBe(0);
		});

		test('should handle getting members of non-existent room', () => {
			const members = adapter.getRoomMembers('nonexistent');
			expect(members.size).toBe(0);
		});

		test('should handle broadcast with empty rooms set', () => {
			const packet = new Uint8Array([1, 2, 3]);
			expect(() => adapter.broadcast(packet, { rooms: new Set() })).not.toThrow();
		});

		test('should handle broadcast with empty except set', () => {
			const packet = new Uint8Array([1, 2, 3]);
			expect(() => adapter.broadcast(packet, { except: new Set() })).not.toThrow();
		});
	});

	describe('Performance', () => {
		test('should handle large number of rooms efficiently', () => {
			const startTime = Date.now();

			// Add socket to 1000 rooms
			for (let i = 0; i < 1000; i++) {
				adapter.addSocket('socket1', `room${i}`);
			}

			const addTime = Date.now() - startTime;
			expect(addTime).toBeLessThan(100); // Should complete in <100ms

			expect(adapter.getSocketRooms('socket1').size).toBe(1000);
			expect(adapter.getRooms().size).toBe(1000);
		});

		test('should handle large number of sockets efficiently', () => {
			const startTime = Date.now();

			// Add 1000 sockets to same room
			for (let i = 0; i < 1000; i++) {
				adapter.addSocket(`socket${i}`, 'room1');
			}

			const addTime = Date.now() - startTime;
			expect(addTime).toBeLessThan(100); // Should complete in <100ms

			expect(adapter.getRoomMembers('room1').size).toBe(1000);
			expect(adapter.getAllSockets().size).toBe(1000);
		});

		test('should handle removal efficiently', () => {
			// Setup: Add many sockets to many rooms
			for (let i = 0; i < 100; i++) {
				for (let j = 0; j < 10; j++) {
					adapter.addSocket(`socket${i}`, `room${j}`);
				}
			}

			const startTime = Date.now();

			// Remove all sockets
			for (let i = 0; i < 100; i++) {
				adapter.removeSocketFromAllRooms(`socket${i}`);
			}

			const removeTime = Date.now() - startTime;
			expect(removeTime).toBeLessThan(100); // Should complete in <100ms

			expect(adapter.getAllSockets().size).toBe(0);
			expect(adapter.getRooms().size).toBe(0);
		});
	});
});
