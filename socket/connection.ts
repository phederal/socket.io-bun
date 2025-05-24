import { EventEmitter } from 'events';

import type { BaseServer, WS } from './server';
import { setTimeout, clearTimeout } from 'timers';
import type { Packet, PacketType, RawData } from 'engine.io-parser';

const debug = debugModule('engine:socket');

export interface SendOptions {
	compress?: boolean;
}

type ReadyState = 'opening' | 'open' | 'closing' | 'closed';

type SendCallback = (transport: Transport) => void;

export class Socket extends EventEmitter {
	public ws: WS;
	/**
	 * The IP address of the client.
	 */
	public readonly remoteAddress: string;
	/**
	 * The current state of the socket.
	 */
	public _readyState: ReadyState = 'opening';
	private server: BaseServer;
	/* private */ upgrading = false;
	/* private */ upgraded = false;
	private writeBuffer: Packet[] = [];
	private packetsFn: SendCallback[] = [];
	private sentCallbackFn: SendCallback[][] = [];
	private cleanupFn: any[] = [];
	private pingTimeoutTimer: any;
	private pingIntervalTimer: any;

	/**
	 * This is the session identifier that the client will use in the subsequent HTTP requests. It must not be shared with
	 * others parties, as it might lead to session hijacking.
	 *
	 * @private
	 */
	private readonly id: string;

	get readyState() {
		return this._readyState;
	}

	set readyState(state: ReadyState) {
		debug('readyState updated from %s to %s', this._readyState, state);
		this._readyState = state;
	}

	constructor(id: string, server: BaseServer, ws: WS) {
		super();
		this.id = id;
		this.server = server;
		this.ws = ws;
		this.remoteAddress = ws.remoteAddress;
		this.pingTimeoutTimer = null;
		this.pingIntervalTimer = null;
		this.onOpen();
	}

	/**
	 * Called upon transport considered open.
	 *
	 * @private
	 */
	private onOpen() {
		this.readyState = 'open';
		// sends an `open` packet
		// this.sid = this.id;
		this.sendPacket(
			'open',
			JSON.stringify({
				sid: this.id,
				pingInterval: this.server.opts.pingInterval,
				pingTimeout: this.server.opts.pingTimeout,
				maxPayload: this.server.opts.maxHttpBufferSize,
			}),
		);

		if (this.server.opts.initialPacket) {
			this.sendPacket('message', this.server.opts.initialPacket);
		}

		this.emit('open');

		// in protocol v4, the server sends a ping, and the client answers with a pong
		this.schedulePing();
	}

	/**
	 * Called upon transport packet.
	 *
	 * @param {Object} packet
	 * @private
	 */
	private onPacket(packet: Packet) {
		if ('open' !== this.readyState) {
			return debug('packet received with closed socket');
		}
		// export packet event
		debug(`received packet ${packet.type}`);
		this.emit('packet', packet);

		switch (packet.type) {
			case 'ping':
				debug('got ping');
				this.pingTimeoutTimer.refresh();
				this.sendPacket('pong');
				this.emit('heartbeat');
				break;

			case 'pong':
				debug('got pong');
				clearTimeout(this.pingTimeoutTimer);
				this.pingIntervalTimer.refresh();
				this.emit('heartbeat');
				break;

			case 'error':
				this.onClose('parse error');
				break;

			case 'message':
				this.emit('data', packet.data);
				this.emit('message', packet.data);
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
		this.onClose('transport error', err);
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
			if (this.readyState === 'closed') return;
			this.onClose('ping timeout');
		}, this.server.opts.pingTimeout);
	}

	/**
	 * Attaches handlers for the given transport.
	 *
	 * @param {Transport} transport
	 * @private
	 */
	private setTransport(transport: Transport) {
		const onReady = () => this.flush();
		const onError = this.onError.bind(this);
		const onPacket = this.onPacket.bind(this);
		const onDrain = this.onDrain.bind(this);
		const onClose = this.onClose.bind(this, 'transport close');

		this.transport = transport;
		this.transport.once('error', onError);
		this.transport.on('ready', onReady);
		this.transport.on('packet', onPacket);
		this.transport.on('drain', onDrain);
		this.transport.once('close', onClose);

		this.cleanupFn.push(function () {
			transport.removeListener('error', onError);
			transport.removeListener('ready', onReady);
			transport.removeListener('packet', onPacket);
			transport.removeListener('drain', onDrain);
			transport.removeListener('close', onClose);
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
					seqFn[i](this.transport);
				}
			}
		}
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
		if ('closed' !== this.readyState) {
			this.readyState = 'closed';

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
	public send(data: RawData, options?: SendOptions, callback?: SendCallback) {
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
	public write(data: RawData, options?: SendOptions, callback?: SendCallback) {
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

		if ('closing' !== this.readyState && 'closed' !== this.readyState) {
			debug('sending packet "%s" (%s)', type, data);

			// compression is enabled by default
			options.compress = options.compress !== false;

			const packet: Packet = {
				type,
				options: options as { compress: boolean },
			};

			if (data) packet.data = data;

			// exports packetCreate event
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
		if ('closed' !== this.readyState && this.transport.writable && this.writeBuffer.length) {
			debug('flushing buffer to transport');
			this.emit('flush', this.writeBuffer);
			this.server.emit('flush', this, this.writeBuffer);
			const wbuf = this.writeBuffer;
			this.writeBuffer = [];

			if (this.packetsFn.length) {
				this.sentCallbackFn.push(this.packetsFn);
				this.packetsFn = [];
			} else {
				this.sentCallbackFn.push(null!);
			}

			this.transport.send(wbuf);
			this.emit('drain');
			this.server.emit('drain', this);
		}
	}

	/**
	 * Closes the socket and underlying transport.
	 *
	 * @param {Boolean} discard - optional, discard the transport
	 * @return {Socket} for chaining
	 */
	public close(discard?: boolean) {
		if (discard && (this.readyState === 'open' || this.readyState === 'closing')) {
			return this.closeTransport(discard);
		}

		if ('open' !== this.readyState) return;

		this.readyState = 'closing';

		if (this.writeBuffer.length) {
			debug("there are %d remaining packets in the buffer, waiting for the 'drain' event", this.writeBuffer.length);
			this.once('drain', () => {
				debug('all packets have been sent, closing the transport');
				this.closeTransport(discard!);
			});
			return;
		}

		debug('the buffer is empty, closing the transport right away');
		this.closeTransport(discard!);
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
