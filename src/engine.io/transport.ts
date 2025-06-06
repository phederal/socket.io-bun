import { EventEmitter } from 'events';
import type { Context } from 'hono';
import { encodePacket, decodePacket, type Packet } from 'engine.io-parser';
import type { WSContext } from 'hono/ws';
import type { ServerWebSocket, WebSocketReadyState } from 'bun';
import debugModule from 'debug';
import { debugConfig } from '../../config';
import * as parser from 'engine.io-parser';

const debug = debugModule('engine:transport');
debug.enabled = debugConfig.engine_transport;

export class Transport extends EventEmitter {
	public name: string = 'websocket';
	/**
	 * The session ID.
	 */
	public sid!: string;
	/**
	 * Whether the transport is currently ready to send packets.
	 */
	public writable = false;
	/**
	 * The current state of the transport.
	 * @protected
	 */
	protected _readyState: WebSocketReadyState = WebSocket.OPEN;
	/**
	 * Whether the transport is discarded and can be safely closed (used during upgrade).
	 * @protected
	 */
	protected discarded = false;
	/**
	 * The parser to use (depends on the revision of the {@link Transport#protocol}.
	 * @protected
	 */
	protected parser: typeof parser;
	/**
	 * Whether the transport supports binary payloads (else it will be base64-encoded)
	 * @protected
	 */
	protected supportsBinary: boolean;

	private socket!: WSContext<ServerWebSocket<WSContext>>;

	constructor() {
		super();
		this.parser = parser;
		this.supportsBinary = false; // TODO
	}

	get readyState() {
		return this._readyState;
	}
	set readyState(state: WebSocketReadyState) {
		debug('readyState updated from %s to %s (%s)', this._readyState, state, this.name);
		this._readyState = state;
	}

	/**
	 * Flags the transport as discarded.
	 *
	 * @package
	 */
	discard() {
		this.discarded = true;
	}

	/**
	 * Closes the transport.
	 *
	 * @package
	 */
	close(fn?: () => void) {
		if (WebSocket.CLOSED === this.readyState || WebSocket.CLOSING === this.readyState) return;

		this.readyState = WebSocket.CLOSING;
		this.doClose(fn || (() => {}));
	}

	/**
	 * Closes the transport.
	 *
	 * @private
	 */
	doClose(fn?: () => void) {
		debug('closing');
		fn && fn();
		// call fn first since socket.end() immediately emits a "close" event
		// this.socket.end(); // maybe be working on next release

		// Bun ws
		if (this.socket && this.writable) {
			this.socket.close();
			// if (!terminate) this.socket.close();
			// else this.socket.raw?.terminate();
			this.writable = false;
		}
	}

	/**
	 * Initialize transport when WebSocket is ready
	 */
	onOpen(ev: Event, ws: WSContext<ServerWebSocket<WSContext>>) {
		debug('WebSocket transport opened');
		this.socket = ws;
		this.writable = true;
		this.emit('ready');
	}

	/**
	 * Handle incoming WebSocket message
	 * Decodes the Engine.IO packet and passes it upstairs
	 */
	onMessage(ev: MessageEvent) {
		try {
			const packet = decodePacket(ev.data);
			debug('Received Engine.IO packet: %j', packet);
			this.emit('packet', packet);
		} catch (err) {
			debug('Error decoding packet: %s', err);
			this.emit('error', err);
		}
	}

	/**
	 * Handle WebSocket close
	 */
	onClose(ev: CloseEvent) {
		debug('WebSocket transport closed: %d %s', ev.code, ev.reason);
		this.readyState = WebSocket.CLOSED;
		this.emit('close', ev);
	}

	/**
	 * Handle WebSocket error
	 */
	onError(ev: Event) {
		debug('WebSocket transport error');
		this.emit('error', new Error('WebSocket transport error'));
	}

	/**
	 * Send Engine.IO packet
	 * Encodes the packet and sends it via WebSocket
	 */
	send(packets: Packet[]): void {
		this.writable = false;

		/** each packet */
		for (let i = 0; i < packets.length; i++) {
			const packet = packets[i];
			if (!packet) continue;
			const isLast = i + 1 === packets.length;

			/** callback to send a packet */
			const send = (data: parser.RawData) => {
				try {
					debug('writing "%s"', data);
					this.socket.send(data, packet.options);
					if (isLast) {
						this.emit('drain');
						this.writable = true;
						this.emit('ready');
					}
				} catch (error) {
					debug('Error sending packet:', error);
					this.emit('error', error);
					this.writable = true;
				}
			};

			/** encode packet and send */
			this.parser.encodePacket(packet, this.supportsBinary, send);
		}
	}
}
