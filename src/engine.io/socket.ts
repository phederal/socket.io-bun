import { EventEmitter } from 'events';
import type { Server } from './server';
import type { WebSocketReadyState } from 'bun';
import type { Packet, PacketType, RawData } from 'engine.io-parser';
import { Transport } from './transport';
import type { Context } from 'hono';
import debugModule from 'debug';
import { debugConfig } from '../../config';
import { getConnInfo } from 'hono/bun';

const debug = debugModule('engine:socket');
debug.enabled = debugConfig.engine_socket || false;

export interface EngineSocketOptions {
	pingInterval?: number;
	pingTimeout?: number;
	maxPayload?: number;
}

export interface SendOptions {
	compress?: boolean;
}
type SendCallback = (transport: Transport) => void;

export class Socket extends EventEmitter {
	public readonly id: string;
	public readonly ctx: Context;
	public readonly data: any = {};
	/**
	 * The IP address of the client.
	 */
	public readonly remoteAddress: { address: string; family: string; port: number } | null;

	public server: Server;
	public transport!: Transport;

	private writeBuffer: Packet[] = [];
	private packetsFn: SendCallback[] = [];
	private sentCallbackFn: SendCallback[][] = [];
	private cleanupFn: any[] = [];

	private _readyState: WebSocketReadyState = WebSocket.CONNECTING;
	private pingIntervalTimer!: NodeJS.Timeout;
	private pingTimeoutTimer!: NodeJS.Timeout;

	constructor(id: string, server: Server, transport: Transport, ctx: Context, data?: any) {
		super();
		this.id = id;
		this.ctx = ctx;
		this.data = data;
		this.server = server;
		// this.remoteAddress = getConnInfo(ctx).remote.address ?? null;
		this.remoteAddress = ctx.env.requestIP(ctx.req.raw) ?? null;

		this.setTransport(transport);
		this.onOpen();
	}

	get readyState(): WebSocketReadyState {
		return this._readyState;
	}
	set readyState(state: WebSocketReadyState) {
		debug('readyState updated from %s to %s', this._readyState, state);
		this._readyState = state;
	}

	/**
	 * Get WebSocket instance (compatibility with connection.ts)
	 */
	get ws() {
		return this.transport['socket'];
	}

	/**
	 * Setup transport event handlers
	 */
	private setTransport(transport: Transport) {
		const onError = this.onError.bind(this);
		const onReady = () => this.flush();
		const onPacket = this.onPacket.bind(this);
		const onDrain = this.onDrain.bind(this);
		const onClose = this.onClose.bind(this, 'transport close');

		this.transport = transport;
		this.transport.once('error', onError);
		this.transport.on('ready', onReady);
		this.transport.on('packet', onPacket);
		this.transport.on('drain', onDrain);
		this.transport.once('close', onClose);

		this.cleanupFn.push(() => {
			this.transport.removeListener('error', onError);
			this.transport.removeListener('ready', onReady);
			this.transport.removeListener('packet', onPacket);
			this.transport.removeListener('drain', onDrain);
			this.transport.removeListener('close', onClose);
		});
	}

	/**
	 * Upon transport "drain" event
	 *
	 * @private
	 */
	private onDrain() {
		if (this.sentCallbackFn.length > 0) {
			debug('executing batch send callback');
			const seqFn = this.sentCallbackFn.shift();
			if (seqFn) {
				for (let i = 0; i < seqFn.length; i++) {
					// @ts-ignore
					seqFn[i](this.transport);
				}
			}
		}
	}

	/**
	 * Called upon transport considered open.
	 *
	 * @private
	 */
	private onOpen() {
		this.readyState = WebSocket.OPEN;

		// sends an `open` packet
		this.transport.sid = this.id;
		this.sendPacket(
			'open',
			JSON.stringify({
				sid: this.id,
				upgrades: ['websocket'],
				pingInterval: this.server.opts.pingInterval,
				pingTimeout: this.server.opts.pingTimeout,
				maxPayload: this.server.opts.maxPayload,
			}),
		);

		if (this.server.opts.initialPacket) {
			this.sendPacket('message', this.server.opts.initialPacket);
		}

		this.emit('open');
		this.schedulePing();
	}

	/**
	 * Handle Engine.IO packets
	 */
	private onPacket(packet: Packet) {
		if (WebSocket.OPEN !== this.readyState) {
			return debug('packet received with closed socket');
		}

		debug(`received packet ${packet.type}`);
		this.emit('packet', packet);

		switch (packet.type) {
			case 'ping':
				debug('Received ping from %s', this.id);
				this.pingTimeoutTimer.refresh();
				this.sendPacket('pong');
				this.emit('heartbeat');
				break;

			case 'pong':
				debug('Received pong from %s', this.id);
				clearTimeout(this.pingTimeoutTimer);
				this.pingIntervalTimer.refresh();
				this.emit('heartbeat');
				break;

			case 'message':
				debug('Received Socket.IO message from %s', this.id);
				this.emit('data', packet.data);
				this.emit('message', packet.data);
				break;

			case 'error':
				this.onClose('parse error');
				break;

			case 'close':
				debug('Received close from %s', this.id);
				this.emit('close');
				break;

			case 'noop':
			case 'upgrade':
			case 'open':
				break;

			default:
				debug('Unknown Engine.IO packet type: %s', packet.type);
				this.onClose('parse error'); // only on socket.io-bun
				break;
		}
	}

	/**
	 * Called upon transport error.
	 *
	 * @param {Error} err - error object
	 * @private
	 */
	private onError(err: Error) {
		debug('transport error');
		this.onClose('transport error', err.message);
	}

