import { EventEmitter } from 'events';
import * as base64id from 'base64id';
import { Socket } from './socket';
import type { Context } from 'hono';
import { WebSocketTransport } from './transport';

export class Server extends EventEmitter {
	public clients: Map<string, Socket> = new Map();
	public clientsCount: number = 0;
	public opts: any;

	constructor(opts: any = {}) {
		super();
		this.opts = Object.assign(
			{
				pingTimeout: 20000,
				pingInterval: 25000,
				maxHttpBufferSize: 1e6,
			},
			opts,
		);
	}

	/**
	 * Handles a request.
	 *
	 * @param {Context} ctx
	 */
	handleRequest(ctx: Context) {
		const id = base64id.generateId();
		const transport = new WebSocketTransport(ctx);
		const socket = new Socket(id, this, transport, ctx);

		this.clients.set(id, socket);
		this.clientsCount++;

		socket.once('close', () => {
			this.clients.delete(id);
			this.clientsCount--;
		});

		this.emit('connection', socket);
		return socket;
	}

	/**
	 * Closes all clients.
	 */
	close() {
		for (const client of this.clients.values()) {
			client.close(true);
		}
		this.clients.clear();
		return this;
	}
}
