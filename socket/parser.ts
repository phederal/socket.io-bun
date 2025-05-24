import { encode, decode } from '@msgpack/msgpack';
import type {
	SocketPacketFromClient,
	SocketPacketToClient,
	ClientToServerEvents,
	ServerToClientEvents,
} from '../shared/types/socket.types';

/**
 * Оптимизированный Socket.IO парсер с кешированием
 */
export class SocketParser {
	private static ackCounter = 1000;
	private static packetCache = new Map<string, string>();
	private static readonly isProduction = process.env.NODE_ENV === 'production';

	/**
	 * Generate unique acknowledgement ID (оптимизированный)
	 */
	static generateAckId(): string {
		return (++this.ackCounter).toString();
	}

	/**
	 * Быстрое кодирование пакета с кешированием
	 */
	static encode<T extends keyof ServerToClientEvents>(
		event: T,
		data?: Parameters<ServerToClientEvents[T]>[0],
		ackId?: string,
		namespace: string = '/'
	): string {
		// Handle ping/pong (Engine.IO level)
		if (event === ('ping' as any)) return '2';
		if (event === ('pong' as any)) return '3';

		// Создаем ключ для кеша (только для событий без данных и ACK)
		const cacheKey = !data && !ackId ? `${namespace}:${event}` : null;

		if (cacheKey && this.packetCache.has(cacheKey)) {
			return this.packetCache.get(cacheKey)!;
		}

		let packet = '42'; // Engine.IO message + Socket.IO EVENT

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		// Add ack ID if present
		if (ackId) {
			packet += ackId;
		}

		// Create payload - используем прямое создание строки вместо JSON.stringify для простых случаев
		if (data === undefined) {
			// Простое событие без данных
			packet += `["${event}"]`;
		} else if (typeof data === 'string') {
			// Строковые данные - оптимизируем
			packet += `["${event}","${data.replace(/"/g, '\\"')}"]`;
		} else {
			// Сложные данные - используем JSON.stringify
			const payload = [event, data];
			packet += JSON.stringify(payload);
		}

		// Кешируем простые пакеты
		if (cacheKey) {
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
	 * Быстрое кодирование ACK ответа
	 */
	static encodeAckResponse(ackId: string, data: any[], namespace: string = '/'): string {
		let packet = '43'; // Engine.IO message + Socket.IO ACK

		if (namespace !== '/') {
			packet += namespace + ',';
		}

		packet += ackId;

		// Оптимизируем для простых случаев
		if (data.length === 0) {
			packet += '[]';
		} else if (data.length === 1 && typeof data[0] === 'string') {
			packet += `["${data[0].replace(/"/g, '\\"')}"]`;
		} else {
			packet += JSON.stringify(data);
		}

		if (!this.isProduction) {
			console.log(`[SocketParser] Encoded ACK response: ${packet}`);
		}
		return packet;
	}

	/**
	 * Encode namespace connect packet
	 */
	static encodeConnect(namespace: string = '/', data?: any): string {
		let packet = '40';

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
		let packet = '41';

		if (namespace !== '/') {
			packet += namespace + ',';
		}

		if (!this.isProduction) {
			console.log(`[SocketParser] Encoded disconnect packet: ${packet}`);
		}
		return packet;
	}

	/**
	 * Быстрое декодирование (оптимизированное)
	 */
	static async decode(
		raw: string | ArrayBuffer | Blob | ArrayBufferView
	): Promise<SocketPacketFromClient | null> {
		try {
			let message: string;

			// Быстрая обработка строк
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
				console.warn('[SocketParser] Decode error:', error);
			}
			return null;
		}
	}

	/**
	 * Оптимизированный парсер пакетов
	 */
	private static parseSocketIOPacket(message: string): SocketPacketFromClient | null {
		if (!message || message.length < 1) {
			return null;
		}

		// Быстрая обработка одиночных символов
		if (message.length === 1) {
			const engineType = parseInt(message[0]);
			return engineType === 2
				? { event: 'ping' as any }
				: engineType === 3
				? { event: 'pong' as any }
				: null;
		}

		const engineType = parseInt(message[0]);

		// Быстрая проверка Engine.IO пакетов
		if (engineType === 2) return { event: 'ping' as any };
		if (engineType === 3) return { event: 'pong' as any };
		if (engineType !== 4) return null;

		if (message.length < 2) return null;

		const socketType = parseInt(message[1]);
		let offset = 2;
		let namespace = '/';
		let ackId: string | undefined;

		// Быстрый парсинг namespace
		if (message[offset] === '/') {
			const commaIndex = message.indexOf(',', offset);
			if (commaIndex !== -1) {
				namespace = message.slice(offset, commaIndex);
				offset = commaIndex + 1;
			}
		}

		// Быстрый парсинг ACK ID
		if (
			socketType === 3 ||
			(socketType === 2 && message[offset] >= '0' && message[offset] <= '9')
		) {
			let endOffset = offset;
			while (
				endOffset < message.length &&
				message[endOffset] >= '0' &&
				message[endOffset] <= '9'
			) {
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

		// Обработка типов пакетов
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
	 * Очистка кеша (для отладки)
	 */
	static clearCache(): void {
		this.packetCache.clear();
	}
}