	/**
	 * Pings client every `this.pingInterval` and expects response
	 * within `this.pingTimeout` or closes connection.
	 *
	 * @private
	 */
	private schedulePing() {
		this.pingIntervalTimer = setTimeout(() => {
			debug('writing ping packet - expecting pong within %sms', this.server.opts.pingTimeout);
			this.sendPacket('ping');
			this.resetPingTimeout();
		}, this.server.opts.pingInterval);
	}

	/**
	 * Resets ping timeout.
	 *
	 * @private
	 */
	private resetPingTimeout() {
		clearTimeout(this.pingTimeoutTimer);
		this.pingTimeoutTimer = setTimeout(() => {
			if (this.readyState === WebSocket.CLOSED) return;
			this.onClose('ping timeout');
		}, this.server.opts.pingTimeout);
	}

	/**
	 * Clears listeners and timers associated with current transport.
	 *
	 * @private
	 */
	private clearTransport() {
		let cleanup;
		const toCleanUp = this.cleanupFn.length;
		for (let i = 0; i < toCleanUp; i++) {
			cleanup = this.cleanupFn.shift();
			cleanup();
		}
		// silence further transport errors and prevent uncaught exceptions
		this.transport.on('error', function () {
			debug('error triggered by discarded transport');
		});
		// ensure transport won't stay open
		this.transport.close();
		clearTimeout(this.pingTimeoutTimer);
	}

	/**
	 * Called upon transport considered closed.
	 * Possible reasons: `ping timeout`, `client error`, `parse error`,
	 * `transport error`, `server close`, `transport close`
	 */
	private onClose(reason: string, description?: string) {
		if (WebSocket.CLOSED !== this.readyState) {
			this.readyState = WebSocket.CLOSED;

			// clear timers
			clearTimeout(this.pingIntervalTimer);
			clearTimeout(this.pingTimeoutTimer);

			// clean writeBuffer in next tick, so developers can still
			// grab the writeBuffer on 'close' event
			process.nextTick(() => {
				this.writeBuffer = [];
			});
			this.packetsFn = [];
			this.sentCallbackFn = [];
			this.clearTransport();
			this.emit('close', reason, description);
		}
	}

	/**
	 * Sends a message packet.
	 *
	 * @param {Object} data
	 * @param {Object} options
	 * @param {Function} callback
	 * @return {Socket} for chaining
	 */
	send(data: RawData, options?: SendOptions, callback?: any) {
		this.sendPacket('message', data, options, callback);
		return this;
	}

	/**
	 * Alias of {@link send}.
	 *
	 * @param data
	 * @param options
	 * @param callback
	 */
	write(data: RawData, options?: SendOptions, callback?: SendCallback) {
		this.sendPacket('message', data, options, callback);
		return this;
	}

	/**
	 * Sends a packet.
	 *
	 * @param {String} type - packet type
	 * @param {String} data
	 * @param {Object} options
	 * @param {Function} callback
	 *
	 * @private
	 */
	private sendPacket(type: PacketType, data?: RawData, options: SendOptions = {}, callback?: SendCallback) {
		if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		if (WebSocket.CLOSING !== this.readyState && WebSocket.CLOSED !== this.readyState) {
			debug('sending packet "%s" (%s)', type, data);
			// compression is enabled by default
			options.compress = options.compress !== false;

			const packet: Packet = {
				type,
				options: options as { compress: boolean },
			};
			if (data) packet.data = data;

			this.emit('packetCreate', packet);
			this.writeBuffer.push(packet);

			// add send callback to object, if defined
			if ('function' === typeof callback) this.packetsFn.push(callback);

			this.flush();
		}
	}

	/**
	 * Attempts to flush the packets buffer.
	 *
	 * @private
	 */
	private flush() {
		if (WebSocket.CLOSED !== this.readyState && this.transport.writable && this.writeBuffer.length) {
			debug('flushing buffer to transport');
			this.emit('flush', this.writeBuffer);
			this.server.emit('flush', this, this.writeBuffer);
			const wbuf = this.writeBuffer;
			this.writeBuffer = [];

			if (this.packetsFn.length) {
				this.sentCallbackFn.push(this.packetsFn);
				this.packetsFn = [];
			} else {
				this.sentCallbackFn.push([]);
			}

			this.transport.send(wbuf);
			this.emit('drain');
			this.server.emit('drain', this);
		}
	}

	/**
	 * Closes the socket and underlying transport.
	 * Checking for packets in the write buffer and then closing transport
	 *
	 * @param {Boolean} discard - optional, discard the transport
	 * @return {Socket} for chaining
	 */
	close(discard: boolean = false) {
		if (discard && (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CLOSING)) {
			this.closeTransport(discard);
			return;
		}

		if (WebSocket.OPEN !== this.readyState) return;
		this.readyState = WebSocket.CLOSING;

		if (this.writeBuffer.length) {
			debug("there are %d remaining packets in the buffer, waiting for the 'drain' event", this.writeBuffer.length);
			this.once('drain', () => {
				debug('all packets have been sent, closing the transport');
				this.closeTransport(discard);
			});
			return;
		}

		debug('the buffer is empty, closing the transport right away');
		this.closeTransport(discard);
	}

	/**
	 * Closes the underlying transport.
	 *
	 * @param {Boolean} discard
	 * @private
	 */
	private closeTransport(discard: boolean) {
		debug('closing the transport (discard? %s)', !!discard);
		if (discard) this.transport.discard();
		this.transport.close(this.onClose.bind(this, 'forced close'));
	}
}
