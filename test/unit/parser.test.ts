/**
 * Unit tests for SocketParser and BinaryProtocol
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SocketParser, BinaryProtocol } from '../../socket/parser';

describe('SocketParser', () => {
	beforeEach(() => {
		SocketParser.clearCache();
	});

	describe('Simple Event Encoding', () => {
		test('should encode simple events without data', () => {
			const result = SocketParser.encodeSimpleEvent('ping');
			expect(result).toBe('42["ping"]');
		});

		test('should encode simple events with namespace', () => {
			const result = SocketParser.encodeSimpleEvent('connect', '/chat');
			expect(result).toBe('42/chat,["connect"]');
		});

		test('should cache simple events', () => {
			const first = SocketParser.encodeSimpleEvent('ping');
			const second = SocketParser.encodeSimpleEvent('ping');
			expect(first).toBe(second);

			const stats = SocketParser.getCacheStats();
			expect(stats.simpleCacheSize).toBe(1);
		});
	});

	describe('String Event Encoding', () => {
		test('should encode string events', () => {
			const result = SocketParser.encodeStringEvent('message', 'hello');
			expect(result).toBe('42["message","hello"]');
		});

		test('should escape quotes in string data', () => {
			const result = SocketParser.encodeStringEvent('message', 'hello "world"');
			expect(result).toBe('42["message","hello \\"world\\""]');
		});

		test('should handle namespace for string events', () => {
			const result = SocketParser.encodeStringEvent('message', 'hello', '/chat');
			expect(result).toBe('42/chat,["message","hello"]');
		});
	});

	describe('Complex Event Encoding', () => {
		test('should encode events with object data', () => {
			const data = { user: 'john', message: 'hello' };
			const result = SocketParser.encode('chat_message', data);
			expect(result).toBe('42["chat_message",{"user":"john","message":"hello"}]');
		});

		test('should encode events with ACK id', () => {
			const result = SocketParser.encode('get_user_info', undefined, '123');
			expect(result).toBe('42123["get_user_info"]');
		});

		test('should encode events with data and ACK id', () => {
			const result = SocketParser.encode('calculate', { a: 5, b: 3 }, '456');
			expect(result).toBe('42456["calculate",{"a":5,"b":3}]');
		});

		test('should handle different data types', () => {
			expect(SocketParser.encode('number_event', 42)).toBe('42["number_event",42]');
			expect(SocketParser.encode('boolean_event', true)).toBe('42["boolean_event",true]');
			expect(SocketParser.encode('null_event', null)).toBe('42["null_event",null]');
		});
	});

	describe('ACK Response Encoding', () => {
		test('should encode ACK response with single string', () => {
			const result = SocketParser.encodeAckResponseFast('123', 'response');
			expect(result).toBe('43123["response"]');
		});

		test('should encode ACK response with number', () => {
			const result = SocketParser.encodeAckResponseFast('123', 42);
			expect(result).toBe('43123[42]');
		});

		test('should encode ACK response with boolean', () => {
			const result = SocketParser.encodeAckResponseFast('123', true);
			expect(result).toBe('43123[true]');
		});

		test('should encode ACK response with null/undefined', () => {
			expect(SocketParser.encodeAckResponseFast('123', null)).toBe('43123[]');
			expect(SocketParser.encodeAckResponseFast('123', undefined)).toBe('43123[]');
		});

		test('should encode ACK response with complex data', () => {
			const data = { result: 'success', count: 5 };
			const result = SocketParser.encodeAckResponseFast('123', data);
			expect(result).toBe('43123[{"result":"success","count":5}]');
		});
	});

	describe('Special Packet Encoding', () => {
		test('should encode connect packet', () => {
			const result = SocketParser.encodeConnect();
			expect(result).toBe('40');
		});

		test('should encode connect packet with namespace', () => {
			const result = SocketParser.encodeConnect('/chat');
			expect(result).toBe('40/chat,');
		});

		test('should encode connect packet with data', () => {
			const result = SocketParser.encodeConnect('/', { auth: 'token' });
			expect(result).toBe('40{"auth":"token"}');
		});

		test('should encode disconnect packet', () => {
			const result = SocketParser.encodeDisconnect();
			expect(result).toBe('41');
		});

		test('should encode disconnect packet with namespace', () => {
			const result = SocketParser.encodeDisconnect('/chat');
			expect(result).toBe('41/chat,');
		});
	});

	describe('Packet Decoding', () => {
		test('should decode ping packet', async () => {
			const result = await SocketParser.decode('2');
			expect(result).toEqual({ event: 'ping' });
		});

		test('should decode pong packet', async () => {
			const result = await SocketParser.decode('3');
			expect(result).toEqual({ event: 'pong' });
		});

		test('should decode simple event', async () => {
			const result = await SocketParser.decode('42["message"]');
			expect(result).toEqual({
				event: 'message',
				data: undefined,
				namespace: '/',
			});
		});

		test('should decode event with string data', async () => {
			const result = await SocketParser.decode('42["message","hello"]');
			expect(result).toEqual({
				event: 'message',
				data: 'hello',
				namespace: '/',
			});
		});

		test('should decode event with object data', async () => {
			const result = await SocketParser.decode(
				'42["chat_message",{"user":"john","text":"hello"}]'
			);
			expect(result).toEqual({
				event: 'chat_message',
				data: { user: 'john', text: 'hello' },
				namespace: '/',
			});
		});

		test('should decode event with ACK id', async () => {
			const result = await SocketParser.decode('42123["get_data"]');
			expect(result).toEqual({
				event: 'get_data',
				data: undefined,
				ackId: '123',
				namespace: '/',
			});
		});

		test('should decode event with namespace', async () => {
			const result = await SocketParser.decode('42/chat,["message","hello"]');
			expect(result).toEqual({
				event: 'message',
				data: 'hello',
				namespace: '/chat',
			});
		});

		test('should decode ACK response', async () => {
			const result = await SocketParser.decode('43123["response_data"]');
			expect(result).toEqual({
				event: '__ack',
				ackId: '123',
				data: ['response_data'],
				namespace: '/',
			});
		});

		test('should decode connect packet', async () => {
			const result = await SocketParser.decode('40');
			expect(result).toEqual({
				event: '__connect',
				namespace: '/',
				data: undefined,
			});
		});

		test('should decode disconnect packet', async () => {
			const result = await SocketParser.decode('41');
			expect(result).toEqual({
				event: '__disconnect',
				namespace: '/',
			});
		});

		test('should handle invalid packets', async () => {
			expect(await SocketParser.decode('')).toBeNull();
			expect(await SocketParser.decode('invalid')).toBeNull();
			expect(await SocketParser.decode('42invalid')).toBeNull();
		});
	});

	describe('Binary Data Decoding', () => {
		test('should handle ArrayBuffer input', async () => {
			const text = '42["ping"]';
			const buffer = new TextEncoder().encode(text).buffer;
			const result = await SocketParser.decode(buffer);
			expect(result).toEqual({
				event: 'ping',
				data: undefined,
				namespace: '/',
			});
		});

		test('should handle Uint8Array input', async () => {
			const text = '42["pong"]';
			const bytes = new TextEncoder().encode(text);
			const result = await SocketParser.decode(bytes);
			expect(result).toEqual({
				event: 'pong',
				data: undefined,
				namespace: '/',
			});
		});

		test('should handle Blob input', async () => {
			const text = '42["message","test"]';
			const blob = new Blob([text], { type: 'text/plain' });
			const result = await SocketParser.decode(blob);
			expect(result).toEqual({
				event: 'message',
				data: 'test',
				namespace: '/',
			});
		});
	});

	describe('ACK ID Generation', () => {
		test('should generate unique ACK IDs', () => {
			const id1 = SocketParser.generateAckId();
			const id2 = SocketParser.generateAckId();
			expect(id1).not.toBe(id2);
			expect(typeof id1).toBe('string');
			expect(typeof id2).toBe('string');
		});

		test('should generate sequential ACK IDs', () => {
			const id1 = parseInt(SocketParser.generateAckId());
			const id2 = parseInt(SocketParser.generateAckId());
			expect(id2).toBe(id1 + 1);
		});
	});
});

describe('BinaryProtocol', () => {
	describe('Event Support Check', () => {
		test('should support binary encoding for known events', () => {
			expect(BinaryProtocol.supportsBinaryEncoding('ping')).toBe(true);
			expect(BinaryProtocol.supportsBinaryEncoding('pong')).toBe(true);
			expect(BinaryProtocol.supportsBinaryEncoding('message')).toBe(true);
			expect(BinaryProtocol.supportsBinaryEncoding('notification')).toBe(true);
		});

		test('should not support binary encoding for unknown events', () => {
			expect(BinaryProtocol.supportsBinaryEncoding('unknown_event')).toBe(false);
			expect(BinaryProtocol.supportsBinaryEncoding('custom_event')).toBe(false);
		});
	});

	describe('Binary Event Encoding', () => {
		test('should encode simple event without data', () => {
			const result = BinaryProtocol.encodeBinaryEvent('ping');
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result?.length).toBe(3); // Magic + Version + EventCode
			expect(result?.[0]).toBe(0xff); // Magic byte
			expect(result?.[1]).toBe(0x01); // Version
			expect(result?.[2]).toBe(0x01); // PING event code
		});

		test('should encode event with string data', () => {
			const result = BinaryProtocol.encodeBinaryEvent('message', 'hello');
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result?.length).toBe(9); // Magic + Version + EventCode + Length + 5 bytes for "hello"
			expect(result?.[0]).toBe(0xff);
			expect(result?.[1]).toBe(0x01);
			expect(result?.[2]).toBe(0x03); // MESSAGE event code
			expect(result?.[3]).toBe(5); // Data length
		});

		test('should encode event with number data', () => {
			const result = BinaryProtocol.encodeBinaryEvent('notification', 42);
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result?.length).toBe(8); // Magic + Version + EventCode + Length + 4 bytes for float32
			expect(result?.[0]).toBe(0xff);
			expect(result?.[1]).toBe(0x01);
			expect(result?.[2]).toBe(0x04); // NOTIFICATION event code
			expect(result?.[3]).toBe(4); // Data length
		});

		test('should return null for unsupported events', () => {
			const result = BinaryProtocol.encodeBinaryEvent('unsupported_event');
			expect(result).toBeNull();
		});
	});

	describe('Binary Event Decoding', () => {
		test('should decode simple event without data', () => {
			const encoded = BinaryProtocol.encodeBinaryEvent('ping');
			const result = BinaryProtocol.decodeBinaryEvent(encoded!);
			expect(result).toEqual({ event: 'ping' });
		});

		test('should decode event with string data', () => {
			const encoded = BinaryProtocol.encodeBinaryEvent('message', 'hello');
			const result = BinaryProtocol.decodeBinaryEvent(encoded!);
			expect(result).toEqual({ event: 'message', data: 'hello' });
		});

		test('should decode event with number data', () => {
			const encoded = BinaryProtocol.encodeBinaryEvent('notification', 42);
			const result = BinaryProtocol.decodeBinaryEvent(encoded!);
			expect(result).toEqual({ event: 'notification', data: 42 });
		});

		test('should handle invalid binary data', () => {
			const invalidData = new Uint8Array([0x00, 0x01, 0x02]);
			const result = BinaryProtocol.decodeBinaryEvent(invalidData);
			expect(result).toBeNull();
		});

		test('should handle truncated binary data', () => {
			const truncated = new Uint8Array([0xff, 0x01]); // Missing event code
			const result = BinaryProtocol.decodeBinaryEvent(truncated);
			expect(result).toBeNull();
		});
	});

	describe('Protocol Detection', () => {
		test('should detect binary protocol data', () => {
			const binaryData = BinaryProtocol.encodeBinaryEvent('ping');
			expect(BinaryProtocol.isBinaryProtocol(binaryData!)).toBe(true);
		});

		test('should not detect text as binary protocol', () => {
			expect(BinaryProtocol.isBinaryProtocol('42["ping"]')).toBe(false);
		});

		test('should not detect invalid binary as protocol', () => {
			const invalidData = new Uint8Array([0x00, 0x01, 0x02]);
			expect(BinaryProtocol.isBinaryProtocol(invalidData)).toBe(false);
		});
	});

	describe('Round-trip Encoding/Decoding', () => {
		test('should maintain data integrity for all supported events', () => {
			const events = ['ping', 'pong', 'message', 'notification', 'user_joined', 'user_left'];

			for (const event of events) {
				// Without data
				const encoded1 = BinaryProtocol.encodeBinaryEvent(event);
				const decoded1 = BinaryProtocol.decodeBinaryEvent(encoded1!);
				expect(decoded1?.event).toBe(event);

				// With string data
				if (event === 'message' || event === 'notification') {
					const encoded2 = BinaryProtocol.encodeBinaryEvent(event, 'test data');
					const decoded2 = BinaryProtocol.decodeBinaryEvent(encoded2!);
					expect(decoded2?.event).toBe(event);
					expect(decoded2?.data).toBe('test data');
				}
			}
		});
	});
});
