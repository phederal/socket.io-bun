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
 * Warm-up функция для инициализации всех pools и кешей
 */
export function warmupPerformanceOptimizations(): void {
	console.log('🔥 Warming up performance optimizations...');

	// Предварительно создаем объекты в pools
	for (let i = 0; i < 100; i++) {
		const packet = packetPool.acquire();
		const ackResponse = ackResponsePool.acquire();
		packetPool.release(packet);
		ackResponsePool.release(ackResponse);
	}

	// Прогреваем кеши парсера
	SocketParser.encodeSimpleEvent('test', '/');
	SocketParser.encodeStringEvent('test', 'warmup', '/');

	// Прогреваем binary protocol
	BinaryProtocol.encodeBinaryEvent('ping');
	BinaryProtocol.encodeBinaryEvent('message', 'test');

	console.log('✅ Performance optimizations warmed up!');
	console.log('📊 Pool stats:', PoolManager.getAllStats());
}
