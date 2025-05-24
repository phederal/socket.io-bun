// Создать новый файл: socket/object-pool.ts

import { BinaryProtocol, SocketParser } from './parser';

/**
 * Object Pool для переиспользования часто создаваемых объектов
 */

export interface PooledPacket {
	event: string;
	data?: any;
	ackId?: string;
	namespace?: string;
	reset(): void;
}

export interface PooledAckResponse {
	ackId: string;
	data: any[];
	namespace: string;
	reset(): void;
}

class PacketObject implements PooledPacket {
	event: string = '';
	data?: any;
	ackId?: string;
	namespace?: string;

	reset(): void {
		this.event = '';
		this.data = undefined;
		this.ackId = undefined;
		this.namespace = undefined;
	}
}

class AckResponseObject implements PooledAckResponse {
	ackId: string = '';
	data: any[] = [];
	namespace: string = '/';

	reset(): void {
		this.ackId = '';
		this.data = [];
		this.namespace = '/';
	}
}

/**
 * Generic Object Pool
 */
class ObjectPool<T extends { reset(): void }> {
	private pool: T[] = [];
	private createFn: () => T;
	private maxSize: number;

	constructor(createFn: () => T, maxSize: number = 1000) {
		this.createFn = createFn;
		this.maxSize = maxSize;

		// Предварительно создаем объекты
		for (let i = 0; i < Math.min(100, maxSize); i++) {
			this.pool.push(createFn());
		}
	}

	/**
	 * Получить объект из pool
	 */
	acquire(): T {
		const obj = this.pool.pop();
		if (obj) {
			obj.reset();
			return obj;
		}
		return this.createFn();
	}

	/**
	 * Вернуть объект в pool
	 */
	release(obj: T): void {
		if (this.pool.length < this.maxSize) {
			obj.reset();
			this.pool.push(obj);
		}
	}

	/**
	 * Получить статистику pool
	 */
	getStats() {
		return {
			available: this.pool.length,
			maxSize: this.maxSize,
		};
	}
}

/**
 * Глобальные pools
 */
export const packetPool = new ObjectPool<PooledPacket>(() => new PacketObject(), 1000);
export const ackResponsePool = new ObjectPool<PooledAckResponse>(
	() => new AckResponseObject(),
	500
);

/**
 * String Pool для переиспользования строк
 */
class StringPool {
	private pool = new Map<string, string[]>();
	private readonly maxPerKey = 50;

	/**
	 * Получить строку из pool или создать новую
	 */
	acquire(template: string, ...args: (string | number)[]): string {
		const key = template;
		const pooled = this.pool.get(key);

		if (pooled && pooled.length > 0) {
			const str = pooled.pop()!;
			// Заменяем плейсхолдеры
			return this.fillTemplate(str, template, ...args);
		}

		return this.fillTemplate(template, template, ...args);
	}

	/**
	 * Вернуть строку в pool (только для template строк)
	 */
	release(template: string, str: string): void {
		const pooled = this.pool.get(template);

		if (!pooled) {
			this.pool.set(template, [str]);
		} else if (pooled.length < this.maxPerKey) {
			pooled.push(str);
		}
	}

	private fillTemplate(str: string, template: string, ...args: (string | number)[]): string {
		// Простая замена для шаблонов типа "42[\"${event}\",\"${data}\"]"
		let result = str;
		args.forEach((arg, index) => {
			result = result.replace(`\${${index}}`, String(arg));
		});
		return result;
	}
}

export const stringPool = new StringPool();

/**
 * Buffer Pool для переиспользования буферов
 */
class BufferPool {
	private pools = new Map<number, Uint8Array[]>();
	private readonly maxPerSize = 20;

	/**
	 * Получить buffer нужного размера
	 */
	acquire(size: number): Uint8Array {
		// Округляем до ближайшей степени 2 для лучшего переиспользования
		const poolSize = Math.pow(2, Math.ceil(Math.log2(size)));
		const pool = this.pools.get(poolSize);

		if (pool && pool.length > 0) {
			return pool.pop()!;
		}

		return new Uint8Array(poolSize);
	}

	/**
	 * Вернуть buffer в pool
	 */
	release(buffer: Uint8Array): void {
		const size = buffer.length;
		let pool = this.pools.get(size);

		if (!pool) {
			pool = [];
			this.pools.set(size, pool);
		}

		if (pool.length < this.maxPerSize) {
			// Очищаем buffer перед возвратом
			buffer.fill(0);
			pool.push(buffer);
		}
	}

	/**
	 * Статистика pools
	 */
	getStats() {
		const stats: Record<number, number> = {};
		this.pools.forEach((pool, size) => {
			stats[size] = pool.length;
		});
		return stats;
	}
}

export const bufferPool = new BufferPool();

/**
 * Утилиты для работы с pools
 */
export class PoolManager {
	/**
	 * Получить статистику всех pools
	 */
	static getAllStats() {
		return {
			packets: packetPool.getStats(),
			ackResponses: ackResponsePool.getStats(),
			buffers: bufferPool.getStats(),
		};
	}

	/**
	 * Очистить все pools (для тестирования/дебага)
	 */
	static clearAll() {
		// Pools очистятся автоматически при garbage collection
		console.log('Pool cleanup requested');
	}
}

