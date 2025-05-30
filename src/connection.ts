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

	private writeBuffer: Packet[] = [];
	private packetsFn: SendCallback[] = [];
	private sentCallbackFn: SendCallback[][] = [];
	private cleanupFn: any[] = [];
	private pingTimeoutTimer: NodeJS.Timeout | null;
	private pingIntervalTimer: NodeJS.Timeout | null;

	constructor(
		/** strict types */
		id: string,
		server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		ctx: Context,
		data: {} = {},
	) {
		super();
		this.id = id;
		this.server = server;
		this.ctx = ctx;
		this.data = data;

		this.pingTimeoutTimer = null;
		this.pingIntervalTimer = null;
	}

	get readyState(): WebSocketReadyState {
		return this.ws.readyState;
	}

	/**
	 * Pings client every `this.pingInterval` and expects response
	 * within `this.pingTimeout` or closes connection.
	 *
	 * @private
	 */
	private schedulePing() {
		this.pingIntervalTimer = setTimeout(() => {
			debug('writing ping packet - expecting pong within %sms', this.server._opts.pingTimeout);
			this.sendPacket('ping');
			this.resetPingTimeout();
		}, this.server._opts.pingInterval);
	}

	/**
	 * Resets ping timeout.
	 *
	 * @private
	 */
	private resetPingTimeout() {
		if (!this.pingTimeoutTimer) return;
		clearTimeout(this.pingTimeoutTimer);
		this.pingTimeoutTimer = setTimeout(() => {
			if (this.readyState === WebSocket.CLOSED) return;
			this.onClose('ping timeout');
		}, this.server._opts.pingTimeout);
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

		if ('closing' !== this.ws.readyState && 'closed' !== this.readyState) {
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
				this.sentCallbackFn.push(null);
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
				this.closeTransport(discard);
			});
			return;
		}

		debug('the buffer is empty, closing the transport right away');
		this.closeTransport(discard);
	}

	async onOpen(event: Event, ws: WSContext<ServerWebSocket<WSContext>>) {
		this.ws = ws;
		this.client = new Client(this, this.server);

		// const url = new URL(this.ctx.req.url);

		// // Parsing namespace from URL (Socket.IO compatibility)
		// let nspName = url.pathname.replace('/ws', '') || '/';
		// if (nspName === '') nspName = '/';

		// const namespace = this.server.of(nspName);
		// const socket = await namespace['handleConnection'](ws.raw!, this.data);
		// ws.raw!.__socket = socket;

		// // Отправляем Engine.IO handshake имитацию
		// const eio = url.searchParams.get('EIO');
		// const transport = url.searchParams.get('transport');

		// if (eio && transport === 'websocket') {
		// 	const handshakeResponse = this.server.handshake(this.id);
		// 	ws.raw!.send(handshakeResponse);
		// }

		this.emit('connection', { event, ws });

		// in protocol v4, the server sends a ping, and the client answers with a pong
		this.schedulePing();
	}

	async onMessage(event: MessageEvent<WSMessageReceive>, ws?: WSContext<ServerWebSocket<WSContext>>) {
		// try {
		// 	const packet = await SocketParser.decode(event.data as string | Blob | ArrayBuffer | ArrayBufferView<ArrayBufferLike>);

		// 	if (!packet) {
		// 		return;
		// 	}

		// 	// Handle Engine.IO level packets
		// 	if (packet.event === 'ping') {
		// 		ws.raw!.send('3'); // Engine.IO pong
		// 		return;
		// 	}

		// 	if (packet.event === 'pong') {
		// 		return;
		// 	}

		// 	// Handle Socket.IO level packets
		// 	if (packet.event === '__ack' && packet.ackId) {
		// 		socket._handleAck(packet.ackId, packet.data);
		// 		return;
		// 	}

		// 	if (packet.event === '__connect') {
		// 		// Отправляем подтверждение подключения к namespace
		// 		const connectData = { sid: socket.id };
		// 		const connectResponse = SocketParser.encodeConnect(packet.namespace || '/', connectData);
		// 		ws.raw!.send(connectResponse);
		// 		return;
		// 	}

		// 	if (packet.event === '__disconnect') {
		// 		socket._handleClose('client namespace disconnect');
		// 		return;
		// 	}

		// 	// Handle regular Socket.IO events
		// 	socket._handlePacket(packet);
		// } catch (error) {}
		this.emit('data', { event, ws });
	}

	onClose(event: CloseEvent, ws?: WSContext<ServerWebSocket<WSContext>>) {
		// try {
		// 	const socket = ws.raw!.__socket;
		// 	if (socket) {
		// 		// Определяем причину отключения по коду
		// 		let reason: string;
		// 		if (event.code >= 4000) {
		// 			reason = 'application error';
		// 		} else {
		// 			switch (event.code) {
		// 				case 1000:
		// 					reason = 'normal closure';
		// 					break;
		// 				case 1001:
		// 					reason = 'going away';
		// 					break;
		// 				case 1006:
		// 					reason = 'abnormal closure';
		// 					break;
		// 				case 1008:
		// 					reason = 'rate limit exceeded';
		// 					break;
		// 				case 1011:
		// 					reason = 'internal error';
		// 					break;
		// 				default:
		// 					reason = `transport close (${event.code})`;
		// 			}
		// 		}

		// 		socket._handleClose(reason as any);
		// 	}
		// } catch (error) {}
		this.emit('close', { event, ws });
	}

	onError(event: Event, ws?: WSContext<ServerWebSocket<WSContext>>) {
		// try {
		// 	const socket = ws.raw!.__socket;
		// 	if (socket) {
		// 		socket._handleError(new Error('WebSocket error'));
		// 	}
		// } catch (error) {}
		this.emit('error', { event, ws });
	}
}
