/**
 * Simplified Server tests - core namespace management
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SocketServer } from '../../socket/server';

describe('SocketServer - Core Functionality', () => {
	let server: SocketServer;

	beforeEach(() => {
		server = new SocketServer();
	});

	afterEach(() => {
		server.close();
	});

	describe('Initialization', () => {
		test('should initialize with default namespace', () => {
			expect(server.sockets).toBeDefined();
			expect(server.sockets.name).toBe('/');
		});

		test('should start with zero socket count', () => {
			expect(server.socketsCount).toBe(0);
		});

		test('should have default namespace in list', () => {
			const names = server.getNamespaceNames();
			expect(names).toContain('/');
		});
	});

	describe('Bun Server Integration', () => {
		test('should set Bun server instance', () => {
			const mockServer = { publish: () => true };
			server.setBunServer(mockServer as any);

			const result = server.publish('test-topic', 'test message');
			expect(result).toBe(true);
		});

		test('should handle publish without server', () => {
			const result = server.publish('test-topic', 'test message');
			expect(result).toBe(false);
		});
	});

	describe('Namespace Management', () => {
		test('should create new namespace', () => {
			const chatNs = server.of('/chat');
			expect(chatNs.name).toBe('/chat');
			expect(server.getNamespaceNames()).toContain('/chat');
		});

		test('should normalize namespace names', () => {
			const ns1 = server.of('game');
			const ns2 = server.of('/game');

			expect(ns1.name).toBe('/game');
			expect(ns2.name).toBe('/game');
			expect(ns1).toBe(ns2); // Same instance
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
			const testNs = server.of('/test');
			const retrieved = server.of('/test');
			expect(testNs).toBe(retrieved);
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
	});

	describe('Broadcasting API', () => {
		test('should provide broadcast methods', () => {
			expect(typeof server.emit).toBe('function');
			expect(typeof server.to).toBe('function');
			expect(typeof server.in).toBe('function');
			expect(typeof server.except).toBe('function');
		});

		test('should provide broadcast flags', () => {
			expect(server.binary).toBeDefined();
			expect(server.volatile).toBeDefined();
			expect(server.local).toBeDefined();
			expect(typeof server.compress).toBe('function');
			expect(typeof server.timeout).toBe('function');
		});

		test('should provide socket management methods', () => {
			expect(typeof server.socketsJoin).toBe('function');
			expect(typeof server.socketsLeave).toBe('function');
			expect(typeof server.disconnectSockets).toBe('function');
			expect(typeof server.fetchSockets).toBe('function');
		});
	});

	describe('Middleware', () => {
		test('should add middleware to default namespace', () => {
			const middleware = () => {};
			const result = server.use(middleware);
			expect(result).toBe(server); // Should return server for chaining
		});
	});

	describe('Message Aliases', () => {
		test('should provide send/write methods', () => {
			expect(typeof server.send).toBe('function');
			expect(typeof server.write).toBe('function');
		});
	});

	describe('Socket Count', () => {
		test('should calculate total across namespaces', () => {
			// Create multiple namespaces
			server.of('/chat');
			server.of('/game');
			server.of('/admin');

			// Should still be 0 since no actual sockets connected
			expect(server.socketsCount).toBe(0);
		});
	});

	describe('Cleanup', () => {
		test('should close all namespaces', () => {
			// Create some namespaces
			server.of('/chat');
			server.of('/game');
			server.of('/admin');

			expect(server.getNamespaceNames().length).toBeGreaterThan(1);

			server.close();

			expect(server.getNamespaceNames().length).toBe(0);
		});
	});

	describe('Type Safety', () => {
		test('should support typed namespaces', () => {
			interface TestEvents {
				test_event: (data: string) => void;
			}

			const typedNs = server.of<TestEvents>('/typed');
			expect(typedNs.name).toBe('/typed');
		});
	});

	describe('Edge Cases', () => {
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

		test('should handle namespace name without leading slash', () => {
			const ns = server.of('test');
			expect(ns.name).toBe('/test');
		});
	});
});
