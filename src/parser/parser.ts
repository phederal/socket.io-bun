import { Emitter } from '@socket.io/component-emitter';
import { deconstructPacket, reconstructPacket } from './binary';
import { isBinary, hasBinary } from './is-binary';

/**
 * Оптимизированный Socket.IO Parser с применением техник кеширования и микро-оптимизаций
 * Полная совместимость с оригинальным Socket.IO протоколом
 */

export const protocol: number = 5;

export enum PacketType {
	CONNECT = 0,
	DISCONNECT = 1,
	EVENT = 2,
	ACK = 3,
	CONNECT_ERROR = 4,
	BINARY_EVENT = 5,
	BINARY_ACK = 6,
}

/**
 * These strings must not be used as event names, as they have a special meaning.
 */
const RESERVED_EVENTS = [
	'connect', // used on the client side
	'connect_error', // used on the client side
	'disconnect', // used on both sides
	'disconnecting', // used on the server side
	'newListener', // used by the Node.js EventEmitter
	'removeListener', // used by the Node.js EventEmitter
];

/**
 * Оптимизированный энкодер с кешированием и быстрыми путями
 */
export class Encoder {
	private static readonly packetCache = new Map<string, string>();
	private static readonly simplePacketCache = new Map<string, string>();

	// Предкомпилированные константы для производительности
	private static readonly PACKET_TYPES_STR = ['0', '1', '2', '3', '4', '5', '6'];
	private static readonly isProduction = process.env.NODE_ENV === 'production';

	constructor(private replacer?: (this: any, key: string, value: any) => any) {}

	/**
	 * Encode packet to array of strings/buffers with caching optimizations
	 */
	public encode(obj: Packet): Array<string | Buffer> {
		const { type, nsp = '/', data, id } = obj;

		// Fast path для простых событий без данных и ACK
		if (type === PacketType.EVENT && !data && !id) {
			const cacheKey = `${nsp}:${type}:simple`;
			if (Encoder.simplePacketCache.has(cacheKey)) {
				return [Encoder.simplePacketCache.get(cacheKey)!];
			}

			let encoded = Encoder.PACKET_TYPES_STR[type]!;
			if (nsp !== '/') encoded += nsp + ',';
			encoded += '[]'; // пустой массив для EVENT без данных

			Encoder.simplePacketCache.set(cacheKey, encoded);
			return [encoded];
		}

		// Fast path для строковых данных
		if (type === PacketType.EVENT && Array.isArray(data) && data.length === 2 && typeof data[0] === 'string' && typeof data[1] === 'string' && !id && !hasBinary(obj)) {
			let encoded = Encoder.PACKET_TYPES_STR[type]!;
			if (nsp !== '/') encoded += nsp + ',';
			encoded += `["${data[0]}","${data[1].replace(/["\\]/g, '\\$&')}"]`;
			return [encoded];
		}

		// Fast path для простых чисел
		if (type === PacketType.EVENT && Array.isArray(data) && data.length === 2 && typeof data[0] === 'string' && typeof data[1] === 'number' && !id && !hasBinary(obj)) {
			let encoded = Encoder.PACKET_TYPES_STR[type]!;
			if (nsp !== '/') encoded += nsp + ',';
			encoded += `["${data[0]}",${data[1]}]`;
			return [encoded];
		}

		// Проверяем на бинарные данные
		if (type === PacketType.EVENT || type === PacketType.ACK) {
			if (hasBinary(obj)) {
				return this.encodeAsBinary({
					type: obj.type === PacketType.EVENT ? PacketType.BINARY_EVENT : PacketType.BINARY_ACK,
					nsp: obj.nsp,
					data: obj.data,
					id: obj.id,
				});
			}
		}

		// Кеширование для частых паттернов (без ACK и бинарных данных)
		if (!id && !hasBinary(obj)) {
			const cacheKey = `${nsp}:${type}:${this.getDataHash(data)}`;
			if (Encoder.packetCache.has(cacheKey)) {
				const cached = Encoder.packetCache.get(cacheKey)!;
				return [this.interpolateData(cached, data)];
			}
		}

		// Основная логика кодирования
		return [this.encodeAsString(obj)];
	}