/**
 * Binary Protocol для сверх-быстрой передачи простых событий
 */

// Предопределенные коды событий (1 байт вместо строки)
export enum BinaryEventCode {
	PING = 0x01,
	PONG = 0x02,
	MESSAGE = 0x03,
	NOTIFICATION = 0x04,
	USER_JOINED = 0x05,
	USER_LEFT = 0x06,
	TYPING_START = 0x07,
	TYPING_STOP = 0x08,
	ROOM_JOINED = 0x09,
	ROOM_LEFT = 0x0a,
	// Можно добавить до 255 событий
}

// Reverse mapping для декодирования
const BINARY_EVENT_NAMES: Record<number, string> = {
	[BinaryEventCode.PING]: 'ping',
	[BinaryEventCode.PONG]: 'pong',
	[BinaryEventCode.MESSAGE]: 'message',
	[BinaryEventCode.NOTIFICATION]: 'notification',
	[BinaryEventCode.USER_JOINED]: 'user_joined',
	[BinaryEventCode.USER_LEFT]: 'user_left',
	[BinaryEventCode.TYPING_START]: 'typing_start',
	[BinaryEventCode.TYPING_STOP]: 'typing_stop',
	[BinaryEventCode.ROOM_JOINED]: 'room_joined',
	[BinaryEventCode.ROOM_LEFT]: 'room_left',
};

const EVENT_TO_BINARY: Record<string, number> = {
	ping: BinaryEventCode.PING,
	pong: BinaryEventCode.PONG,
	message: BinaryEventCode.MESSAGE,
	notification: BinaryEventCode.NOTIFICATION,
	user_joined: BinaryEventCode.USER_JOINED,
	user_left: BinaryEventCode.USER_LEFT,
	typing_start: BinaryEventCode.TYPING_START,
	typing_stop: BinaryEventCode.TYPING_STOP,
	room_joined: BinaryEventCode.ROOM_JOINED,
	room_left: BinaryEventCode.ROOM_LEFT,
};

/**
 * Бинарное кодирование для простых событий
 */
export class BinaryProtocol {
	// Magic bytes для идентификации бинарного протокола
	private static readonly MAGIC_BYTE = 0xff;
	private static readonly VERSION = 0x01;

	/**
	 * Кодирование простого события в бинарный формат
	 * Формат: [0xFF][VERSION][EVENT_CODE][DATA_LENGTH][DATA]
	 */
	static encodeBinaryEvent(event: string, data?: string | number): Uint8Array | null {
		const eventCode = EVENT_TO_BINARY[event];
		if (eventCode === undefined) {
			return null; // Событие не поддерживается в бинарном формате
		}

		if (!data) {
			// Событие без данных - всего 3 байта
			return new Uint8Array([this.MAGIC_BYTE, this.VERSION, eventCode]);
		}

		if (typeof data === 'string') {
			const dataBytes = new TextEncoder().encode(data);
			const result = new Uint8Array(4 + dataBytes.length);
			result[0] = this.MAGIC_BYTE;
			result[1] = this.VERSION;
			result[2] = eventCode;
			result[3] = dataBytes.length;
			result.set(dataBytes, 4);
			return result;
		}

		if (typeof data === 'number') {
			const result = new Uint8Array(8);
			const view = new DataView(result.buffer);
			view.setUint8(0, this.MAGIC_BYTE);
			view.setUint8(1, this.VERSION);
			view.setUint8(2, eventCode);
			view.setUint8(3, 4); // Длина числа
			view.setFloat32(4, data, true); // little-endian
			return result;
		}

		return null;
	}

	/**
	 * Декодирование бинарного события
	 */
	static decodeBinaryEvent(data: Uint8Array): { event: string; data?: any } | null {
		if (data.length < 3) return null;
		if (data[0] !== this.MAGIC_BYTE) return null;
		if (data[1] !== this.VERSION) return null;

		const eventCode = data[2];
		const eventName = BINARY_EVENT_NAMES[eventCode];
		if (!eventName) return null;

		if (data.length === 3) {
			// Событие без данных
			return { event: eventName };
		}

		if (data.length < 4) return null;
		const dataLength = data[3];

		if (data.length < 4 + dataLength) return null;

		// Декодируем данные
		if (eventCode === BinaryEventCode.MESSAGE || eventCode === BinaryEventCode.NOTIFICATION) {
			// Строковые данные
			const dataBytes = data.slice(4, 4 + dataLength);
			const stringData = new TextDecoder().decode(dataBytes);
			return { event: eventName, data: stringData };
		} else {
			// Числовые данные
			const view = new DataView(data.buffer, 4, 4);
			const numberData = view.getFloat32(0, true);
			return { event: eventName, data: numberData };
		}
	}

	/**
	 * Проверка, является ли данные бинарным протоколом
	 */
	static isBinaryProtocol(data: Uint8Array | string): boolean {
		if (typeof data === 'string') return false;
		return data.length >= 3 && data[0] === this.MAGIC_BYTE && data[1] === this.VERSION;
	}

	/**
	 * Проверка, поддерживается ли событие в бинарном формате
	 */
	static supportsBinaryEncoding(event: string): boolean {
		return EVENT_TO_BINARY[event] !== undefined;
	}
}
