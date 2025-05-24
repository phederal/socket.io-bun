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
	 * Encode a packet for transmission
	 */
	static encode<T extends keyof ServerToClientEvents>(
		event: T,
		data: Parameters<ServerToClientEvents[T]>[0],
		ackId?: string
	): Uint8Array {
		const packet: SocketPacketToClient = { event, data, ackId };
		return encode(packet);
	}

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
				return JSON.parse(raw) as SocketPacketFromClient;
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
}
