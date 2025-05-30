import { EventEmitter } from 'events';
import * as parser from './parser';
import debugModule from 'debug';
import type { SocketData as DefaultSocketData } from '#types/socket-types';
import type { Server } from './server';
import type { ServerWebSocket, WebSocketReadyState } from 'bun';
import type { Context } from 'hono';
import type { WSContext, WSMessageReceive } from 'hono/ws';
import type { Packet } from './parser';
import { Client } from './client';
import type { EventsMap } from '#types/typed-events';

const isProduction = process.env.NODE_ENV === 'production';

const debug = debugModule('engine:socket');

export interface SendOptions {
	compress?: boolean;
}

type ReadyState = 'opening' | 'open' | 'closing' | 'closed';

type SendCallback = () => void;

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
		data: SocketData,
	) {
		super();
		this.id = id;
		this.server = server;
		this.ctx = ctx;
		this.data = data;
	}

	get readyState(): WebSocketReadyState {
		return this.ws?.readyState || WebSocket.CLOSED;
	}

	/**
	 * Send raw data to WebSocket
	 */
	send(data: string | Uint8Array): void {
		if (this.readyState !== WebSocket.OPEN) {
			debug('WebSocket not open, discarding message');
		}

		try {
			this.ws.send(data);
		} catch (error) {
			debug('Error sending data:', error);
		}
	}

	/** similar to writeToEngine */
	write(data: string | Uint8Array, opts?: any): void {
		return this.send(data);
	}

	/** similar to writeToEngine */
	writeToEngine(data: string | Uint8Array, opts?: any): void {
		return this.send(data);
	}

	/**
	 * Publish to Bun pub/sub system
	 */
	publish(topic: string, data: string | Uint8Array): boolean {
		return this.server.publish(topic, data);
	}

	/**
	 * Close the WebSocket connection
	 */
	close(code?: number, reason?: string): void {
		if (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CONNECTING) {
			this.ws.close(code, reason);
		}
	}

	async onOpen(event: Event, ws: WSContext<ServerWebSocket<WSContext>>) {
		debug('WebSocket connection opened for %s', this.id);
		this.ws = ws;
		this.client = new Client(this, this.server);

		debug('Starting ping/pong for %s (interval: %dms, timeout: %dms)', this.id, this.server._opts.pingInterval, this.server._opts.pingTimeout);
		this.startPingPong();

		// Parse namespace from URL
		const url = new URL(this.ctx.req.url);
		let nspName = url.pathname.replace('/ws', '') || '/';
		if (nspName === '') nspName = '/';

		// Send Socket.IO handshake (Engine.IO compatible format)
		const handshakeResponse = this.server.handshake(this.id);
		this.send(handshakeResponse);

		// Emit connection event
		this.emit('open', { event, ws, namespace: nspName });
	}

	private startPingPong() {
		this.pingInterval = setInterval(() => {
			if (this.readyState === WebSocket.OPEN) {
				// Используем нативный Bun WebSocket ping
				this.ws.raw?.ping('2');

				// Или отправляем Engine.IO совместимый ping
				// this.send('2'); // Engine.IO ping packet

				// Устанавливаем timeout для pong
				this.pongTimeout = setTimeout(() => {
					this.close(1002, 'ping timeout');
				}, this.server._opts.pingTimeout);
			}
		}, this.server._opts.pingInterval);
	}

	private onPong() {
		if (this.pongTimeout) {
			clearTimeout(this.pongTimeout);
			this.pongTimeout = undefined;
		}
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
	}

	async onMessage(event: MessageEvent<WSMessageReceive>, ws?: WSContext<ServerWebSocket<WSContext>>) {
		debug('WebSocket message received for %s', this.id);

		// Engine.IO pong
		if (event.data === '3') {
			debug('Received pong from %s', this.id);
			this.onPong();
			return;
		}

		try {
			this.emit('data', event.data);
		} catch (error) {
			debug('Error processing message:', error);
			this.emit('error', error);
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
}
