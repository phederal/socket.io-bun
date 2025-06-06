/**
 * Example file for init io server
 * and use with hono createBunWebSocket
 */

import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';
import { Server } from './src';
import type { SocketData } from '#types/socket-types';
import type { DefaultEventsMap } from '#types/typed-events';

// Create typed socket server
// <Listen, Emit, Reserved, SocketData>
const io = new Server<any, any, DefaultEventsMap, SocketData>();

// Create WebSocket handler
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();

// WebSocket upgrade handler
export const wsUpgrade = upgradeWebSocket((c: Context) => {
	const user = c.get('user') || 'user_test1';
	const session = c.get('session') || 'session_test1';

	if (!user || !session) {
		return Promise.reject({ code: 3000, reason: 'Unauthorized' });
	}

	return io.onconnection(c, {
		user,
		session,
	});
});

export { io };
