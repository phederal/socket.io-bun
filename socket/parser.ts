import { encode, decode } from '@msgpack/msgpack';
import type {
	SocketPacketFromClient,
	SocketPacketToClient,
	ClientToServerEvents,
	ServerToClientEvents,
} from '../shared/types/socket.types';

// ИСПРАВЛЕНИЕ: Lazy loading для избежания циклических импортов
function getBinaryProtocol() {
	try {
		const { BinaryProtocol } = require('./object-pool');
		return BinaryProtocol;
	} catch {
		return {
			supportsBinaryEncoding: () => false,
			encodeBinaryEvent: () => null,
			decodeBinaryEvent: () => null,
			isBinaryProtocol: () => false,
		};
	}
}

/**
 * Высоко-оптимизированный Socket.IO парсер с микро-оптимизациями
 */
export class SocketParser {
	private static ackCounter = 1000;
	private static packetCache = new Map<string, string>();
	private static simplePacketCache = new Map<string, string>(); // Новый кеш для простых пакетов
	private static readonly isProduction = process.env.NODE_ENV === 'production';

	// Предварительно скомпилированные константы для быстрого доступа
	private static readonly PING_PACKET = '2';
	private static readonly PONG_PACKET = '3';
	private static readonly ENGINE_MESSAGE = '4';
	private static readonly SOCKET_EVENT = '42';
	private static readonly SOCKET_ACK = '43';
	private static readonly SOCKET_CONNECT = '40';
	private static readonly SOCKET_DISCONNECT = '41';

	/**
	 * Прекомпилированные пакеты для частых событий
	 */
	private static readonly PRECOMPILED_PACKETS = {
		ping: '42["ping"]',
		pong: '42["pong"]',
		connect: '42["connect"]',
		disconnect: '42["disconnect"]',
	} as const;

	/**
	 * Generate unique acknowledgement ID (оптимизированный)
	 */
	static generateAckId(): string {
		return (++this.ackCounter).toString();
	}

	/**
	 * Сверх-быстрое кодирование для простых событий без данных
	 */
	static encodeSimpleEvent(event: string, namespace: string = '/'): string {
		const cacheKey = `${namespace}:${event}`;

		if (this.simplePacketCache.has(cacheKey)) {
			return this.simplePacketCache.get(cacheKey)!;
		}

		let packet = this.SOCKET_EVENT;
		if (namespace !== '/') {
			packet += namespace + ',';
		}
		packet += `["${event}"]`;

		this.simplePacketCache.set(cacheKey, packet);
		return packet;
	}

	/**
	 * Сверх-быстрое кодирование для строковых данных
	 */
	static encodeStringEvent(event: string, data: string, namespace: string = '/'): string {
		let packet = this.SOCKET_EVENT;
		if (namespace !== '/') {
			packet += namespace + ',';
		}
		// Прямое создание строки без JSON.stringify для производительности
		packet += `["${event}","${data.replace(/"/g, '\\"')}"]`;
		return packet;
	}

	/**
	 * Instant encode для максимальной скорости
	 */
	static encodeInstant(event: string): string {
		if (event in this.PRECOMPILED_PACKETS) {
			return this.PRECOMPILED_PACKETS[event as keyof typeof this.PRECOMPILED_PACKETS];
		}
		return `42["${event}"]`;
	}

