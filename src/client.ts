import debugModule from 'debug';
import * as parser from './socket.io-parser';
import { PacketType, type Decoder, type Encoder, type Packet } from './socket.io-parser';
import type { Server } from './server';
import type { Socket } from './socket';
import type { Namespace } from './namespace';
import type { EventsMap } from '#types/typed-events';
import type { SocketData as DefaultSocketData, SocketId } from '#types/socket-types';
import type { Connection } from './connection';

const isProduction = process.env.NODE_ENV === 'production';
const debug = debugModule('socket.io:client');

type CloseReason = 'transport error' | 'transport close' | 'forced close' | 'ping timeout' | 'parse error';

interface WriteOptions {
	compress?: boolean;
	volatile?: boolean;
	preEncoded?: boolean;
	wsPreEncoded?: string;
}

export class Client<
	/** strict types */
	ListenEvents extends EventsMap,
	EmitEvents extends EventsMap,
	ServerSideEvents extends EventsMap,
	SocketData extends DefaultSocketData = any,
> {
	public readonly conn: Connection<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	public readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	public readonly encoder: Encoder;
	public readonly decoder: Decoder;

	private sockets: Map<SocketId, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	private nsps: Map<string, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	private connectTimeout?: NodeJS.Timeout;

	constructor(
		/** strict types */
		conn: Connection<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
		server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
	) {
		this.conn = conn;
		this.server = server;
		this.encoder = server.encoder;
		this.decoder = new server._parser.Decoder();
		this.setup();
	}

	/**
	 * Sets up event listeners.
	 *
	 * @private
	 */
	private setup() {
		this.onclose = this.onclose.bind(this);
		this.ondata = this.ondata.bind(this);
		this.onerror = this.onerror.bind(this);
		this.ondecoded = this.ondecoded.bind(this);

		// @ts-ignore
		this.decoder.on('decoded', this.ondecoded);
		this.conn.on('data', this.ondata);
		this.conn.on('error', this.onerror);
		this.conn.on('close', this.onclose);
		this.conn.on('open', () => {
			this.connect('/');
		});
	}

	/**
	 * Connects a client to a namespace.
	 *
	 * @param {String} name - the namespace
	 * @param {Object} auth - the auth parameters
	 * @private
	 */
	private connect(name: string, auth: Record<string, unknown> = {}): void {
		if (!name.startsWith('/')) {
			name = '/' + name;
		}
		if (this.server._nsps.has(name)) {
			debug('connecting to namespace %s', name);
			return this.doConnect(name, auth);
		} else {
			debug('namespace %s not found', name);
			// send error
			this._packet({
				type: PacketType.CONNECT_ERROR,
				nsp: name,
			});
		}
	}

	/**
	 * Connects a client to a namespace.
	 *
	 * @param name - the namespace
	 * @param {Object} auth - the auth parameters
	 *
	 * @private
	 */
	private doConnect(name: string, auth: Record<string, unknown>): void {
		const nsp = this.server.of(name);

		nsp._add(this, auth, (socket) => {
			this.sockets.set(socket.id, socket);
			this.nsps.set(nsp.name, socket);
			debug('socket %s connected to namespace %s', socket.id, nsp.name);
		});
	}

	/**
	 * Disconnects from all namespaces and closes transport.
	 *
	 * @private
	 */
	_disconnect(): void {
		for (const socket of this.sockets.values()) {
			socket.disconnect();
		}
		this.sockets.clear();
		this.close();
	}

	/**
	 * Removes a socket. Called by each `Socket`.
	 *
	 * @private
	 */
	_remove(socket: Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
		if (this.sockets.has(socket.id)) {
			const nsp = this.sockets.get(socket.id)!.nsp.name;
			this.sockets.delete(socket.id);
			this.nsps.delete(nsp);
		} else {
			debug('ignoring remove for %s', socket.id);
		}
	}

	/**
	 * Closes the underlying connection.
	 *
	 * @private
	 */
	private close(): void {
		if (this.conn.readyState === WebSocket.OPEN) {
			debug('forcing transport close');
			this.conn.close();
			this.onclose('forced server close');
		}
	}

	/**
	 * Writes a packet to the transport.
	 *
	 * @param {Object} packet object
	 * @param {Object} opts
	 * @private
	 */
	_packet(packet: Packet | any[], opts: WriteOptions = {}): void {
		if (this.conn.readyState !== WebSocket.OPEN) {
			debug('ignoring packet write %j', packet);
			return;
		}
		const encodedPackets = opts.preEncoded
			? (packet as any[]) // previous versions of the adapter incorrectly used socket.packet() instead of writeToEngine()
			: this.encoder.encode(packet as Packet);
		this.writeToEngine(encodedPackets, opts);
	}

	/** @private */
	writeToEngine(encodedPackets: Array<string | Buffer>, opts: WriteOptions): void {
		if (opts.volatile && this.conn.readyState !== WebSocket.OPEN) {
			debug('volatile packet is discarded since the transport is not currently writable');
			return;
		}
		const packets = Array.isArray(encodedPackets) ? encodedPackets : [encodedPackets];
		for (const encodedPacket of packets) {
			this.conn.write(encodedPacket, opts);
		}
	}

	/**
	 * Called with incoming transport data.
	 *
	 * @private
	 */
	private ondata(data: unknown): void {
		// try/catch is needed for protocol violations (GH-1880)
		try {
			this.decoder.add(data);
		} catch (e: unknown) {
			debug('invalid packet format');
			// @ts-ignore
			this.onerror(e);
		}
	}

	/**
	 * Called when parser fully decodes a packet.
	 *
	 * @private
	 */
	private ondecoded(packet: Packet): void {
		const namespace = packet.nsp || '/';
		packet.nsp = namespace;

		try {
			switch (packet.type) {
				case PacketType.CONNECT:
					{
						const authPayload = packet.data || {};
						debug('handling connect packet for namespace %s', namespace);
						this.connect(namespace, authPayload);
					}
					break;
				case PacketType.DISCONNECT:
					{
						const socket = this.nsps.get(namespace);
						if (socket) {
							debug('handling disconnect packet for namespace %s', namespace);
							socket.disconnect();
						}
					}
					break;
				case PacketType.EVENT:
				case PacketType.BINARY_EVENT:
					{
						const socket = this.nsps.get(namespace);
						if (socket) {
							debug('routing event packet to socket %s in namespace %s', socket.id, namespace);
							process.nextTick(() => {
								socket._onpacket(packet);
							});
						} else {
							debug('no socket found for namespace %s, ignoring event', namespace);
						}
					}
					break;
				case PacketType.ACK:
				case PacketType.BINARY_ACK:
					{
						const socket = this.nsps.get(namespace);
						if (socket) {
							debug('routing ack packet to socket %s in namespace %s', socket.id, namespace);
							process.nextTick(() => {
								socket._onpacket(packet);
							});
						} else {
							debug('no socket found for namespace %s, ignoring ack', namespace);
						}
					}
					break;
				case PacketType.CONNECT_ERROR:
					debug('connect error for namespace %s: %s', namespace, packet.data);
					break;
				default:
					debug('unknown packet type: %s', packet.type);
					this.onerror(new Error(`Unknown packet type: ${packet.type}`));
			}
		} catch (error) {
			debug('error handling packet: %s', error);
			this.onerror(error as Error);
		}
	}

	/**
	 * Handles an error.
	 *
	 * @param {Object} err object
	 * @private
	 */
	private onerror(err: Error): void {
		debug('client error: %s', err.message);

		for (const socket of this.sockets.values()) {
			socket._onerror(err);
		}

		// Don't auto-close on parser errors, let connection handle it
		if (err.message.includes('Invalid packet') || err.message.includes('Unknown packet')) {
			// Just log parser errors
			return;
		}

		this.conn.close();
	}

	/**
	 * Called upon transport close.
	 *
	 * @param reason
	 * @param description
	 * @private
	 */
	private onclose(reason: CloseReason | 'forced server close', description?: any): void {
		debug('client close with reason %s', reason);

		// ignore a potential subsequent `close` event
		this.destroy();

		// `nsps` and `sockets` are cleaned up seamlessly
		for (const socket of this.sockets.values()) {
			socket._onclose(reason, description);
		}

		this.sockets.clear();
		this.nsps.clear();
	}

	/**
	 * Cleans up event listeners.
	 * @private
	 */
	private destroy(): void {
		this.conn.removeListener('data', this.ondata);
		this.conn.removeListener('error', this.onerror);
		this.conn.removeListener('close', this.onclose);
		this.decoder.removeListener('decoded', this.ondecoded);
		this.decoder.destroy();

		if (this.connectTimeout) {
			clearTimeout(this.connectTimeout);
			this.connectTimeout = undefined;
		}
	}
}
