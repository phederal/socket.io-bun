/**
 * Unit tests for Socket class
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Socket } from '../../socket/socket';
import type { Handshake } from '../../shared/types/socket.types';

// Mock WebSocket
class MockWebSocket {
	readyState = 1; // OPEN
	sendCalls: any[] = [];
	subscriptions: Set<string> = new Set();

	send(data: any) {
		this.sendCalls.push(data);
		return 1; // Success
	}

	subscribe(topic: string) {
		this.subscriptions.add(topic);
	}

	unsubscribe(topic: string) {
		this.subscriptions.delete(topic);
	}

	close() {
		this.readyState = 3; // CLOSED
	}
}

// Mock Namespace
class MockNamespace {
	name = '/';
	sockets = new Map();
	adapter = {
		addSocket: mock(() => {}),
		removeSocket: mock(() => {}),
		removeSocketFromAllRooms: mock(() => {}),
	};

	removeSocket = mock(() => {});
}

describe('Socket', () => {
	let mockWs: MockWebSocket;
	let mockNamespace: MockNamespace;
	let socket: Socket;
	let handshake: Handshake;

	beforeEach(() => {
		mockWs = new MockWebSocket();
		mockNamespace = new MockNamespace();
		handshake = {
			headers: {},
			time: new Date().toISOString(),
			address: '127.0.0.1',
			xdomain: false,
			secure: true,
			issued: Date.now(),
			url: '/',
			query: {},
			auth: {},
		};

		socket = new Socket('test-socket-id', mockWs as any, mockNamespace as any, handshake);
	});

	afterEach(() => {
		if (socket.connected) {
			socket.disconnect(true);
		}
	});

	describe('Initialization', () => {
		test('should initialize with correct properties', () => {
			expect(socket.id).toBe('test-socket-id');
			expect(socket.connected).toBe(true);
			expect(socket.handshake).toBe(handshake);
			expect(socket.rooms.has('test-socket-id')).toBe(true);
			expect(socket.nsp).toBe('/');
		});

		test('should have session ID', () => {
			expect(socket.sessionId).toMatch(/^sess_\d+_[a-z0-9]+$/);
		});
	});

	describe('Basic Events', () => {
		test('should emit simple event without data', () => {
			const result = socket.emit('ping');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('42["ping"]');
		});

		test('should emit event with string data', () => {
			const result = socket.emit('message', 'hello world');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('42["message","hello world"]');
		});

		test('should emit event with object data', () => {
			const data = { user: 'john', text: 'hello' };
			const result = socket.emit('chat_message', data);
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('42["chat_message",{"user":"john","text":"hello"}]');
		});

		test('should handle emit when disconnected', () => {
			socket.disconnect();
			const result = socket.emit('ping');
			expect(result).toBe(false);
			expect(mockWs.sendCalls).toHaveLength(1); // Only disconnect packet
		});
	});

	describe('Acknowledgments', () => {
		test('should emit event with ACK callback', (done) => {
			let ackId: string;

			socket.emit('get_user_info', (response: any) => {
				expect(response).toEqual({ id: 'test-socket-id', name: 'test user' });
				done();
			});

			expect(mockWs.sendCalls).toHaveLength(1);
			const packet = mockWs.sendCalls[0];
			expect(packet).toMatch(/^42\d+\["get_user_info"\]$/);

			// Extract ACK ID from packet
			const match = packet.match(/^42(\d+)/);
			ackId = match[1];

			// Simulate ACK response
			socket._handleAck(ackId, { id: 'test-socket-id', name: 'test user' });
		});

		test('should emit event with data and ACK callback', (done) => {
			const requestData = { operation: 'add', a: 5, b: 3 };

			socket.emit('calculate', requestData, (response: any) => {
				expect(response).toEqual({ result: 8 });
				done();
			});

			expect(mockWs.sendCalls).toHaveLength(1);
			const packet = mockWs.sendCalls[0];
			expect(packet).toMatch(/^42\d+\["calculate",{"operation":"add","a":5,"b":3}\]$/);

			// Extract ACK ID and simulate response
			const match = packet.match(/^42(\d+)/);
			const ackId = match[1];
			socket._handleAck(ackId, { result: 8 });
		});

		test('should handle ACK timeout', (done) => {
			// Speed up test by mocking setTimeout
			const originalSetTimeout = global.setTimeout;
			global.setTimeout = ((callback: any) => {
				callback();
				return 1 as any;
			}) as any;

			socket.emitWithAck(
				'slow_operation',
				{},
				(err: any) => {
					expect(err).toBeInstanceOf(Error);
					expect(err.message).toContain('timeout');
					global.setTimeout = originalSetTimeout;
					done();
				},
				{ timeout: 1 }
			);
		});
	});

	describe('Binary Protocol', () => {
		test('should emit binary event', () => {
			const result = socket.emitBinary('ping');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);

			const packet = mockWs.sendCalls[0];
			expect(packet).toBeInstanceOf(Uint8Array);
		});

		test('should emit binary event with data', () => {
			const result = socket.emitBinary('message', 'binary hello');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);

			const packet = mockWs.sendCalls[0];
			expect(packet).toBeInstanceOf(Uint8Array);
		});

		test('should fallback to regular emit for unsupported events', () => {
			const result = socket.emitBinary('unsupported_event' as any, 'data');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(typeof mockWs.sendCalls[0]).toBe('string');
		});
	});

	describe('Fast Emit', () => {
		test('should emit fast event without data', () => {
			const result = socket.emitFast('ping');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('42["ping"]');
		});

		test('should emit fast event with string data', () => {
			const result = socket.emitFast('message', 'fast hello');
			expect(result).toBe(true);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('42["message","fast hello"]');
		});
	});

	describe('Batch Operations', () => {
		test('should emit batch of events', () => {
			const events = [
				{ event: 'ping' },
				{ event: 'message', data: 'hello' },
				{ event: 'notification', data: 'alert', binary: true },
			];

			const result = socket.emitBatch(events);
			expect(result).toBe(3);
			expect(mockWs.sendCalls).toHaveLength(3);
		});

		test('should handle empty batch', () => {
			const result = socket.emitBatch([]);
			expect(result).toBe(0);
			expect(mockWs.sendCalls).toHaveLength(0);
		});

		test('should handle partial batch failure', () => {
			// Mock WebSocket to fail on second send
			let callCount = 0;
			mockWs.send = () => {
				callCount++;
				return callCount === 2 ? 0 : 1; // Fail on second call
			};

			const events = [
				{ event: 'ping' },
				{ event: 'message', data: 'hello' },
				{ event: 'pong' },
			];

			const result = socket.emitBatch(events);
			expect(result).toBe(2); // Only 2 successful
		});
	});

	describe('Room Management', () => {
		test('should join single room', () => {
			socket.join('room1');
			expect(socket.rooms.has('room1')).toBe(true);
			expect(mockNamespace.adapter.addSocket).toHaveBeenCalledWith('test-socket-id', 'room1');
			expect(mockWs.subscriptions.has('room:/:room1')).toBe(true);
		});

		test('should join multiple rooms', () => {
			socket.join(['room1', 'room2', 'room3']);
			expect(socket.rooms.has('room1')).toBe(true);
			expect(socket.rooms.has('room2')).toBe(true);
			expect(socket.rooms.has('room3')).toBe(true);
			expect(mockNamespace.adapter.addSocket).toHaveBeenCalledTimes(3);
		});

		test('should not join same room twice', () => {
			socket.join('room1');
			socket.join('room1');
			expect(mockNamespace.adapter.addSocket).toHaveBeenCalledTimes(1);
		});

		test('should leave room', () => {
			socket.join('room1');
			socket.leave('room1');
			expect(socket.rooms.has('room1')).toBe(false);
			expect(mockNamespace.adapter.removeSocket).toHaveBeenCalledWith(
				'test-socket-id',
				'room1'
			);
			expect(mockWs.subscriptions.has('room:/:room1')).toBe(false);
		});

		test('should not leave own room (socket ID)', () => {
			socket.leave('test-socket-id');
			expect(socket.rooms.has('test-socket-id')).toBe(true);
		});

		test('should leave all rooms except own', () => {
			socket.join(['room1', 'room2', 'room3']);
			socket.leaveAll();
			expect(socket.rooms.size).toBe(1);
			expect(socket.rooms.has('test-socket-id')).toBe(true);
		});
	});

	describe('Packet Handling', () => {
		test('should handle incoming event packet', () => {
			const eventSpy = spyOn(socket, 'emit');

			socket._handlePacket({
				event: 'message',
				data: 'hello from client',
				namespace: '/',
			});

			expect(eventSpy).toHaveBeenCalledWith('message', 'hello from client');
		});

		test('should handle ACK request packet', () => {
			// Add event listener
			socket.on('get_info', (callback) => {
				callback({ info: 'test data' });
			});

			socket._handlePacket({
				event: 'get_info',
				ackId: '123',
				namespace: '/',
			});

			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('43123[{"info":"test data"}]');
		});

		test('should handle ACK request with data', () => {
			socket.on('calculate', (data, callback) => {
				const result = data.a + data.b;
				callback({ result });
			});

			socket._handlePacket({
				event: 'calculate',
				data: { a: 5, b: 3 },
				ackId: '456',
				namespace: '/',
			});

			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('43456[{"result":8}]');
		});

		test('should handle ping packet', () => {
			socket._handlePacket({ event: 'ping' });
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('3'); // Pong response
		});

		test('should ignore pong packet', () => {
			socket._handlePacket({ event: 'pong' });
			expect(mockWs.sendCalls).toHaveLength(0);
		});

		test('should handle disconnect packet', () => {
			const closeSpy = spyOn(socket, '_handleClose');
			socket._handlePacket({ event: '__disconnect' });
			expect(closeSpy).toHaveBeenCalledWith('client namespace disconnect');
		});
	});

	describe('Connection Management', () => {
		test('should disconnect gracefully', () => {
			socket.disconnect();
			expect(socket.connected).toBe(false);
			expect(mockWs.sendCalls).toHaveLength(1);
			expect(mockWs.sendCalls[0]).toBe('41'); // Disconnect packet
			expect(mockNamespace.removeSocket).toHaveBeenCalledWith(socket);
		});

		test('should disconnect and close WebSocket', () => {
			socket.disconnect(true);
			expect(socket.connected).toBe(false);
			expect(mockWs.readyState).toBe(3); // CLOSED
		});

		test('should handle close event', () => {
			const disconnectSpy = spyOn(socket, 'emit');
			socket._handleClose('transport close');
			expect(socket.connected).toBe(false);
			expect(disconnectSpy).toHaveBeenCalledWith('disconnect', 'transport close');
		});

		test('should handle error event', () => {
			const errorSpy = spyOn(socket, 'emit');
			const error = new Error('WebSocket error');
			socket._handleError(error);
			expect(errorSpy).toHaveBeenCalledWith('error', error);
		});
	});

	describe('Rate Limiting', () => {
		test('should allow normal message rate', () => {
			// Send 10 messages (within limit)
			for (let i = 0; i < 10; i++) {
				const result = socket.emit('ping');
				expect(result).toBe(true);
			}
			expect(mockWs.sendCalls).toHaveLength(10);
		});

		test('should be disabled in production', () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';

			// Send many messages
			for (let i = 0; i < 1000; i++) {
				const result = socket.emit('ping');
				expect(result).toBe(true);
			}

			process.env.NODE_ENV = originalEnv;
		});
	});

	describe('Statistics', () => {
		test('should provide ACK statistics', () => {
			socket.emit('test', () => {}); // Add pending ACK

			const stats = socket.getAckStats();
			expect(stats.total).toBe(1);
			expect(stats.oldestAge).toBeGreaterThan(0);
			expect(stats.batchQueueSize).toBe(0);
		});

		test('should show empty stats when no pending ACKs', () => {
			const stats = socket.getAckStats();
			expect(stats.total).toBe(0);
			expect(stats.oldestAge).toBe(0);
			expect(stats.batchQueueSize).toBe(0);
		});
	});

	describe('Data Sanitization', () => {
		test('should handle circular references', () => {
			const circular: any = { name: 'test' };
			circular.self = circular;

			const result = socket.emit('circular_test', circular);
			expect(result).toBe(true);
			expect(mockWs.sendCalls[0]).toContain('[Circular]');
		});

		test('should remove functions from data', () => {
			const dataWithFunction = {
				name: 'test',
				fn: () => 'function',
				nested: {
					fn2: () => 'nested function',
					value: 42,
				},
			};

			const result = socket.emit('function_test', dataWithFunction);
			expect(result).toBe(true);
			expect(mockWs.sendCalls[0]).not.toContain('function');
		});
	});
});