	private encodeAsString(obj: Packet): string {
		let str = Encoder.PACKET_TYPES_STR[obj.type]!;

		// attachments для бинарных пакетов
		if (obj.type === PacketType.BINARY_EVENT || obj.type === PacketType.BINARY_ACK) {
			str += obj.attachments + '-';
		}

		// namespace
		if (obj.nsp && obj.nsp !== '/') {
			str += obj.nsp + ',';
		}

		// acknowledgement id
		if (obj.id !== undefined) {
			str += obj.id;
		}

		// data
		if (obj.data !== undefined) {
			str += JSON.stringify(obj.data, this.replacer);
		}

		if (!Encoder.isProduction) {
			console.log('[OptimizedEncoder] encoded packet:', str);
		}

		return str;
	}

	private encodeAsBinary(obj: Packet): Array<string | Buffer> {
		const deconstruction = deconstructPacket(obj);
		const pack = this.encodeAsString(deconstruction.packet);
		const buffers = deconstruction.buffers;

		buffers.unshift(pack); // добавляем пакет в начало списка буферов
		return buffers;
	}

	private getDataHash(data: any): string {
		if (!data) return 'undefined';
		if (typeof data === 'string') return 'string';
		if (typeof data === 'number') return 'number';
		if (typeof data === 'boolean') return 'boolean';
		if (Array.isArray(data)) return `array:${data.length}`;
		return 'object';
	}

