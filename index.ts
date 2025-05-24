/**
 * Server & WebSocket
 * Main file of backend
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade } from './ws';

// App
const app = new Hono();

// Websocket
const WebSocketApp = app.get('/ws/:nsp?', wsUpgrade);

// Run Server
export const server = Bun.serve({
	hostname: process.env.APP_ENV === 'development' ? 'localhost' : '0.0.0.0',
	port: process.env.APP_ENV === 'development' ? 8443 : Number(process.env.APP_PORT),
	fetch: app.fetch,
	development: process.env.APP_ENV === 'development',
	maxRequestBodySize: 128 * 1024 * 1024, // 128 mb defauilt
	idleTimeout: 120, // 120 sec default
	// reusePort: false,

	/** websocket */
	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
		idleTimeout: 120, // 120 sec default
		maxPayloadLength: 16 * 1024 * 1024, // 16 MB default
		publishToSelf: false,
	},

	tls:
		process.env.APP_ENV === 'development'
			? {
					key: Bun.file(import.meta.dir + '\\dev\\localhost-key.pem'),
					cert: Bun.file(import.meta.dir + '\\dev\\localhost.pem'),
			  }
			: undefined,
});

process.env.APP_ENV === 'development' &&
	console.log(`Listening on https://${server.hostname}:${server.port}`);

// Types (RPC)
export type WebSocketApp = typeof WebSocketApp;
