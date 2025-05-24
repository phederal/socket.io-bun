import { encode, decode } from '@msgpack/msgpack';
import type {
	SocketPacketFromClient,
	SocketPacketToClient,
	ClientToServerEvents,
	ServerToClientEvents,
} from '../shared/types/socket.types';

/**
 * Socket.IO compatible packet encoder/decoder using msgpack
 */
export class SocketParser {
	/**
	 * Encode a packet for transmission to client
	 */
	static encode<T extends keyof ServerToClientEvents>(
		event: T,
		data?: Parameters<ServerToClientEvents[T]>[0],
		ackId?: string
	): Uint8Array {
		const packet: SocketPacketToClient = {
			event,
			...(data !== undefined && { data }),
			...(ackId && { ackId }),
		};
		return encode(packet);
	}

	/**
	 * Encode acknowledgment response
	 */
	static encodeAckResponse(ackId: string, data: any): Uint8Array {
		const packet = {
			event: '__ack',
			ackId,
			data,
		};
		return encode(packet);
	}

	/**
	 * Decode incoming packet from client
	 */
	static async decode(
		raw: string | ArrayBuffer | Blob | ArrayBufferView
	): Promise<SocketPacketFromClient | null> {
		try {
			// Handle JSON string (fallback compatibility)
			if (typeof raw === 'string') {
				try {
					return JSON.parse(raw) as SocketPacketFromClient;
				} catch {
					console.warn('[SocketParser] Invalid JSON string');
					return null;
				}
			}

			// Convert to Uint8Array
			let bytes: Uint8Array;
			if (raw instanceof ArrayBuffer) {
				bytes = new Uint8Array(raw);
			} else if (raw instanceof Blob) {
				const ab = await raw.arrayBuffer();
				bytes = new Uint8Array(ab);
			} else if (ArrayBuffer.isView(raw)) {
				const view = raw as ArrayBufferView;
				bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
			} else {
				console.warn('[SocketParser] Unsupported data format:', typeof raw);
				return null;
			}

			// Decode msgpack
			const decoded = decode(bytes) as SocketPacketFromClient;

			// Validate packet structure
			if (!decoded || typeof decoded !== 'object' || !decoded.event) {
				console.warn('[SocketParser] Invalid packet structure:', decoded);
				return null;
			}

			return decoded;
		} catch (error) {
			console.warn('[SocketParser] Decode error:', error);
			return null;
		}
	}

	/**
	 * Create a ping packet
	 */
	static createPingPacket(): Uint8Array {
		return SocketParser.encode('ping' as any, undefined);
	}

	/**
	 * Create a pong packet
	 */
	static createPongPacket(): Uint8Array {
		return SocketParser.encode('pong' as any, undefined);
	}

	/**
	 * Generate unique acknowledgement ID
	 */
	static generateAckId(): string {
		return `ack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
	 * Create error packet
	 */
	static createErrorPacket(code: number, message: string): Uint8Array {
		return SocketParser.encode('error' as any, { code, message });
	}

	/**
	 * Create notification packet
	 */
	static createNotificationPacket(message: string): Uint8Array {
		return SocketParser.encode('notification' as any, message);
	}
}
