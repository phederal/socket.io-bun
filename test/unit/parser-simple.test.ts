/**
 * Simplified Parser tests - focused on core functionality
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SocketParser, BinaryProtocol } from '../../socket/parser';

describe('SocketParser - Core Functionality', () => {
	beforeEach(() => {
		SocketParser.clearCache();
	});

	describe('Simple Event Encoding', () => {
		test('should encode event without data', () => {
			const result = SocketParser.encodeSimpleEvent('test_event');
			expect(result).toBe('42["test_event"]');
		});

		test('should encode event with namespace', () => {
			const result = SocketParser.encodeSimpleEvent('test_event', '/chat');
			expect(result).toBe('42/chat,["test_event"]');
		});

		test('should encode string events', () => {
			const result = SocketParser.encodeStringEvent('message', 'hello');
			expect(result).toBe('42["message","hello"]');
		});

		test('should escape quotes in string data', () => {
			const result = SocketParser.encodeStringEvent('message', 'say "hello"');
			expect(result).toBe('42["message","say \\"hello\\""]');
		});
	});

	describe('Complex Event Encoding', () => {
		test('should encode regular Socket.IO events', () => {
			const result = SocketParser.encode('message', 'hello world');
			expect(result).toBe('42["message","hello world"]');
		});

		test('should encode events with object data', () => {
			const data = { user: 'john', text: 'hello' };
			const result = SocketParser.encode('chat_message', data);
			expect(result).toBe('42["chat_message",{"user":"john","text":"hello"}]');
		});

		test('should encode events with ACK id', () => {
			const result = SocketParser.encode('get_data', undefined, '123');
			expect(result).toBe('42123["get_data"]');
		});

		test('should handle different data types', () => {
			expect(SocketParser.encode('number_event', 42)).toBe('42["number_event",42]');
			expect(SocketParser.encode('boolean_event', true)).toBe('42["boolean_event",true]');
			expect(SocketParser.encode('null_event', null)).toBe('42["null_event",null]');
		});

		test('should handle Engine.IO events', () => {
			// ping returns Engine.IO format
			expect(SocketParser.encode('ping' as any)).toBe('2');
			expect(SocketParser.encode('pong' as any)).toBe('3');
		});
	});

	describe('ACK Response Encoding', () => {
		test('should encode ACK response with string', () => {
			const result = SocketParser.encodeAckResponseFast('123', 'response');
			expect(result).toBe('43123["response"]');
		});

		test('should encode ACK response with number', () => {
			const result = SocketParser.encodeAckResponseFast('456', 42);
			expect(result).toBe('43456[42]');
		});

		test('should encode ACK response with object', () => {
			const data = { result: 'success' };
			const result = SocketParser.encodeAckResponseFast('789', data);
			expect(result).toBe('43789[{"result":"success"}]');
		});

		test('should handle null/undefined ACK data', () => {
			expect(SocketParser.encodeAckResponseFast('123', null)).toBe('43123[]');
			expect(SocketParser.encodeAckResponseFast('123', undefined)).toBe('43123[]');
		});
	});

	describe('Special Packets', () => {
		test('should encode connect packet', () => {
			expect(SocketParser.encodeConnect()).toBe('40');
			expect(SocketParser.encodeConnect('/chat')).toBe('40/chat,');
			expect(SocketParser.encodeConnect('/', { auth: 'token' })).toBe('40{"auth":"token"}');
		});

		test('should encode disconnect packet', () => {
			expect(SocketParser.encodeDisconnect()).toBe('41');
			expect(SocketParser.encodeDisconnect('/chat')).toBe('41/chat,');
		});
	});

	describe('Packet Decoding', () => {
		test('should decode Engine.IO packets', async () => {
			expect(await SocketParser.decode('2')).toEqual({ event: 'ping' });
			expect(await SocketParser.decode('3')).toEqual({ event: 'pong' });
		});

		test('should decode simple Socket.IO events', async () => {
			const result = await SocketParser.decode('42["test_event"]');
			expect(result).toEqual({
				event: 'test_event',
				data: undefined,
				namespace: '/',
			});
		});

		test('should decode events with data', async () => {
			const result = await SocketParser.decode('42["message","hello"]');
			expect(result).toEqual({
				event: 'message',
				data: 'hello',
				namespace: '/',
			});
		});

		test('should decode events with ACK id', async () => {
			const result = await SocketParser.decode('42123["get_data","param"]');
			expect(result).toEqual({
				event: 'get_data',
				data: 'param',
				ackId: '123',
				namespace: '/',
			});
		});

		test('should decode ACK responses', async () => {
			const result = await SocketParser.decode('43456["response_data"]');
			expect(result).toEqual({
				event: '__ack',
				ackId: '456',
				data: ['response_data'],
				namespace: '/',
			});
		});

		test('should handle invalid packets', async () => {
			expect(await SocketParser.decode('')).toBeNull();
			expect(await SocketParser.decode('invalid')).toBeNull();
			expect(await SocketParser.decode('99invalid')).toBeNull();
		});
	});

	describe('Performance Features', () => {
		test('should cache simple events', () => {
			const first = SocketParser.encodeSimpleEvent('ping');
			const second = SocketParser.encodeSimpleEvent('ping');
			expect(first).toBe(second);

			const stats = SocketParser.getCacheStats();
			expect(stats.simpleCacheSize).toBeGreaterThan(0);
		});

		test('should generate unique ACK IDs', () => {
			const id1 = SocketParser.generateAckId();
			const id2 = SocketParser.generateAckId();
			expect(id1).not.toBe(id2);
			expect(parseInt(id2)).toBeGreaterThan(parseInt(id1));
		});
	});
});

describe('BinaryProtocol - Core Functionality', () => {
	describe('Support Detection', () => {
		test('should detect supported events', () => {
			expect(BinaryProtocol.supportsBinaryEncoding('ping')).toBe(true);
			expect(BinaryProtocol.supportsBinaryEncoding('pong')).toBe(true);
			expect(BinaryProtocol.supportsBinaryEncoding('message')).toBe(true);
			expect(BinaryProtocol.supportsBinaryEncoding('notification')).toBe(true);
		});

		test('should reject unsupported events', () => {
			expect(BinaryProtocol.supportsBinaryEncoding('unknown_event')).toBe(false);
			expect(BinaryProtocol.supportsBinaryEncoding('custom_event')).toBe(false);
		});
	});

	describe('Binary Encoding', () => {
		test('should encode simple events without data', () => {
			const result = BinaryProtocol.encodeBinaryEvent('ping');
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result?.length).toBe(3);
			expect(result?.[0]).toBe(0xff); // Magic byte
			expect(result?.[1]).toBe(0x01); // Version
			expect(result?.[2]).toBe(0x01); // PING event code
		});

		test('should encode events with string data', () => {
			const result = BinaryProtocol.encodeBinaryEvent('message', 'hello');
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result?.length).toBe(9); // 4 header bytes + 5 data bytes
		});

		test('should encode events with number data', () => {
			const result = BinaryProtocol.encodeBinaryEvent('notification', 42);
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result?.length).toBe(8); // 4 header bytes + 4 data bytes
		});

		test('should return null for unsupported events', () => {
			const result = BinaryProtocol.encodeBinaryEvent('unsupported_event');
			expect(result).toBeNull();
		});
	});

	describe('Binary Decoding', () => {
		test('should decode simple events', () => {
			const encoded = BinaryProtocol.encodeBinaryEvent('ping');
			const result = BinaryProtocol.decodeBinaryEvent(encoded!);
			expect(result).toEqual({ event: 'ping' });
		});

		test('should decode events with string data', () => {
			const encoded = BinaryProtocol.encodeBinaryEvent('message', 'test');
			const result = BinaryProtocol.decodeBinaryEvent(encoded!);
			expect(result).toEqual({ event: 'message', data: 'test' });
		});

		test('should decode events with number data', () => {
			const encoded = BinaryProtocol.encodeBinaryEvent('notification', 123);
			const result = BinaryProtocol.decodeBinaryEvent(encoded!);
			expect(result).toEqual({ event: 'notification', data: 123 });
		});

		test('should handle invalid binary data', () => {
			const invalid = new Uint8Array([0x00, 0x01, 0x02]);
			const result = BinaryProtocol.decodeBinaryEvent(invalid);
			expect(result).toBeNull();
		});
	});

	describe('Protocol Detection', () => {
		test('should detect binary protocol', () => {
			const binaryData = BinaryProtocol.encodeBinaryEvent('ping');
			expect(BinaryProtocol.isBinaryProtocol(binaryData!)).toBe(true);
		});

		test('should reject text as binary', () => {
			expect(BinaryProtocol.isBinaryProtocol('42["ping"]')).toBe(false);
		});

		test('should reject invalid binary', () => {
			const invalid = new Uint8Array([0x00, 0x01]);
			expect(BinaryProtocol.isBinaryProtocol(invalid)).toBe(false);
		});
	});
});
