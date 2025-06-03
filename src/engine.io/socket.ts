import { EventEmitter } from 'events';
import type { Server } from './server';
import type { WebSocketReadyState } from 'bun';

export class Socket extends EventEmitter {
	public readonly id: string;
	public server: Server;
	public request: any;
	public protocol: number = 4;
	public remoteAddress: string;
	public transport: any;

	public _readyState: WebSocketReadyState = WebSocket.CONNECTING;
	public upgrading = false;
	public upgraded = false;
	private writeBuffer: any[] = [];
	private sentCallbackFn: any[] = [];
	private cleanupFn: any[] = [];
	private pingTimeoutTimer: any;
	private pingIntervalTimer: any;

	get readyState() {
		return this._readyState;
	}
	set readyState(state) {
		this._readyState = state;
	}

	constructor(id: string, server: Server, transport: any, request: any) {
		super();
		this.id = id;
		this.server = server;
		this.request = request;
		this.remoteAddress = request.remoteAddress || '0.0.0.0';

		this.setTransport(transport);
		this.onOpen();
	}

	/**
	 * Called upon transport considered open.
	 */
	private onOpen() {
		this.readyState = WebSocket.OPEN;
		this.transport.sid = this.id;

		this.sendPacket(
			'open',
			JSON.stringify({
				sid: this.id,
				upgrades: [],
				pingInterval: this.server.opts.pingInterval,
				pingTimeout: this.server.opts.pingTimeout,
				maxPayload: this.server.opts.maxHttpBufferSize,
			}),
		);

		this.emit('open');
		this.schedulePing();
	}

	/**
	 * Called upon transport packet.
	 */
	private onPacket(packet: any) {
		if (WebSocket.OPEN !== this.readyState) return;

		this.emit('packet', packet);

		switch (packet.type) {
			case 'ping':
				this.sendPacket('pong');
				this.emit('heartbeat');
				break;
			case 'pong':
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
	 * Sends a message packet.
	 */
	public send(data: any, options?: any, callback?: any) {
		this.sendPacket('message', data, options, callback);
		return this;
	}

	/**
	 * Sends a packet.
	 */
	private sendPacket(type: string, data?: any, options: any = {}, callback?: any) {
		if ('function' === typeof options) {
			callback = options;
			options = {};
		}

		if (WebSocket.CLOSING !== this.readyState && WebSocket.CLOSED !== this.readyState) {
			const packet = { type, options };
			if (data) packet.data = data; // TODO

			this.emit('packetCreate', packet);
			this.writeBuffer.push(packet);

			if ('function' === typeof callback) this.sentCallbackFn.push(callback);
			this.flush();
		}
	}

	/**
	 * Attempts to flush the packets buffer.
	 */
	private flush() {
		if (WebSocket.CLOSED !== this.readyState && this.transport.writable && this.writeBuffer.length) {
			this.emit('flush', this.writeBuffer);
			this.server.emit('flush', this, this.writeBuffer);

			const wbuf = this.writeBuffer;
			this.writeBuffer = [];
			this.transport.send(wbuf);
			this.emit('drain');
			this.server.emit('drain', this);
		}
	}

	/**
	 * Pings client every `this.pingInterval`.
	 */
	private schedulePing() {
		this.pingIntervalTimer = setTimeout(() => {
			this.sendPacket('ping');
			this.resetPingTimeout();
		}, this.server.opts.pingInterval);
	}

	/**
	 * Resets ping timeout.
	 */
	private resetPingTimeout() {
		clearTimeout(this.pingTimeoutTimer);
		this.pingTimeoutTimer = setTimeout(() => {
			if (this.readyState === WebSocket.CLOSED) return;
			this.onClose('ping timeout');
		}, this.server.opts.pingTimeout);
	}

	/**
	 * Sets transport
	 */
	private setTransport(transport: any) {
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
	}

	private onError(err: Error) {
		this.emit('error', err);
	}

	private onDrain() {
		// Handle drain
	}

	private onClose(reason: string, description?: any) {
		if (WebSocket.CLOSED !== this.readyState) {
			this.readyState = WebSocket.CLOSED;
			clearTimeout(this.pingIntervalTimer);
			clearTimeout(this.pingTimeoutTimer);
			this.emit('close', reason, description);
		}
	}

	/**
	 * Closes the socket.
	 */
	close(discard?: boolean) {
		if (WebSocket.OPEN !== this.readyState) return;
		this.readyState = WebSocket.CLOSING;
		this.transport.close(() => {
			this.onClose('forced close');
		});
	}
}
