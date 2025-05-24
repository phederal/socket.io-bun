import { encode, decode } from '@msgpack/msgpack';
import type {
	SocketPacketFromClient,
	SocketPacketToClient,
	ClientToServerEvents,
	ServerToClientEvents,
} from '../shared/types/socket.types';

/**
 * Socket.IO compatible packet encoder/decoder
 * Имитирует формат пакетов Socket.IO для совместимости с клиентом
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
		// Engine.IO packet types:
		// 0=open, 1=close, 2=ping, 3=pong, 4=message
		// Socket.IO packet types (after 4):
		// 0=CONNECT, 1=DISCONNECT, 2=EVENT, 3=ACK, 4=CONNECT_ERROR, 5=BINARY_EVENT, 6=BINARY_ACK

		// Handle ping/pong (Engine.IO level)
		if (event === ('ping' as any)) return '2';
		if (event === ('pong' as any)) return '3';

		let packet = '4'; // Engine.IO message packet

		if (ackId) {
			// Socket.IO ACK packet
			packet += '3';
		} else {
			// Socket.IO EVENT packet
			packet += '2';
		}

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		// Add ack ID if present
		if (ackId) {
			packet += ackId;
		}

		// Create payload array
		let payload: any[];
		if (ackId) {
			// ACK format: [ackId, ...responseData]
			payload = Array.isArray(data) ? data : [data];
		} else {
			// EVENT format: [eventName, data]
			payload = data !== undefined ? [event, data] : [event];
		}

		packet += JSON.stringify(payload);
		return packet;
	}

	/**
	 * Encode acknowledgment response (Socket.IO format)
	 */
	static encodeAckResponse(ackId: string, data: any, namespace: string = '/'): string {
		let packet = '43'; // Engine.IO message + Socket.IO ACK

		// Add namespace if not default
		if (namespace !== '/') {
			packet += namespace + ',';
		}

		packet += ackId;

		// ACK response format: [responseData] or [responseData1, responseData2, ...]
		const payload = Array.isArray(data) ? data : [data];
		packet += JSON.stringify(payload);

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
		} else {
			// По умолчанию отправляем пустой объект для Socket.IO v4 совместимости
			packet += '{}';
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

			// Parse Engine.IO + Socket.IO packet
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
			// Ping packet
			return { event: 'ping' as any };
		}
		if (engineType === 3) {
			// Pong packet
			return { event: 'pong' as any };
		}
		if (engineType !== 4) {
			// Not a message packet, ignore
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
		return '0' + JSON.stringify(handshake);
	}

	/**
	 * Generate unique session ID
	 */
	static generateSessionId(): string {
		return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Generate unique acknowledgement ID
	 */
	static generateAckId(): string {
		return `${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
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