	/**
	 * Быстрое кодирование строковых событий
	 */
	static encodeStringInstant(event: string, data: string): string {
		const escaped = data.includes('"') ? data.replace(/"/g, '\\"') : data;
		return `42["${event}","${escaped}"]`;
	}

	/**
	 * Batch создание пакетов для предварительной компиляции
	 */
	static precompilePackets(events: Array<{ event: string; data?: any }>): string[] {
		const packets: string[] = [];
		for (const { event, data } of events) {
			if (!data) {
				packets.push(this.encodeInstant(event));
			} else if (typeof data === 'string') {
				packets.push(this.encodeStringInstant(event, data));
			} else if (typeof data === 'number') {
				packets.push(`42["${event}",${data}]`);
			} else {
				packets.push(this.encode(event as any, data));
			}
		}
		return packets;
	}

	/**
	 * Быстрое кодирование пакета с кешированием (улучшенное)
	 */
	static encode<T extends keyof ServerToClientEvents>(
		event: T,
		data?: Parameters<ServerToClientEvents[T]>[0],
		ackId?: string,
		namespace: string = '/'
	): string {
		// Handle ping/pong (Engine.IO level) - fastest path
		if (event === ('ping' as any)) return this.PING_PACKET;
		if (event === ('pong' as any)) return this.PONG_PACKET;

		// Быстрый путь для простых событий без данных и ACK
		if (!data && !ackId) {
			return this.encodeSimpleEvent(event as string, namespace);
		}

		// Быстрый путь для строковых данных без ACK
		if (typeof data === 'string' && !ackId) {
			return this.encodeStringEvent(event as string, data, namespace);
		}

		// Создаем ключ для кеша (только для событий без ACK)
		const cacheKey = !ackId ? `${namespace}:${event}:${typeof data}` : null;

		if (cacheKey && this.packetCache.has(cacheKey)) {
			const cached = this.packetCache.get(cacheKey)!;
			// Для кешированных пакетов с данными, заменяем данные
			if (typeof data === 'string') {
				return cached.replace('__DATA__', data.replace(/"/g, '\\"'));
			}
			return cached;
		}

		let packet = this.SOCKET_EVENT; // Используем константу

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		// Add ack ID if present
		if (ackId) {
			packet += ackId;
		}

		// Create payload - используем прямое создание строки для простых случаев
		if (data === undefined) {
			// Простое событие без данных
			packet += `["${event}"]`;
		} else if (typeof data === 'string') {
			// Строковые данные - оптимизируем
			const escaped = data.replace(/"/g, '\\"');
			packet += `["${event}","${escaped}"]`;

			// Кешируем с плейсхолдером для будущего переиспользования
			if (cacheKey) {
				const cacheablePacket = packet.replace(`"${escaped}"`, '"__DATA__"');
				this.packetCache.set(cacheKey, cacheablePacket);
			}
		} else if (typeof data === 'number') {
			// Числовые данные
			packet += `["${event}",${data}]`;
		} else if (typeof data === 'boolean') {
			// Boolean данные
			packet += `["${event}",${data}]`;
		} else {
			// Сложные данные - используем JSON.stringify
			const payload = [event, data];
			packet += JSON.stringify(payload);
		}

		// Кешируем простые пакеты
		if (cacheKey && typeof data !== 'object') {
			this.packetCache.set(cacheKey, packet);
		}

		if (!this.isProduction) {
			console.log(
				`[SocketParser] Encoded packet for event '${event}' with ACK ID '${ackId}':`,
				packet
			);
		}

		return packet;
	}

	/**
	 * НОВЫЙ: Кодирование с принудительным использованием бинарного формата
	 */
	static encodeBinary<T extends keyof ServerToClientEvents>(
		event: T,
		data?: Parameters<ServerToClientEvents[T]>[0],
		namespace: string = '/'
	): Uint8Array | null {
		// Только для дефолтного namespace и поддерживаемых событий
		if (namespace !== '/') return null;

		const BinaryProtocol = getBinaryProtocol();
		if (!BinaryProtocol.supportsBinaryEncoding(event as string)) return null;

		return BinaryProtocol.encodeBinaryEvent(event as string, data as string | number);
	}

	/**
	 * Сверх-быстрое кодирование ACK ответа (оптимизированное)
	 */
	static encodeAckResponse(ackId: string, data: any[], namespace: string = '/'): string {
		let packet = this.SOCKET_ACK; // Используем константу

		if (namespace !== '/') {
			packet += namespace + ',';
		}

		packet += ackId;

		// Микро-оптимизации для частых случаев
		if (data.length === 0) {
			packet += '[]';
		} else if (data.length === 1) {
			const item = data[0];
			if (typeof item === 'string') {
				packet += `["${item.replace(/"/g, '\\"')}"]`;
			} else if (typeof item === 'number') {
				packet += `[${item}]`;
			} else if (typeof item === 'boolean') {
				packet += `[${item}]`;
			} else if (item === null) {
				packet += '[null]';
			} else {
				packet += JSON.stringify(data);
			}
		} else {
			packet += JSON.stringify(data);
		}

		if (!this.isProduction) {
			console.log(`[SocketParser] Encoded ACK response: ${packet}`);
		}
		return packet;
	}

	/**
	 * Оптимизированное кодирование ACK ответа
	 */
	static encodeAckResponseFast(ackId: string, data: any): string {
		if (data === undefined || data === null) {
			return `43${ackId}[]`;
		}
		if (typeof data === 'string') {
			return `43${ackId}["${data.replace(/"/g, '\\"')}"]`;
		}
		if (typeof data === 'number' || typeof data === 'boolean') {
			return `43${ackId}[${data}]`;
		}
		return `43${ackId}${JSON.stringify([data])}`;
	}
	/**
	 * Encode namespace connect packet
	 */
	static encodeConnect(namespace: string = '/', data?: any): string {
		let packet = this.SOCKET_CONNECT; // Используем константу

		if (namespace !== '/') {
			packet += namespace + ',';
		}

		if (data) {
			packet += JSON.stringify(data);
		}

		if (!this.isProduction) {
			console.log(`[SocketParser] Encoded connect packet: ${packet}`);
		}
		return packet;
	}

	/**
	 * Encode namespace disconnect packet
	 */
	static encodeDisconnect(namespace: string = '/'): string {
		let packet = this.SOCKET_DISCONNECT; // Используем константу

		if (namespace !== '/') {
			packet += namespace + ',';
		}

		if (!this.isProduction) {
			console.log(`[SocketParser] Encoded disconnect packet: ${packet}`);
		}
		return packet;
	}

	/**
	 * Основной метод декодирования (входная точка)
	 */
	static async decode(
		raw: string | ArrayBuffer | Blob | ArrayBufferView
	): Promise<SocketPacketFromClient | null> {
		try {
			// Сначала пробуем бинарное декодирование для non-string данных
			if (typeof raw !== 'string') {
				const binaryResult = await this.decodeBinary(raw);
				if (binaryResult) {
					return binaryResult;
				}
			}

			// Если не бинарное или не удалось декодировать как бинарное, пробуем обычное
			return await this.decodeRegular(raw);
		} catch (error) {
			if (!this.isProduction) {
				console.warn('[SocketParser] Decode error:', error);
			}
			return null;
		}
	}

	/**
	 * Декодирование обычных Socket.IO пакетов
	 */
	static async decodeRegular(
		raw: string | ArrayBuffer | Blob | ArrayBufferView
	): Promise<SocketPacketFromClient | null> {
		try {
			let message: string;

			// Быстрый путь для строк
			if (typeof raw === 'string') {
				message = raw;
			} else if (raw instanceof ArrayBuffer) {
				message = new TextDecoder().decode(raw);
			} else if (raw instanceof Blob) {
				message = await raw.text();
			} else if (ArrayBuffer.isView(raw)) {
				const view = raw as ArrayBufferView;
				message = new TextDecoder().decode(
					new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
				);
			} else {
				return null;
			}

			if (!this.isProduction) {
				console.log(`[SocketParser] Decoding message: ${message}`);
			}
			return this.parseSocketIOPacket(message);
		} catch (error) {
			if (!this.isProduction) {
				console.warn('[SocketParser] Regular decode error:', error);
			}
			return null;
		}
	}

	/**
	 * Декодирование бинарных данных
	 */
	static async decodeBinary(
		raw: ArrayBuffer | Blob | ArrayBufferView
	): Promise<SocketPacketFromClient | null> {
		try {
			let data: Uint8Array;

			// Преобразуем в Uint8Array
			if (raw instanceof ArrayBuffer) {
				data = new Uint8Array(raw);
			} else if (raw instanceof Blob) {
				const arrayBuffer = await raw.arrayBuffer();
				data = new Uint8Array(arrayBuffer);
			} else if (ArrayBuffer.isView(raw)) {
				const view = raw as ArrayBufferView;
				data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
			} else {
				return null;
			}

			// Проверяем, является ли это бинарным протоколом
			const BinaryProtocol = getBinaryProtocol();
			if (BinaryProtocol.isBinaryProtocol(data)) {
				const decoded = BinaryProtocol.decodeBinaryEvent(data);
				if (decoded) {
					return {
						event: decoded.event as any,
						data: decoded.data,
						namespace: '/',
					};
				}
			}

			// Если не бинарный протокол, возвращаем null
			return null;
		} catch (error) {
			if (!this.isProduction) {
				console.warn('[SocketParser] Binary decode error:', error);
			}
			return null;
		}
	}

	/**
	 * Сверх-оптимизированный парсер пакетов
	 */
	private static parseSocketIOPacket(message: string): SocketPacketFromClient | null {
		if (!message || message.length < 1) {
			return null;
		}

		// Сверх-быстрая обработка одиночных символов
		const firstChar = message.charCodeAt(0);
		if (message.length === 1) {
			// Используем charCodeAt для быстрого сравнения
			return firstChar === 50
				? { event: 'ping' as any } // '2'
				: firstChar === 51
				? { event: 'pong' as any } // '3'
				: null;
		}

		// Быстрая проверка Engine.IO пакетов
		if (firstChar === 50) return { event: 'ping' as any }; // '2'
		if (firstChar === 51) return { event: 'pong' as any }; // '3'
		if (firstChar !== 52) return null; // '4'

		if (message.length < 2) return null;

		const secondChar = message.charCodeAt(1);
		const socketType = secondChar - 48; // Быстрое преобразование char в число
		let offset = 2;
		let namespace = '/';
		let ackId: string | undefined;

		// Быстрый парсинг namespace
		if (message.charCodeAt(offset) === 47) {
			// '/'
			const commaIndex = message.indexOf(',', offset);
			if (commaIndex !== -1) {
				namespace = message.slice(offset, commaIndex);
				offset = commaIndex + 1;
			}
		}

		// Быстрый парсинг ACK ID с использованием charCodeAt
		if (
			socketType === 3 ||
			(socketType === 2 &&
				message.charCodeAt(offset) >= 48 &&
				message.charCodeAt(offset) <= 57)
		) {
			let endOffset = offset;
			// Быстрое нахождение конца числа
			while (endOffset < message.length) {
				const charCode = message.charCodeAt(endOffset);
				if (charCode < 48 || charCode > 57) break; // Не цифра
				endOffset++;
			}
			if (endOffset > offset) {
				ackId = message.slice(offset, endOffset);
				offset = endOffset;
				if (!this.isProduction) {
					console.log(`[SocketParser] Parsed ACK ID: ${ackId} from message: ${message}`);
				}
			}
		}

		// Быстрый парсинг payload
		const payloadStr = message.slice(offset);
		let payload: any[] = [];

		if (payloadStr) {
			try {
				payload = JSON.parse(payloadStr);
				if (!Array.isArray(payload)) {
					payload = [payload];
				}
			} catch (error) {
				if (!this.isProduction) {
					console.warn('[SocketParser] Failed to parse payload:', payloadStr);
				}
				return null;
			}
		}

		// Быстрая обработка типов пакетов
		switch (socketType) {
			case 0:
				return { event: '__connect', namespace, data: payload[0] };
			case 1:
				return { event: '__disconnect', namespace };
			case 2:
				if (payload.length < 1) return null;
				return { event: payload[0], data: payload[1], ackId, namespace };
			case 3:
				return { event: '__ack', ackId, data: payload, namespace };
			default:
				return null;
		}
	}

	/**
	 * Create Engine.IO handshake response (v4.x compatible)
	 */
	static createHandshakeResponse(sid: string): string {
		const handshake = {
			sid,
			upgrades: [],
			pingInterval: 25000,
			pingTimeout: 20000,
			maxPayload: 1000000,
		};
		const response = '0' + JSON.stringify(handshake);
		if (!this.isProduction) {
			console.log(`[SocketParser] Created handshake response: ${response}`);
		}
		return response;
	}

	/**
	 * Generate unique session ID
	 */
	static generateSessionId(): string {
		return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Validate packet structure
	 */
	static isValidPacket(packet: any): packet is SocketPacketFromClient {
		return (
			packet &&
			typeof packet === 'object' &&
			typeof packet.event === 'string' &&
			packet.event.length > 0
		);
	}

	/**
	 * Очистка кешей (для отладки/сброса)
	 */
	static clearCache(): void {
		this.packetCache.clear();
		this.simplePacketCache.clear();
	}

	/**
	 * Получить статистику кешей
	 */
	static getCacheStats() {
		return {
			packetCacheSize: this.packetCache.size,
			simpleCacheSize: this.simplePacketCache.size,
			ackCounter: this.ackCounter,
		};
	}

	/**
	 * УДАЛЕНО: tryEncodeBinary - теперь используется только encodeBinary()
	 * Бинарное кодирование происходит только по явному вызову
	 */
}
