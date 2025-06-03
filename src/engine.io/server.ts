import { EventEmitter } from 'events';
import base64id from 'base64id';
import { Socket } from './socket';
import type { Context } from 'hono';
import { Transport } from './transport';
import type { Server as BunServer, ServerWebSocketSendStatus } from 'bun';
import debugModule from 'debug';
import { getConnInfo } from 'hono/bun';
import { debugConfig } from '../../config';

const debug = debugModule('engine:server');
debug.enabled = debugConfig.engine;

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
}

export class Server extends EventEmitter {
	private server: BunServer;
	public clients: Map<string, Socket>;
	public clientsCount: number;
	public opts: ServerOptions;

	constructor(server: BunServer, opts: Partial<ServerOptions> = {}) {
		super();

		this.server = server;
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
		const query = ctx.req.query();
		const conn = getConnInfo(ctx);

		if (query.sid && this.clients.has(query.sid)) {
			const client = this.clients.get(query.sid);
			if (client) {
				const clientExist = getConnInfo(client.ctx);
				if (clientExist.remote.address === conn.remote.address) return client;
			}
		}

		debug('Setting transport for new client');
		const id = base64id.generateId();
		const socket = new Socket(id, this, new Transport(ctx), ctx, data);
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

	/**
	 * Closes all clients.
	 */
	close(terminate: boolean = false) {
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
	}
}
