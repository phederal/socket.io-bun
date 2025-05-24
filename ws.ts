import './io';
// Import Bun WebSocket utilities and types
import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';
import { Client } from './socket/client';

// Upgrade to ws
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();

// Create ws
export const wsUpgrade = upgradeWebSocket((c: Context) => {
	const user = c.get('user'); // Better Auth Variable
	const session = c.get('session'); // Better Auth Variable

	if (!user || !session) return Promise.reject({ code: 3000, reason: 'Unauthorized' });

	return {
		onOpen: async (e, ws) => {
			const conn = new Client(ws, user, session);
			ws.raw?.remoteAddress;
			ws.raw!.__conn = conn;
			await conn.onOpen(e);
		},
		onMessage: (e, ws) => ws.raw!.__conn!.onMessage(e),
		onClose: (e, ws) => ws.raw!.__conn!.onClose(e),
		onError: (e, ws) => ws.raw!.__conn!.onError(e),
	};
});

// Extend the ServerWebSocket type
declare module 'bun' {
	interface ServerWebSocket {
		__conn?: Client;
	}
}
