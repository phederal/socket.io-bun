import { EventEmitter } from 'events';
import type { Context } from 'hono';
import { encodePacket, decodePacket } from 'engine.io-parser';
import type { WSContext } from 'hono/ws';
import type { ServerWebSocket } from 'bun';

export class WebSocketTransport extends EventEmitter {
	public name = 'websocket';
	public writable = false;
	private socket!: WSContext<ServerWebSocket<WSContext>>;

	constructor(private ctx: Context) {
		super();
	}

	onOpen(ws: any) {
		this.socket = ws;
		this.writable = true;
		this.emit('ready');
	}

	onMessage(data: any) {
		try {
			const packet = decodePacket(data);
			this.emit('packet', packet);
		} catch (err) {
			this.emit('error', err);
		}
	}

	send(packets: any[]) {
		if (!this.socket || !this.writable) return;

		for (const packet of packets) {
			encodePacket(packet, false, (encodedPacket) => {
				this.socket.send(encodedPacket);
			});
		}
		this.emit('drain');
	}

	doClose(fn?: () => void) {
		this.writable = false;
		fn && fn();
		if (this.socket) {
			this.socket.close();
		}
	}
}
