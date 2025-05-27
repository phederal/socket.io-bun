/**
 * Smoke tests - basic functionality verification
 */

import { describe, test, expect } from 'bun:test';
import { io } from '../src/server';
import { SocketParser, BinaryProtocol } from '../src/parser';
import { Adapter } from '../src/adapter';
import { BroadcastOperator } from '../src/broadcast';

describe('Smoke Tests', () => {
	test('should import SocketServer', () => {
		expect(io).toBeDefined();
		expect(typeof io.emit).toBe('function');
		expect(typeof io.of).toBe('function');
		expect(typeof io.close).toBe('function');
	});

	test('should import SocketParser', () => {
		expect(SocketParser).toBeDefined();
		expect(typeof SocketParser.encode).toBe('function');
		expect(typeof SocketParser.decode).toBe('function');
		expect(typeof SocketParser.encodeSimpleEvent).toBe('function');
	});

	test('should import BinaryProtocol', () => {
		expect(BinaryProtocol).toBeDefined();
		expect(typeof BinaryProtocol.encodeBinaryEvent).toBe('function');
		expect(typeof BinaryProtocol.decodeBinaryEvent).toBe('function');
		expect(typeof BinaryProtocol.supportsBinaryEncoding).toBe('function');
	});

	test('should import Adapter', () => {
		expect(Adapter).toBeDefined();
		expect(typeof Adapter.prototype.addSocket).toBe('function');
		expect(typeof Adapter.prototype.removeSocket).toBe('function');
		expect(typeof Adapter.prototype.broadcast).toBe('function');
	});

	test('should import BroadcastOperator', () => {
		expect(BroadcastOperator).toBeDefined();
		expect(typeof BroadcastOperator.prototype.emit).toBe('function');
		expect(typeof BroadcastOperator.prototype.to).toBe('function');
		expect(typeof BroadcastOperator.prototype.except).toBe('function');
	});

	test('should create namespaces', () => {
		const testNs = io.of('/test-smoke');
		expect(testNs).toBeDefined();
		expect(testNs.name).toBe('/test-smoke');

		// Cleanup
		testNs.disconnectSockets(true);
	});

	test('should encode/decode basic packets', async () => {
		// Test regular Socket.IO event (not Engine.IO ping)
		const encoded = SocketParser.encode('message', 'hello');
		expect(encoded).toBe('42["message","hello"]');

		const decoded = await SocketParser.decode(encoded);
		expect(decoded).toEqual({
			event: 'message',
			data: 'hello',
			namespace: '/',
		});

		// Test simple event without data
		const simpleEncoded = SocketParser.encodeSimpleEvent('test_event');
		expect(simpleEncoded).toBe('42["test_event"]');

		const simpleDecoded = await SocketParser.decode(simpleEncoded);
		expect(simpleDecoded).toEqual({
			event: 'test_event',
			data: undefined,
			namespace: '/',
		});
	});

	test('should handle binary protocol basics', () => {
		expect(BinaryProtocol.supportsBinaryEncoding('ping')).toBe(true);
		expect(BinaryProtocol.supportsBinaryEncoding('unknown_event')).toBe(false);

		const encoded = BinaryProtocol.encodeBinaryEvent('ping');
		expect(encoded).toBeInstanceOf(Uint8Array);
		expect(encoded?.length).toBe(3);

		if (encoded) {
			const decoded = BinaryProtocol.decodeBinaryEvent(encoded);
			expect(decoded?.event).toBe('ping');
		}
	});
});
