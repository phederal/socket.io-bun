import debugModule from 'debug';
import { PacketType, type Decoder, type Encoder, type Packet } from './socket.io-parser';
import type { Socket as RawSocket } from './engine.io';
import type { Server } from './';
import type { Socket } from './socket';
import type { Namespace } from './namespace';
import type { EventsMap } from '#types/typed-events';
import type { SocketData as DefaultSocketData } from '#types/socket-types';
import type { SocketId } from './socket.io-adapter';
import { debugConfig } from '../config';

const debug = debugModule('socket.io:client');
debug.enabled = debugConfig.client;

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
	private readonly id: string;
	public readonly conn: RawSocket;
	public readonly server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
	public readonly encoder: Encoder;
	public readonly decoder: Decoder;

	private sockets: Map<SocketId, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	private nsps: Map<string, Socket<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> = new Map();
	private connectTimeout?: NodeJS.Timeout;

	constructor(
		/** strict types */
		conn: RawSocket,
		server: Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
	) {
		this.conn = conn;
		this.server = server;
		this.encoder = server.encoder;
		this.decoder = new server._parser.Decoder();
		this.id = conn.id;
		this.setup();
	}

	/**
	 * @return the reference to the request that originated the Engine.IO connection
	 */
	get ctx() {
		return this.conn.ctx;
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

		this.connectTimeout = setTimeout(() => {
			if (this.nsps.size === 0) {
				debug('no namespace joined yet, close the client');
				this.close();
			} else {
				debug('the client has already joined a namespace, nothing to do');
			}
		}, this.server._connectTimeout);
	}

	/**
	 * Connects a client to a namespace.
	 *
	 * @param {String} name - the namespace
	 * @param {Object} auth - the auth parameters
	 * @private
	 */
	private connect(name: string, auth: Record<string, unknown> = {}): void {
		if (this.server._nsps.has(name)) {
			debug('connecting to namespace %s', name);
			return this.doConnect(name, auth);
		}

		this.server._checkNamespace(name, auth, (dynamicNspName: Namespace<ListenEvents, EmitEvents, ServerSideEvents, SocketData> | false) => {
			if (dynamicNspName) {
				this.doConnect(name, auth);
			} else {
				debug('creation of namespace %s was denied', name);
				this._packet({
					type: PacketType.CONNECT_ERROR,
					nsp: name,
					data: {
						message: 'Invalid namespace',
					},
				});
			}
		});
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
			if (this.connectTimeout) {
				clearTimeout(this.connectTimeout);
				this.connectTimeout = undefined;
			}
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
		debug('removing socket %s', socket.id);
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
			this.conn.send(encodedPacket, opts);
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
		const authPayload = packet.data || {};
		const socket = this.nsps.get(namespace);

		switch (packet.type) {
			case PacketType.CONNECT:
				if (!socket) {
					debug('handling connect packet for namespace %s', namespace);
					this.connect(namespace, authPayload);
				} else {
					debug('invalid state - CONNECT packet for existing socket in namespace %s', namespace);
					this.close();
				}
				break;

			case PacketType.DISCONNECT:
			case PacketType.EVENT:
			case PacketType.BINARY_EVENT:
			case PacketType.ACK:
			case PacketType.BINARY_ACK:
				if (socket) {
					debug('routing %s packet to socket %s in namespace %s', packet.type, socket.id, namespace);
					process.nextTick(() => {
						socket._onpacket(packet);
					});
				} else {
					debug('invalid state - %s packet for non-existent socket in namespace %s', packet.type, namespace);
					this.close();
				}
				break;

			case PacketType.CONNECT_ERROR:
				if (socket) {
					debug('routing connect_error packet to socket %s in namespace %s', socket.id, namespace);
					process.nextTick(() => {
						socket._onpacket(packet);
					});
				} else {
					debug('connect_error for non-existent socket in namespace %s', namespace);
					// Maybe we should send CONNECT_ERROR?
				}
				break;

			default:
				debug('unknown packet type: %s', packet.type);
				this.onerror(new Error(`Unknown packet type: ${packet.type}`));
				this.close(); // not have in socket.io, but we added
				break;
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
		this.decoder.destroy();
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

		if (this.connectTimeout) {
			clearTimeout(this.connectTimeout);
			this.connectTimeout = undefined;
		}
	}
}
