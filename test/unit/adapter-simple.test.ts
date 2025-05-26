/**
 * Simplified Adapter tests - core room management
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Adapter } from '../../socket/adapter';

// Mock namespace
class MockNamespace {
	name = '/test';
	sockets = new Map();
	server = {
		publish: () => true,
	};
}

describe('Adapter - Core Functionality', () => {
	let adapter: Adapter;
	let mockNamespace: MockNamespace;

	beforeEach(() => {
		mockNamespace = new MockNamespace();
		adapter = new Adapter(mockNamespace as any);
	});

	describe('Room Management', () => {
		test('should add socket to room', () => {
			adapter.addSocket('socket1', 'room1');

			expect(adapter.getRoomMembers('room1').has('socket1')).toBe(true);
			expect(adapter.getSocketRooms('socket1').has('room1')).toBe(true);
			expect(adapter.hasRoom('room1')).toBe(true);
		});

		test('should remove socket from room', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.removeSocket('socket1', 'room1');

			expect(adapter.getRoomMembers('room1').size).toBe(0);
			expect(adapter.getSocketRooms('socket1').size).toBe(0);
			expect(adapter.hasRoom('room1')).toBe(false);
		});

		test('should handle multiple sockets in room', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room1');
			adapter.addSocket('socket3', 'room1');

			expect(adapter.getRoomSize('room1')).toBe(3);
			expect(adapter.getRoomMembers('room1').size).toBe(3);
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
	});

	describe('Socket Queries', () => {
		beforeEach(() => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket1', 'room2');
			adapter.addSocket('socket2', 'room1');
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

		test('should get room statistics', () => {
			expect(adapter.getRoomSize('room1')).toBe(2);
			expect(adapter.getRoomSize('room2')).toBe(2);
			expect(adapter.getRoomSize('nonexistent')).toBe(0);
		});

		test('should get all rooms', () => {
			const allRooms = adapter.getRooms();
			expect(allRooms.size).toBe(2);
			expect(allRooms.has('room1')).toBe(true);
			expect(allRooms.has('room2')).toBe(true);
		});
	});

	describe('Debug Information', () => {
		test('should provide debug info', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room2');

			const debugInfo = adapter.getDebugInfo();
			expect(debugInfo.roomsCount).toBe(2);
			expect(debugInfo.socketsCount).toBe(2);
			expect(debugInfo.rooms).toContain('room1');
			expect(debugInfo.rooms).toContain('room2');
			expect(debugInfo.sockets).toContain('socket1');
			expect(debugInfo.sockets).toContain('socket2');
		});
	});

	describe('Cleanup', () => {
		test('should close and clean up', () => {
			adapter.addSocket('socket1', 'room1');
			adapter.addSocket('socket2', 'room2');

			adapter.close();

			expect(adapter.getRooms().size).toBe(0);
			expect(adapter.getAllSockets().size).toBe(0);
		});
	});

	describe('Edge Cases', () => {
		test('should handle removing non-existent socket', () => {
			expect(() => adapter.removeSocket('nonexistent', 'room1')).not.toThrow();
		});

		test('should handle removing socket from non-existent room', () => {
			expect(() => adapter.removeSocket('socket1', 'nonexistent')).not.toThrow();
		});

		test('should handle queries for non-existent data', () => {
			expect(adapter.getSocketRooms('nonexistent').size).toBe(0);
			expect(adapter.getRoomMembers('nonexistent').size).toBe(0);
			expect(adapter.getRoomSize('nonexistent')).toBe(0);
			expect(adapter.hasRoom('nonexistent')).toBe(false);
		});
	});
});
