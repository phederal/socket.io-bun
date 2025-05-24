import { encode, decode } from '@msgpack/msgpack';
import type {
	SocketPacketFromClient,
	SocketPacketToClient,
	ClientToServerEvents,
	ServerToClientEvents,
} from '../shared/types/socket.types';

/**
 * Socket.IO compatible packet encoder/decoder
 * Точно соответствует формату Socket.IO v4.x
 */
export class SocketParser {
	/**
	 * Encode a packet for transmission to client (Socket.IO format)
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

		let packet = '4'; // Engine.IO message packet
		packet += '2'; // Socket.IO EVENT packet

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		// Add ack ID if present (BEFORE payload for EVENT packets)
		if (ackId) {
			packet += ackId;
		}

		// Create payload array - EVENT format: [eventName] or [eventName, data]
		let payload: any[] = data !== undefined ? [event, data] : [event];

		packet += JSON.stringify(payload);

		// Логирование только в development режиме
		if (process.env.NODE_ENV === 'development') {
			console.log(
				`[SocketParser] Encoded packet for event '${event}' with ACK ID '${ackId}':`,
				packet
			);
		}
		return packet;
	}

	/**
	 * Encode acknowledgment response (Socket.IO format)
	 */
	static encodeAckResponse(ackId: string, data: any[], namespace: string = '/'): string {
		let packet = '43'; // Engine.IO message + Socket.IO ACK

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		packet += ackId;

		// ACK response format: [responseData] or [responseData1, responseData2, ...]
		// Если данных нет, отправляем пустой массив
		const payload = data && data.length > 0 ? data : [];
		packet += JSON.stringify(payload);

		if (process.env.NODE_ENV === 'development') {
			console.log(`[SocketParser] Encoded ACK response: ${packet}`);
		}
		return packet;
	}

	/**
	 * Encode namespace connect packet
	 */
	static encodeConnect(namespace: string = '/', data?: any): string {
		let packet = '40'; // Engine.IO message + Socket.IO CONNECT

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		// Add connect data if present - для Socket.IO v4 должен содержать объект с sid
		if (data) {
			packet += JSON.stringify(data);
		}

		if (process.env.NODE_ENV === 'development') {
			console.log(`[SocketParser] Encoded connect packet: ${packet}`);
		}
		return packet;
	}

	/**
	 * Encode namespace disconnect packet
	 */
	static encodeDisconnect(namespace: string = '/'): string {
		let packet = '41'; // Engine.IO message + Socket.IO DISCONNECT

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		if (process.env.NODE_ENV === 'development') {
			console.log(`[SocketParser] Encoded disconnect packet: ${packet}`);
		}
		return packet;
	}

	/**
	 * Decode incoming packet from client (Socket.IO format)
	 */
	static async decode(
		raw: string | ArrayBuffer | Blob | ArrayBufferView
	): Promise<SocketPacketFromClient | null> {
		try {
			let message: string;

			// Handle different input types
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
				console.warn('[SocketParser] Unsupported data format:', typeof raw);
				return null;
			}

			if (process.env.NODE_ENV === 'development') {
				console.log(`[SocketParser] Decoding message: ${message}`);
			}
			return SocketParser.parseSocketIOPacket(message);
		} catch (error) {
			console.warn('[SocketParser] Decode error:', error);
			return null;
		}
	}

	/**
	 * Parse Socket.IO packet format
	 */
	private static parseSocketIOPacket(message: string): SocketPacketFromClient | null {
		if (!message || message.length < 1) {
			return null;
		}

		// Handle single character Engine.IO packets
		if (message.length === 1) {
			const engineType = parseInt(message[0]);
			if (engineType === 2) {
				return { event: 'ping' as any };
			}
			if (engineType === 3) {
				return { event: 'pong' as any };
			}
			return null;
		}

		const engineType = parseInt(message[0]);

		// Handle Engine.IO packets
		if (engineType === 2) {
			return { event: 'ping' as any };
		}
		if (engineType === 3) {
			return { event: 'pong' as any };
		}
		if (engineType !== 4) {
			console.warn(
				'[SocketParser] Unknown Engine.IO packet type:',
				engineType,
				'message:',
				message
			);
			return null;
		}

		// Parse Socket.IO packet type
		if (message.length < 2) {
			console.warn('[SocketParser] Invalid Socket.IO packet: too short');
			return null;
		}

		const socketType = parseInt(message[1]);
		let offset = 2;
		let namespace = '/';
		let ackId: string | undefined;

		// Parse namespace
		if (message[offset] === '/') {
			const commaIndex = message.indexOf(',', offset);
			if (commaIndex !== -1) {
				namespace = message.slice(offset, commaIndex);
				offset = commaIndex + 1;
			}
		}

		// Parse ack ID for ACK and EVENT with ack
		if (socketType === 3 || (socketType === 2 && /^\d+/.test(message.slice(offset)))) {
			const match = message.slice(offset).match(/^(\d+)/);
			if (match) {
				ackId = match[1];
				offset += match[1].length;
				if (process.env.NODE_ENV === 'development') {
					console.log(`[SocketParser] Parsed ACK ID: ${ackId} from message: ${message}`);
				}
			}
		}

		// Parse payload
		const payloadStr = message.slice(offset);
		let payload: any[] = [];

		if (payloadStr) {
			try {
				payload = JSON.parse(payloadStr);
				if (!Array.isArray(payload)) {
					payload = [payload];
				}
			} catch (error) {
				console.warn(
					'[SocketParser] Failed to parse payload:',
					payloadStr,
					'error:',
					error
				);
				return null;
			}
		}

		// Handle different packet types
		switch (socketType) {
			case 0: // CONNECT
				return { event: '__connect', namespace, data: payload[0] };

			case 1: // DISCONNECT
				return { event: '__disconnect', namespace };

			case 2: // EVENT
				if (payload.length < 1) {
					console.warn('[SocketParser] EVENT packet without event name');
					return null;
				}
				return {
					event: payload[0],
					data: payload[1],
					ackId,
					namespace,
				};

			case 3: // ACK
				return {
					event: '__ack',
					ackId,
					data: payload,
					namespace,
				};

			default:
				console.warn('[SocketParser] Unknown Socket.IO packet type:', socketType);
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
		if (process.env.NODE_ENV === 'development') {
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

	private static ackCounter = 1000; // Начинаем с большего числа

	/**
	 * Generate unique acknowledgement ID (только цифры для совместимости с Socket.IO)
	 */
	static generateAckId(): string {
		// Используем простой счетчик вместо timestamp
		this.ackCounter++;
		return this.ackCounter.toString();
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
}
