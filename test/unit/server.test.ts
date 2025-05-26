/**
 * Unit tests for SocketServer class
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { SocketServer } from '../../socket/server';
import { Namespace } from '../../socket/namespace';

// Mock Bun Server
class MockBunServer {
	publish = mock(() => 1); // Success
}

describe('SocketServer', () => {
	let server: SocketServer;
	let mockBunServer: MockBunServer;

	beforeEach(() => {
		server = new SocketServer();
		mockBunServer = new MockBunServer();
	});

	afterEach(() => {
		server.close();
	});

	describe('Initialization', () => {
		test('should initialize with default namespace', () => {
			expect(server.sockets).toBeInstanceOf(Namespace);
			expect(server.sockets.name).toBe('/');
		});

		test('should start with no namespaces except default', () => {
			const names = server.getNamespaceNames();
			expect(names).toEqual(['/']);
		});

		test('should have zero socket count initially', () => {
			expect(server.socketsCount).toBe(0);
		});
	});

	describe('Bun Server Integration', () => {
		test('should set Bun server instance', () => {
			server.setBunServer(mockBunServer as any);
			expect((server as any).bunServer).toBe(mockBunServer);
		});

		test('should publish messages when Bun server is set', () => {
			server.setBunServer(mockBunServer as any);
			const result = server.publish('test-topic', 'test message');

			expect(result).toBe(true);
			expect(mockBunServer.publish).toHaveBeenCalledWith('test-topic', 'test message');
		});

		test('should handle publish when no Bun server is set', () => {
			const result = server.publish('test-topic', 'test message');
			expect(result).toBe(false);
		});

		test('should handle Uint8Array messages', () => {
			server.setBunServer(mockBunServer as any);
			const buffer = new Uint8Array([1, 2, 3]);
			const result = server.publish('test-topic', buffer);

			expect(result).toBe(true);
			expect(mockBunServer.publish).toHaveBeenCalledWith('test-topic', buffer);
		});
	});

	describe('Namespace Management', () => {
		test('should create new namespace', () => {
			const chatNs = server.of('/chat');
			expect(chatNs).toBeInstanceOf(Namespace);
			expect(chatNs.name).toBe('/chat');
			expect(server.getNamespaceNames()).toContain('/chat');
		});

		test('should normalize namespace names', () => {
			const ns1 = server.of('chat');
			const ns2 = server.of('/chat');

			expect(ns1.name).toBe('/chat');
			expect(ns2.name).toBe('/chat');
			expect(ns1).toBe(ns2); // Should return same instance
		});

		test('should handle root namespace variations', () => {
			const ns1 = server.of('');
			const ns2 = server.of('/');
			const ns3 = server.sockets;

			expect(ns1).toBe(ns2);
			expect(ns2).toBe(ns3);
			expect(ns1.name).toBe('/');
		});

		test('should return existing namespace', () => {
			const ns1 = server.of('/test');
			const ns2 = server.of('/test');
			expect(ns1).toBe(ns2);
		});

		test('should get namespace by name', () => {
			const chatNs = server.of('/chat');
			const retrieved = server.getNamespace('/chat');
			expect(retrieved).toBe(chatNs);
		});

		test('should return undefined for non-existent namespace', () => {
			const retrieved = server.getNamespace('/nonexistent');
			expect(retrieved).toBeUndefined();
		});

		test('should emit new_namespace event', () => {
			const newNamespaceSpy = spyOn(server, 'emit');
			server.of('/new-namespace');
			expect(newNamespaceSpy).toHaveBeenCalledWith('new_namespace', expect.any(Namespace));
		});

		test('should not emit new_namespace for default namespace', () => {
			const newNamespaceSpy = spyOn(server, 'emit');
			server.of('/');
			expect(newNamespaceSpy).not.toHaveBeenCalledWith('new_namespace', expect.any(Object));
		});
	});

	describe('Default Namespace Event Forwarding', () => {
		test('should forward connection events from default namespace', (done) => {
			server.on('connection', (socket) => {
				expect(socket).toBeDefined();
				done();
			});

			// Simulate connection event from default namespace
			setTimeout(() => {
				server.sockets.emit('connection', { id: 'test-socket' });
			}, 10);
		});

		test('should forward disconnect events from default namespace', (done) => {
			server.on('disconnect', (socket, reason) => {
				expect(socket).toBeDefined();
				expect(reason).toBe('test reason');
				done();
			});

			// Simulate disconnect event from default namespace
			setTimeout(() => {
				server.sockets.emit('disconnect', { id: 'test-socket' }, 'test reason');
			}, 10);
		});

		test('should forward connect alias events', (done) => {
			server.on('connect', (socket) => {
				expect(socket).toBeDefined();
				done();
			});

			setTimeout(() => {
				server.sockets.emit('connection', { id: 'test-socket' });
			}, 10);
		});
	});

	describe('Middleware', () => {
		test('should add middleware to default namespace', () => {
			const middleware = mock(() => {});
			server.use(middleware);

			// Check that middleware was added to default namespace
			expect((server.sockets as any).middlewares).toContain(middleware);
		});

		test('should chain middleware calls', () => {
			const middleware1 = mock(() => {});
			const middleware2 = mock(() => {});

			const result = server.use(middleware1).use(middleware2);
			expect(result).toBe(server);
		});
	});

	describe('Broadcasting', () => {
		test('should delegate emit to default namespace', () => {
			const emitSpy = spyOn(server.sockets, 'emit');
			server.emit('test_event', 'test data');
			expect(emitSpy).toHaveBeenCalledWith('test_event', 'test data');
		});

		test('should delegate emitBinary to default namespace', () => {
			const emitBinarySpy = spyOn(server.sockets, 'emitBinary');
			server.emitBinary('ping', 'data');
			expect(emitBinarySpy).toHaveBeenCalledWith('ping', 'data');
		});

		test('should delegate emitFast to default namespace', () => {
			const emitFastSpy = spyOn(server.sockets, 'emitFast');
			server.emitFast('notification', 'alert');
			expect(emitFastSpy).toHaveBeenCalledWith('notification', 'alert');
		});

		test('should handle room targeting', () => {
			const broadcastOp = server.to('room1');
			expect(broadcastOp).toBeDefined();
		});

		test('should handle multiple room targeting', () => {
			const broadcastOp = server.to(['room1', 'room2']);
			expect(broadcastOp).toBeDefined();
		});

		test('should handle room exclusion', () => {
			const broadcastOp = server.except('room1');
			expect(broadcastOp).toBeDefined();
		});

		test('should support in() as alias for to()', () => {
			const broadcastOp = server.in('room1');
			expect(broadcastOp).toBeDefined();
		});
	});

	describe('Broadcast Flags', () => {
		test('should support binary flag', () => {
			const binaryOp = server.binary;
			expect(binaryOp).toBeDefined();
		});

		test('should support volatile flag', () => {
			const volatileOp = server.volatile;
			expect(volatileOp).toBeDefined();
		});

		test('should support local flag', () => {
			const localOp = server.local;
			expect(localOp).toBeDefined();
		});

		test('should support compress flag', () => {
			const compressOp = server.compress(true);
			expect(compressOp).toBeDefined();
		});

		test('should support timeout', () => {
			const timeoutOp = server.timeout(5000);
			expect(timeoutOp).toBeDefined();
		});
	});

	describe('Bulk Operations', () => {
		test('should handle bulk operations', () => {
			const emitBulkSpy = spyOn(server.sockets, 'emitBulk');

			const operations = [
				{ event: 'event1', data: 'data1' },
				{ event: 'event2', data: 'data2', binary: true },
			];

			server.emitBulk(operations);
			expect(emitBulkSpy).toHaveBeenCalledWith(operations);
		});
	});

	describe('Message Aliases', () => {
		test('should send message', () => {
			const sendSpy = spyOn(server.sockets, 'send');
			server.send('hello world');
			expect(sendSpy).toHaveBeenCalledWith('hello world');
		});

		test('should write message', () => {
			const sendSpy = spyOn(server, 'send');
			server.write('hello world');
			expect(sendSpy).toHaveBeenCalledWith('hello world');
		});
	});

	describe('Socket Management', () => {
		test('should delegate fetchSockets to default namespace', async () => {
			const fetchSpy = spyOn(server.sockets, 'fetchSockets').mockResolvedValue([]);
			await server.fetchSockets();
			expect(fetchSpy).toHaveBeenCalled();
		});

		test('should delegate socketsJoin to default namespace', () => {
			const joinSpy = spyOn(server.sockets, 'socketsJoin');
			server.socketsJoin('room1');
			expect(joinSpy).toHaveBeenCalledWith('room1');
		});

		test('should delegate socketsLeave to default namespace', () => {
			const leaveSpy = spyOn(server.sockets, 'socketsLeave');
			server.socketsLeave('room1');
			expect(leaveSpy).toHaveBeenCalledWith('room1');
		});

		test('should delegate disconnectSockets to default namespace', () => {
			const disconnectSpy = spyOn(server.sockets, 'disconnectSockets');
			server.disconnectSockets(true);
			expect(disconnectSpy).toHaveBeenCalledWith(true);
		});
	});

	describe('Socket Count', () => {
		test('should calculate total socket count across namespaces', () => {
			// Mock namespace socket counts
			spyOn(server.sockets, 'socketsCount', 'get').mockReturnValue(5);

			const chatNs = server.of('/chat');
			spyOn(chatNs, 'socketsCount', 'get').mockReturnValue(3);

			const gameNs = server.of('/game');
			spyOn(gameNs, 'socketsCount', 'get').mockReturnValue(7);

			expect(server.socketsCount).toBe(15); // 5 + 3 + 7
		});

		test('should return 0 when no sockets', () => {
			expect(server.socketsCount).toBe(0);
		});
	});

	describe('Event Handling', () => {
		test('should handle on() events', () => {
			const handler = mock(() => {});
			server.on('connection', handler);

			server.emit('connection', 'test-socket');
			expect(handler).toHaveBeenCalledWith('test-socket');
		});

		test('should handle once() events', () => {
			const handler = mock(() => {});
			server.once('test_event', handler);

			server.emit('test_event', 'data1');
			server.emit('test_event', 'data2');

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith('data1');
		});
	});

	describe('Cleanup', () => {
		test('should close all namespaces', () => {
			const chatNs = server.of('/chat');
			const gameNs = server.of('/game');

			const disconnectSpy1 = spyOn(server.sockets, 'disconnectSockets');
			const disconnectSpy2 = spyOn(chatNs, 'disconnectSockets');
			const disconnectSpy3 = spyOn(gameNs, 'disconnectSockets');

			const adapterCloseSpy1 = spyOn(server.sockets.adapter, 'close');
			const adapterCloseSpy2 = spyOn(chatNs.adapter, 'close');
			const adapterCloseSpy3 = spyOn(gameNs.adapter, 'close');

			server.close();

			expect(disconnectSpy1).toHaveBeenCalledWith(true);
			expect(disconnectSpy2).toHaveBeenCalledWith(true);
			expect(disconnectSpy3).toHaveBeenCalledWith(true);

			expect(adapterCloseSpy1).toHaveBeenCalled();
			expect(adapterCloseSpy2).toHaveBeenCalled();
			expect(adapterCloseSpy3).toHaveBeenCalled();
		});

		test('should clear all namespaces on close', () => {
			server.of('/chat');
			server.of('/game');

			expect(server.getNamespaceNames()).toHaveLength(3); // /, /chat, /game

			server.close();

			expect(server.getNamespaceNames()).toHaveLength(0);
		});

		test('should remove all listeners on close', () => {
			const removeAllListenersSpy = spyOn(server, 'removeAllListeners');
			server.close();
			expect(removeAllListenersSpy).toHaveBeenCalled();
		});
	});

	describe('Type Safety', () => {
		test('should support typed namespaces', () => {
			interface TestClientEvents {
				test_event: (data: string) => void;
			}

			interface TestServerEvents {
				response_event: (data: number) => void;
			}

			const typedNs = server.of<TestClientEvents, TestServerEvents>('/typed');
			expect(typedNs).toBeInstanceOf(Namespace);
			expect(typedNs.name).toBe('/typed');
		});
	});

	describe('Edge Cases', () => {
		test('should handle emit with ACK callback', () => {
			const callback = mock(() => {});
			const emitSpy = spyOn(server.sockets, 'emit');

			server.emit('test_event', callback);
			expect(emitSpy).toHaveBeenCalledWith('test_event', callback);
		});

		test('should handle emit with data and ACK', () => {
			const callback = mock(() => {});
			const emitSpy = spyOn(server.sockets, 'emit');

			server.emit('test_event', 'data', callback);
			expect(emitSpy).toHaveBeenCalledWith('test_event', 'data', callback);
		});

		test('should handle empty namespace name', () => {
			const ns = server.of('');
			expect(ns.name).toBe('/');
			expect(ns).toBe(server.sockets);
		});

		test('should handle undefined namespace name', () => {
			const ns = server.of(undefined as any);
			expect(ns.name).toBe('/');
			expect(ns).toBe(server.sockets);
		});
	});
});
