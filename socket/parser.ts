import type { SocketPacketFromClient as SocketPacket } from 'shared/types/socket.types';
import { encode, decode } from '@msgpack/msgpack';

// interface Payload {
// 	event: string; // имя события (`"ping"`, `"message"`, …)
// 	data?: unknown; // полезная нагрузка
// 	ackId?: number; // если нужен ответ-ack
// 	error?: string; // для отправки ошибки в ack
// }

export class Packet {
	static encode(payload: unknown): string | Uint8Array {
		return encode(JSON.stringify(payload));
	}

	/**
	 * Decoding a message from the server.
	 * @param raw - any of the:
	 *  - string (JSON)
	 *  - ArrayBuffer (msgpack)
	 *  - Blob (msgpack)
	 *  - ArrayBufferView (msgpack)
	 * @returns {SocketPacket | null} - декодированное сообщение.
	 */
	static async decode(raw: string | ArrayBuffer | Blob | ArrayBufferView): Promise<SocketPacket | null> {
		// JSON
		if (typeof raw === 'string') {
			try {
				return JSON.parse(raw);
			} catch {
				console.warn('[Socket] invalid JSON', raw);
				return null;
			}
		}
		// бинарка → Uint8Array
		let bytes: Uint8Array;
		if (raw instanceof ArrayBuffer) {
			bytes = new Uint8Array(raw);
		} else if (raw instanceof Blob) {
			const ab = await raw.arrayBuffer();
			bytes = new Uint8Array(ab);
		} else if (ArrayBuffer.isView(raw)) {
			const v = raw as ArrayBufferView;
			bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
		} else {
			return null; // неожиданный формат
		}
		// msgpack
		try {
			return decode(bytes) as SocketPacket;
		} catch (err) {
			console.warn('[Socket] msgpack decode error', err);
			return null;
		}
	}
}
