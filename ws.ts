import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';

import { Server } from '@/server';
import { Client } from '@/client';
import { Socket as SocketIO } from '@/socket';
import type {
	ClientToServerEvents,
	InterServerEvents,
	ServerToClientEvents,
	SocketData,
} from '#types/socket.types';
import { Connection } from '@/connection';

declare module 'bun' {
	interface ServerWebSocket {
		__socket?: SocketIO;
	}
}

// Create typed socket server
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>();

// Create WebSocket handler
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();

// WebSocket upgrade handler
export const wsUpgrade = upgradeWebSocket((c: Context) => {
	const user = c.get('user');
	const session = c.get('session');

	if (!user || !session) {
		return Promise.reject({ code: 3000, reason: 'Unauthorized' });
	}

	/**
	 * Context
	 * Custom client data
	 * */
	return io.onconnection(c, {
		user,
		session,
	});
});

export { io };
