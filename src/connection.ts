import { EventEmitter } from 'events';
import { type Packet, encodePacket, decodePacket } from 'engine.io-parser';
import debugModule from 'debug';
import type { SocketData as DefaultSocketData } from '#types/socket-types';
import type { Server } from './';
import type { ServerWebSocket, WebSocketReadyState } from 'bun';
import type { Context } from 'hono';
import type { WSContext, WSMessageReceive } from 'hono/ws';
import { Client } from './client';
import type { EventsMap } from '#types/typed-events';
import { debugConfig } from '../config';

const isProduction = process.env.NODE_ENV === 'production';

const debug = debugModule('engine:socket');
debug.enabled = debugConfig.connection;

export interface SendOptions {
	compress?: boolean;
}

/**
 * Imitate Engine.IO Socket (as RawSocket on client)
 */
export class Connection<
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap,
	SocketData extends DefaultSocketData = DefaultSocketData,
> extends EventEmitter {
	public readonly id: string;
	public readonly handshake: any; // TODO: FIX HANDSHAKE ON CONNECT
	public readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	public readonly ctx: Context;
	public readonly data: {};
	public client!: Client<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	public ws!: WSContext<ServerWebSocket<WSContext>>;

	private pingInterval?: NodeJS.Timeout;
	private pongTimeout?: NodeJS.Timeout;

	constructor(
		/** strict types */
		id: string,
		server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		ctx: Context,
		data?: SocketData,
	) {
		super();
		this.id = id;
		this.server = server;
		this.ctx = ctx;
		this.data = data || {};
		this.handshake = this._handshake();
	}

	get readyState(): WebSocketReadyState {
		return this.ws?.readyState || WebSocket.CLOSED;
	}

	/**
	 * Send raw data to WebSocket
	 */
	private sendRaw(data: string | Uint8Array): void {
		if (this.readyState !== WebSocket.OPEN) {
			debug('WebSocket not open, discarding message');
		}
		try {
			debug('Sending raw data: %s', data);
			this.ws.send(data);
		} catch (error) {
			debug('Error sending raw data:', error);
		}
	}

	/**
	 * Send raw data to WebSocket
	 */
	send(packet: Packet): void {
		if (this.readyState !== WebSocket.OPEN) {
			debug('WebSocket not open, discarding message');
		}
		try {
			encodePacket(packet, false, (encoded) => {
				debug('Sending Engine.IO packet to %s: %s', this.id, typeof encoded === 'string' ? encoded : '[Binary]');
				this.sendRaw(encoded);
			});
		} catch (error) {
			debug('Error sending raw data:', error);
		}
	}

	/** similar to writeToEngine */
	write(data: string | Uint8Array, opts?: any): void {
		encodePacket({ type: 'message', data }, false, (encoded) => {
			this.sendRaw(encoded);
		});
	}

	/** similar to writeToEngine */
	writeToEngine(data: string | Uint8Array, opts?: any): void {
		this.write(data, opts);
	}

	/**
	 * Publish to Bun pub/sub system
	 */
	publish(topic: string, data: string | Uint8Array): boolean {
		let status = false;
		encodePacket({ type: 'message', data }, false, (encoded) => {
			status = this.server.publish(topic, data);
		});
		return status;
	}

	/**
	 * Close the WebSocket connection
	 */
	close(): void {
		if (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CONNECTING) {
			this.cleanup();
		}
	}

	async onOpen(event: Event, ws: WSContext<ServerWebSocket<WSContext>>) {
		debug('WebSocket connection opened for %s', this.id);
		this.ws = ws;

		// Parse namespace from URL
		const url = new URL(this.ctx.req.url);
		let nspName = url.pathname.replace('/ws', '') || '/';
		if (nspName === '') nspName = '/';

		// Send Engine.IO handshake
		this.send(this.handshake);

		debug('Starting ping/pong for %s (interval: %dms, timeout: %dms)', this.id, this.server._opts.pingInterval, this.server._opts.pingTimeout);
		this.startPingPong();

		// Create client
		this.client = new Client(this, this.server);
	}

	private startPingPong() {
		this.pingInterval = setInterval(() => {
			if (this.readyState === WebSocket.OPEN) {
				// Используем нативный Engine.IO ping packet
				this.send({ type: 'ping' });

				// Устанавливаем timeout для pong
				this.pongTimeout = setTimeout(() => {
					this.close();
				}, this.server._opts.pingTimeout);
			}
		}, this.server._opts.pingInterval);
	}

	private cleanup() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = undefined;
		}
		if (this.pongTimeout) {
			clearTimeout(this.pongTimeout);
			this.pongTimeout = undefined;
		}
		try {
			this.send({ type: 'close' });
		} catch (e) {}
		this.removeAllListeners();
	}

	async onMessage(event: MessageEvent<WSMessageReceive>, ws?: WSContext<ServerWebSocket<WSContext>>) {
		try {
			const packet = decodePacket(event.data);
			debug('Received Engine.IO packet from %s: %j', this.id, packet);

			switch (packet.type) {
				case 'ping':
					debug('Received ping from %s', this.id);
					this.send({ type: 'pong' });
					break;

				case 'pong':
					debug('Received pong from %s', this.id);
					if (this.pongTimeout) {
						clearTimeout(this.pongTimeout);
						this.pongTimeout = undefined;
					}
					break;

				case 'message':
					debug('Received Socket.IO message from %s', this.id, packet.data);
					this.emit('data', packet.data);
					break;

				case 'close':
					debug('Received close from %s', this.id);
					this.emit('close');
					break;

				default:
					debug('Unknown Engine.IO packet type: %s', packet.type);
			}
		} catch (err) {
			debug('Error decoding packet from %s: %s', this.id, err);
			this.emit('error', err);
		}
	}

	onClose(event: CloseEvent, ws?: WSContext<ServerWebSocket<WSContext>>) {
		debug('WebSocket connection closed for %s: %d %s', this.id, event.code, event.reason);
		// Determine close reason based on code
		let reason: string;
		if (event.code >= 4000) {
			reason = 'transport error';
		} else {
			switch (event.code) {
				case 1000:
					reason = 'transport close';
					break;
				case 1001:
					reason = 'transport close';
					break;
				case 1006:
					reason = 'transport error';
					break;
				case 1008:
					reason = 'ping timeout';
					break;
				case 1011:
					reason = 'transport error';
					break;
				default:
					reason = 'transport close';
			}
		}
		this.cleanup();
		this.emit('close', { event, ws });
	}

	onError(event: Event, ws?: WSContext<ServerWebSocket<WSContext>>) {
		debug('WebSocket error for %s', this.id);
		this.emit('error', new Error('WebSocket error'));
	}

	/**
	 * Create Engine.IO handshake response (v4.x compatible)
	 *
	 * @private
	 */
	private _handshake(): Packet {
		const handshake = {
			sid: this.id,
			upgrades: ['websocket'],
			pingInterval: this.server._opts.pingInterval,
			pingTimeout: this.server._opts.pingTimeout,
			maxPayload: this.server._opts.maxPayload,
		};

		return {
			type: 'open',
			data: JSON.stringify(handshake),
		};
	}
}
