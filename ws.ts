import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';

import { Server } from '@/server';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '#types/socket-types';
import type { DefaultEventsMap } from '#types/typed-events';

// Create typed socket server
const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>();

// Create WebSocket handler
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();

// WebSocket upgrade handler
export const wsUpgrade = upgradeWebSocket((c: Context) => {
	const user = c.get('user');
	const session = c.get('session');

	if (!user || !session) {
		return Promise.reject({ code: 3000, reason: 'Unauthorized' });
	}
	return io.onconnection(c, {
		user,
		session,
	});
});

export { io };