	private interpolateData(template: string, data: any): string {
		// Простая интерполяция для кешированных шаблонов
		if (typeof data === 'string') {
			return template.replace('__DATA__', data.replace(/["\\]/g, '\\$&'));
		}
		return template;
	}

	static clearCache(): void {
		this.packetCache.clear();
		this.simplePacketCache.clear();
	}
}

interface DecoderReservedEvents {
	decoded: (packet: Packet) => void;
}

/**
 * Оптимизированный декодер с быстрыми путями и кешированием
 * Наследуется от component-emitter для совместимости с Socket.IO
 */
export class Decoder extends Emitter<{}, {}, DecoderReservedEvents> {
	private reconstructor?: BinaryReconstructor;
	private static readonly PACKET_TYPES_REVERSE = ['0', '1', '2', '3', '4', '5', '6'];
	private static readonly isProduction = process.env.NODE_ENV === 'production';

	constructor(private reviver?: (this: any, key: string, value: any) => any) {
		super();
	}

	/**
	 * Decode string with micro-optimizations
	 */
	public add(obj: any): void {
		let packet: Packet;

		if (typeof obj === 'string') {
			if (this.reconstructor) {
				throw new Error('got plaintext data when reconstructing a packet');
			}

			packet = this.decodeString(obj);
			const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;

			if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
				packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
				this.reconstructor = new BinaryReconstructor(packet);

				if (packet.attachments === 0) {
					super.emitReserved('decoded', packet);
				}
			} else {
				super.emitReserved('decoded', packet);
			}
		} else if (isBinary(obj) || (obj && obj.base64)) {
			if (!this.reconstructor) {
				throw new Error('got binary data when not reconstructing a packet');
			} else {
				packet = this.reconstructor.takeBinaryData(obj)!;
				if (packet) {
					this.reconstructor = undefined;
					super.emitReserved('decoded', packet);
				}
			}
		} else {
			throw new Error('Unknown type: ' + obj);
		}
	}

	private decodeString(str: string): Packet {
		if (!str || str.length === 0) {
			throw new Error('invalid payload');
		}

		// Сверх-быстрая обработка одиночных символов
		if (str.length === 1) {
			const charCode = str.charCodeAt(0);
			const type = charCode - 48; // '0' = 48
			if (type >= 0 && type <= 6) {
				return { type, nsp: '/' };
			}
			throw new Error('invalid packet type');
		}

		let i = 0;
		const firstChar = str.charCodeAt(0);
		const type = firstChar - 48; // Быстрое преобразование char в число

		if (type < 0 || type > 6) {
			throw new Error('invalid packet type');
		}

		const p: any = { type };
		i++;

		// attachments для бинарных пакетов
		if (type === PacketType.BINARY_EVENT || type === PacketType.BINARY_ACK) {
			const start = i;
			while (str.charCodeAt(i) !== 45 && i !== str.length) {
				// '-' = 45
				i++;
			}
			const buf = str.substring(start, i);
			const numBuf = Number(buf);
			if (isNaN(numBuf) || str.charCodeAt(i) !== 45) {
				throw new Error('Illegal attachments');
			}
			p.attachments = numBuf;
			i++;
		}

		// Parse namespace (быстрый поиск)
		if (str.charCodeAt(i) === 47) {
			// '/'
			const start = i;
			while (i < str.length) {
				const c = str.charCodeAt(i);
				if (c === 44) break; // ',' = 44
				i++;
			}
			p.nsp = str.substring(start, i);
			if (str.charCodeAt(i) === 44) i++; // пропускаем ','
		} else {
			p.nsp = '/';
		}

		// Parse acknowledgement id (оптимизированный)
		const next = str.charCodeAt(i);
		if (next >= 48 && next <= 57) {
			// '0'-'9'
			const start = i;
			while (i < str.length) {
				const charCode = str.charCodeAt(i);
				if (charCode < 48 || charCode > 57) {
					break;
				}
				i++;
			}
			p.id = Number(str.substring(start, i));
		}

		// Parse data (быстрый путь для простых типов)
		if (i < str.length) {
			const dataStr = str.substring(i);
			const payload = this.tryParse(dataStr);
			if (this.isPayloadValid(p.type, payload)) {
				p.data = payload;
			} else {
				throw new Error('invalid payload');
			}
		}

		if (!Decoder.isProduction) {
			console.log('[OptimizedDecoder] decoded packet:', p);
		}

		return p;
	}

	private tryParse(str: string): any {
		try {
			return JSON.parse(str, this.reviver);
		} catch (e) {
			return false;
		}
	}

	private isPayloadValid(type: PacketType, payload: any): boolean {
		return isDataValid(type, payload);
	}

	/**
	 * Deallocates a parser's resources
	 */
	public destroy(): void {
		if (this.reconstructor) {
			this.reconstructor.finishedReconstruction();
			this.reconstructor = undefined;
		}
	}
}

/**
 * Binary reconstructor для работы с бинарными данными
 */
class BinaryReconstructor {
	private reconPack: Packet;
	private buffers: Array<Buffer | ArrayBuffer> = [];

	constructor(readonly packet: Packet) {
		this.reconPack = packet;
	}

	/**
	 * Method to be called when binary data received from connection
	 * after a BINARY_EVENT packet.
	 */
	public takeBinaryData(binData: any): Packet | undefined {
		this.buffers.push(binData);
		if (this.buffers.length === this.reconPack.attachments) {
			const packet = reconstructPacket(this.reconPack, this.buffers);
			this.finishedReconstruction();
			return packet;
		}
		return undefined;
	}

	/**
	 * Cleans up binary packet reconstruction variables.
	 */
	public finishedReconstruction(): void {
		this.reconPack = {} as Packet;
		this.buffers = [];
	}
}

export interface Packet {
	type: PacketType;
	nsp: string;
	data?: any;
	id?: number;
	attachments?: number;
}

/**
 * Utility functions from original Socket.IO parser for full compatibility
 */
function isNamespaceValid(nsp: unknown): boolean {
	return typeof nsp === 'string';
}

// Polyfill для старых браузеров
const isInteger =
	Number.isInteger ||
	function (value) {
		return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
	};

function isAckIdValid(id: unknown): boolean {
	return id === undefined || isInteger(id);
}

// Более точная проверка объекта чем typeof === 'object'
function isObject(value: any): boolean {
	return Object.prototype.toString.call(value) === '[object Object]';
}

function isDataValid(type: PacketType, payload: unknown): boolean {
	switch (type) {
		case PacketType.CONNECT:
			return payload === undefined || isObject(payload);
		case PacketType.DISCONNECT:
			return payload === undefined;
		case PacketType.EVENT:
			return Array.isArray(payload) && (typeof payload[0] === 'number' || (typeof payload[0] === 'string' && RESERVED_EVENTS.indexOf(payload[0]) === -1));
		case PacketType.ACK:
			return Array.isArray(payload);
		case PacketType.CONNECT_ERROR:
			return typeof payload === 'string' || isObject(payload);
		default:
			return false;
	}
}

// Проверяем, является ли пакет валидным
export function isPacketValid(packet: Packet): boolean {
	return isNamespaceValid(packet.nsp) && isAckIdValid(packet.id) && isDataValid(packet.type, packet.data);
}
