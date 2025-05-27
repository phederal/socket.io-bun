/**
 * Unit tests for Namespace class
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Namespace } from '../../socket/namespace';
import { Socket } from '../../socket/socket';
import type { Handshake } from '../../types/socket.types';

// Mock dependencies
class MockAdapter {
	getSockets = mock(() => new Set(['socket1', 'socket2']));
	addSocket = mock(() => {});
	removeSocket = mock(() => {});
	removeSocketFromAllRooms = mock(() => {});
	broadcast = mock(() => {});
	close = mock(() => {});
}

class MockServer {
	publish = mock(() => true);
}

class MockWebSocket {
	readyState = 1;
	remoteAddress = '127.0.0.1';
	sendCalls: any[] = [];
	subscriptions: Set<string> = new Set();

	send(data: any) {
		this.sendCalls.push(data);
		return 1;
	}

	subscribe(topic: string) {
		this.subscriptions.add(topic);
	}

	unsubscribe(topic: string) {
		this.subscriptions.delete(topic);
	}

	close() {
		this.readyState = 3;
	}
}

describe('Namespace', () => {
	let namespace: Namespace;
	let mockServer: MockServer;
	let mockAdapter: MockAdapter;

	beforeEach(() => {
		mockServer = new MockServer();
		namespace = new Namespace(mockServer, '/test');

		// Replace adapter with mock
		mockAdapter = new MockAdapter();
		(namespace as any).adapter = mockAdapter;
	});

	afterEach(() => {
		namespace.disconnectSockets(true);
	});

	describe('Initialization', () => {
		test('should initialize with correct properties', () => {
			expect(namespace.name).toBe('/test');
			expect(namespace.server).toBe(mockServer);
			expect(namespace.sockets).toBeInstanceOf(Map);
			expect(namespace.sockets.size).toBe(0);
		});

		test('should normalize namespace names', () => {
			const ns1 = new Namespace(mockServer, 'chat');
			const ns2 = new Namespace(mockServer, '/chat');
			expect(ns1.name).toBe('/chat');
			expect(ns2.name).toBe('/chat');
		});
	});

	describe('Middleware', () => {
		test('should add middleware', () => {
			const middleware = mock(() => {});
			namespace.use(middleware);
			expect((namespace as any).middlewares).toHaveLength(1);
		});

		test('should run middleware on connection', async () => {
			const middleware1 = mock((socket: any, next: any) => next());
			const middleware2 = mock((socket: any, next: any) => next());

			namespace.use(middleware1);
			namespace.use(middleware2);

			const mockWs = new MockWebSocket();
			const user = { id: 'user1' };
			const session = { id: 'session1' };

			await namespace.handleConnection(mockWs as any, user, session);

			expect(middleware1).toHaveBeenCalled();
			expect(middleware2).toHaveBeenCalled();
		});

		test('should handle middleware errors', async () => {
			const middleware = mock((socket: any, next: any) => {
				next(new Error('Middleware error'));
			});

			namespace.use(middleware);

			const mockWs = new MockWebSocket();
			const user = { id: 'user1' };
			const session = { id: 'session1' };

			await expect(namespace.handleConnection(mockWs as any, user, session)).rejects.toThrow(
				'Middleware error'
			);
		});
	});

	describe('Socket Management', () => {
		test('should handle new connection', async () => {
			const mockWs = new MockWebSocket();
			const user = { id: 'user1', name: 'John' };
			const session = { id: 'session1' };

			const socket = await namespace.handleConnection(mockWs as any, user, session);

			expect(socket).toBeInstanceOf(Socket);
			expect(socket.id).toBe('user1');
			expect(namespace.sockets.has('user1')).toBe(true);
			expect(mockAdapter.addSocket).toHaveBeenCalledWith('user1', 'user1');
		});

		test('should remove socket on disconnect', async () => {
			const mockWs = new MockWebSocket();
			const socket = await namespace.handleConnection(
				mockWs as any,
				{ id: 'user1' },
				{ id: 'session1' }
			);

			namespace.removeSocket(socket);

			expect(namespace.sockets.has('user1')).toBe(false);
			expect(mockAdapter.removeSocketFromAllRooms).toHaveBeenCalledWith('user1');
		});

		test('should emit connection event', async () => {
			const connectionSpy = spyOn(namespace, 'emit');
			const mockWs = new MockWebSocket();

			await namespace.handleConnection(mockWs as any, { id: 'user1' }, { id: 'session1' });

			expect(connectionSpy).toHaveBeenCalledWith('connection', expect.any(Socket));
		});
	});

	describe('Broadcasting', () => {
		let socket1: Socket;
		let socket2: Socket;

		beforeEach(async () => {
			const mockWs1 = new MockWebSocket();
			const mockWs2 = new MockWebSocket();

			socket1 = await namespace.handleConnection(
				mockWs1 as any,
				{ id: 'user1' },
				{ id: 'session1' }
			);
			socket2 = await namespace.handleConnection(
				mockWs2 as any,
				{ id: 'user2' },
				{ id: 'session2' }
			);
		});

		test('should emit to all sockets', () => {
			const broadcastSpy = spyOn((namespace as any).adapter, 'broadcast');
			const result = namespace.emit('test_message', 'hello');

			expect(result).toBe(true);
			expect(broadcastSpy).toHaveBeenCalled();
		});

		test('should emit binary to all sockets', () => {
			const broadcastSpy = spyOn((namespace as any).adapter, 'broadcast');
			const result = namespace.emitBinary('ping');

			expect(result).toBe(true);
			expect(broadcastSpy).toHaveBeenCalled();
		});

		test('should emit fast to all sockets', () => {
			const broadcastSpy = spyOn((namespace as any).adapter, 'broadcast');
			const result = namespace.emitFast('notification', 'alert');

			expect(result).toBe(true);
			expect(broadcastSpy).toHaveBeenCalled();
		});

		test('should handle batch operations', () => {
			const operations = [
				{ event: 'message', data: 'hello' },
				{ event: 'ping', binary: true },
				{ event: 'notification', data: 'alert' },
			];

			const result = namespace.emitBatch(operations);
			expect(typeof result).toBe('number');
		});
	});

	describe('Room Operations', () => {
		let socket: Socket;

		beforeEach(async () => {
			const mockWs = new MockWebSocket();
			socket = await namespace.handleConnection(
				mockWs as any,
				{ id: 'user1' },
				{ id: 'session1' }
			);
		});

		test('should target specific room', () => {
			const broadcastOp = namespace.to('room1');
			expect(broadcastOp).toBeDefined();
		});

		test('should target multiple rooms', () => {
			const broadcastOp = namespace.to(['room1', 'room2']);
			expect(broadcastOp).toBeDefined();
		});

		test('should exclude specific room', () => {
			const broadcastOp = namespace.except('room1');
			expect(broadcastOp).toBeDefined();
		});

		test('should make all sockets join room', () => {
			const broadcastSpy = spyOn((namespace as any).adapter, 'getSockets').mockReturnValue(
				new Set(['user1'])
			);

			namespace.socketsJoin('room1');
			expect(broadcastSpy).toHaveBeenCalled();
		});

		test('should make all sockets leave room', () => {
			const broadcastSpy = spyOn((namespace as any).adapter, 'getSockets').mockReturnValue(
				new Set(['user1'])
			);

			namespace.socketsLeave('room1');
			expect(broadcastSpy).toHaveBeenCalled();
		});
	});

	describe('Acknowledgments', () => {
		let socket1: Socket;
		let socket2: Socket;

		beforeEach(async () => {
			const mockWs1 = new MockWebSocket();
			const mockWs2 = new MockWebSocket();

			socket1 = await namespace.handleConnection(
				mockWs1 as any,
				{ id: 'user1' },
				{ id: 'session1' }
			);
			socket2 = await namespace.handleConnection(
				mockWs2 as any,
				{ id: 'user2' },
				{ id: 'session2' }
			);
		});

		test('should handle namespace-wide ACK', (done) => {
			// Mock adapter to return test sockets
			mockAdapter.getSockets = mock(() => new Set(['user1', 'user2']));

			namespace.emitWithAck('get_status', {}, (err: any, responses: any[]) => {
				expect(err).toBeNull();
				expect(responses).toBeInstanceOf(Array);
				expect(responses).toHaveLength(2);
				done();
			});

			// Simulate responses from both sockets
			setTimeout(() => {
				socket1._handleAck(expect.any(String), 'socket1 response');
				socket2._handleAck(expect.any(String), 'socket2 response');
			}, 10);
		});

		test('should handle ACK timeout', (done) => {
			// Speed up test
			const originalSetTimeout = global.setTimeout;
			global.setTimeout = ((callback: any) => {
				callback();
				return 1 as any;
			}) as any;

			namespace.emitWithAck(
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

	describe('Flags and Modifiers', () => {
		test('should support volatile flag', () => {
			const broadcastOp = namespace.volatile;
			expect(broadcastOp).toBeDefined();
		});

		test('should support compress flag', () => {
			const broadcastOp = namespace.compress(true);
			expect(broadcastOp).toBeDefined();
		});

		test('should support local flag', () => {
			const broadcastOp = namespace.local;
			expect(broadcastOp).toBeDefined();
		});

		test('should support binary flag', () => {
			const broadcastOp = namespace.binary;
			expect(broadcastOp).toBeDefined();
		});

		test('should support timeout', () => {
			const broadcastOp = namespace.timeout(5000);
			expect(broadcastOp).toBeDefined();
		});
	});

	describe('Socket Fetching', () => {
		test('should fetch all sockets', async () => {
			const mockWs1 = new MockWebSocket();
			const mockWs2 = new MockWebSocket();

			await namespace.handleConnection(mockWs1 as any, { id: 'user1' }, { id: 'session1' });
			await namespace.handleConnection(mockWs2 as any, { id: 'user2' }, { id: 'session2' });

			const sockets = await namespace.fetchSockets();
			expect(sockets).toHaveLength(2);
			expect(sockets[0]).toBeInstanceOf(Socket);
			expect(sockets[1]).toBeInstanceOf(Socket);
		});

		test('should return empty array when no sockets', async () => {
			const sockets = await namespace.fetchSockets();
			expect(sockets).toHaveLength(0);
		});
	});

	describe('Cleanup', () => {
		test('should disconnect all sockets', async () => {
			const mockWs1 = new MockWebSocket();
			const mockWs2 = new MockWebSocket();

			const socket1 = await namespace.handleConnection(
				mockWs1 as any,
				{ id: 'user1' },
				{ id: 'session1' }
			);
			const socket2 = await namespace.handleConnection(
				mockWs2 as any,
				{ id: 'user2' },
				{ id: 'session2' }
			);

			const disconnectSpy1 = spyOn(socket1, 'disconnect');
			const disconnectSpy2 = spyOn(socket2, 'disconnect');

			namespace.disconnectSockets(true);

			expect(disconnectSpy1).toHaveBeenCalledWith(true);
			expect(disconnectSpy2).toHaveBeenCalledWith(true);
		});

		test('should get socket count', async () => {
			expect(namespace.socketsCount).toBe(0);

			const mockWs = new MockWebSocket();
			await namespace.handleConnection(mockWs as any, { id: 'user1' }, { id: 'session1' });

			expect(namespace.socketsCount).toBe(1);
		});
	});

	describe('Event Handling', () => {
		test('should handle connection events', () => {
			const connectionHandler = mock(() => {});
			namespace.on('connection', connectionHandler);

			namespace.emit('connection', 'test-socket');
			expect(connectionHandler).toHaveBeenCalledWith('test-socket');
		});

		test('should handle disconnect events', () => {
			const disconnectHandler = mock(() => {});
			namespace.on('disconnect', disconnectHandler);

			namespace.emit('disconnect', 'test-socket', 'reason');
			expect(disconnectHandler).toHaveBeenCalledWith('test-socket', 'reason');
		});
	});

	describe('Message Sending', () => {
		test('should send message (alias for emit)', () => {
			const emitSpy = spyOn(namespace, 'emit');
			namespace.send('hello world');
			expect(emitSpy).toHaveBeenCalledWith('message', 'hello world');
		});

		test('should write message (alias for send)', () => {
			const sendSpy = spyOn(namespace, 'send');
			namespace.write('hello world');
			expect(sendSpy).toHaveBeenCalledWith('hello world');
		});
	});
});
