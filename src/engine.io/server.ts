import { EventEmitter } from 'events';
import base64id from 'base64id';
import { Socket } from './socket';
import type { Context } from 'hono';
import { Transport } from './transport';
import type { Server as BunServer } from 'bun';
import debugModule from 'debug';
import { debugConfig } from '../../config';
import { encodePacket, decodePacket, type Packet } from 'engine.io-parser';

const debug = debugModule('engine:server');
debug.enabled = debugConfig.engine || false;

export interface ServerOptions {
	/**
	 * how many ms without a pong packet to consider the connection closed
	 * @default 20000
	 */
	pingTimeout?: number;
	/**
	 * how many ms before sending a new ping packet
	 * @default 25000
	 */
	pingInterval?: number;
	/**
	 * The low-level transports that are enabled.
	 */
	transports?: 'websocket';
	/**
	 * parameters of the WebSocket permessage-deflate extension (see ws module api docs). Set to false to disable.
	 * @default false
	 */
	perMessageDeflate?: boolean | object;
	/**
	 * Max allowed payload size, in bytes. Set to false to disable.
	 */
	maxPayload?: number;
	/**
	 * an optional packet which will be concatenated to the handshake packet emitted by Engine.IO.
	 */
	initialPacket?: any;
}

export class Server extends EventEmitter {
	public opts: ServerOptions;

	public bun: BunServer;
	protected clients: Map<string, Socket>;
	public clientsCount: number;

	constructor(bun: BunServer, opts: Partial<ServerOptions> = {}) {
		super();

		this.bun = bun;
		this.clients = new Map();
		this.clientsCount = 0;

		this.opts = Object.assign(
			{
				pingTimeout: 20000,
				pingInterval: 25000,
				transports: ['websocket'],
				perMessageDeflate: false,
				maxPayload: 1000000,
			},
			opts,
		);
	}

	/**
	 * Handles a request with ctx and return ws context.
	 * [onOpen, onClose, onMessage, onError]
	 *
	 * @param {Context} ctx Hono Context
	 * @param {any} data Custom data for socket
	 */
	handleRequest(ctx: Context, data?: any) {
		debug('Handle request on engine.io layer');

		// TODO: add handler for auth failed on this class or io.onconnection maybe io.onerror() to this
		// if (data?.authFailure) {
		// 	// Create transport but immediately trigger auth error
		// 	const transport = new Transport();
		// 	setTimeout(() => {
		// 		transport.onError(new Error('Unauthorized - authentication failed') as unknown as Event);
		// 	}, 50);
		// 	return transport;
		// }

		// TODO: add support for session persistence
		// const query = ctx.req.query();
		// const conn = ctx.env.requestIP(ctx.req.raw) as { address: string; family: string; port: number };
		// if (query.sid && this.clients.has(query.sid)) {
		// 	const socket = this.clients.get(query.sid);
		// 	if (socket) {
		// 		if (socket.remoteAddress && conn) {
		// 			if (socket.remoteAddress.address === conn.address) {
		// 				console.log('add pid to socket'); // for todo
		// 				return socket.transport;
		// 			}
		// 		}
		// 	}
		// }

		debug('Setting transport for new client');
		const id = base64id.generateId();
		const socket = new Socket(id, this, new Transport(), ctx, data);
		this.clients.set(id, socket);
		this.clientsCount++;
		socket.once('close', () => {
			this.clients.delete(id);
			this.clientsCount--;
		});
		this.emit('connection', socket);
		/**
		 * [onOpen, onClose, onMessage, onError]
		 * @return {Transport}
		 */
		return socket.transport;
	}

	publish(topics: string | string[], encodedPackets: Array<string | Buffer>, opts?: { compress?: boolean }): void {
		if (this.clientsCount === 0) {
			debug('publish by bun server but no clients');
			return;
		}

		const packets = (encodedPackets = Array.isArray(encodedPackets) ? encodedPackets : [encodedPackets]);
		topics = Array.isArray(topics) ? topics : [topics];

		/** each topics (each rooms) */
		for (let i = 0; i < packets.length; i++) {
			const packet = packets[i];
			if (!packet) continue;

			topics.forEach((topic) => {
				debug('publish to %s', topic);
				try {
					encodePacket(
						{ type: 'message', data: packet },
						false, // binary
						(encoded) => {
							/** send packet message */
							this.bun.publish(topic, encoded, opts?.compress);
							debug('published "%s"', encoded);
						},
					);
				} catch (error) {
					debug('Error publish packet:', error);
				}
			});
		}
	}

	/**
	 * Closes all clients.
	 */
	close(terminate: boolean = false) {
		debug('closing all open clients');
		for (const client of this.clients.values()) {
			client.close(terminate);
		}
		this.cleanup();
	}

	/**
	 * Cleans up the server.
	 */
	private cleanup() {
		this.clients.clear();
		this.clientsCount = 0;
		this.removeAllListeners();
	}
}
