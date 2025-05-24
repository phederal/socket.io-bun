import './io';
import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';
import { io } from './socket/server';
import { SocketParser } from './socket/parser';
import type { SocketPacketFromClient } from './shared/types/socket.types';

// Create WebSocket handler
export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<WSContext>>();

// WebSocket upgrade handler
export const wsUpgrade = upgradeWebSocket((c: Context) => {
	const user = c.get('user'); // Better Auth Variable
	const session = c.get('session'); // Better Auth Variable

	if (!user || !session) {
		return Promise.reject({ code: 3000, reason: 'Unauthorized' });
	}

	return {
		onOpen: async (event, ws) => {
			try {
				// Get namespace from URL (default to '/')
				const url = new URL(c.req.url);
				const nspName = url.pathname.replace('/ws', '') || '/';

				// Get or create namespace
				const namespace = io.of(nspName);

				// Create socket connection
				const socket = await namespace.handleConnection(ws.raw!, user, session);

				// Store socket reference on WebSocket
				ws.raw!.__socket = socket;

				console.log(`[WebSocket] Socket ${socket.id} connected to ${nspName}`);
			} catch (error) {
				console.error('[WebSocket] Connection error:', error);
				ws.close(1011, 'Internal server error');
			}
		},

		onMessage: async (event, ws) => {
			try {
				const socket = ws.raw!.__socket;
				if (!socket) {
					console.warn('[WebSocket] Message received but no socket found');
					return;
				}

				// Parse incoming message
				const packet = await SocketParser.decode(<ArrayBuffer>event.data);
				if (!packet) {
					console.warn('[WebSocket] Failed to parse packet');
					return;
				}

				// Handle acknowledgement responses
				if (packet.ackId && packet.event === '__ack') {
					socket._handleAck(packet.ackId, packet.data);
					return;
				}

				// Handle regular packets
				socket._handlePacket(packet);
			} catch (error) {
				console.error('[WebSocket] Message handling error:', error);
			}
		},

		onClose: (event, ws) => {
			try {
				const socket = ws.raw!.__socket;
				if (socket) {
					console.log(`[WebSocket] Socket ${socket.id} disconnected`);
					socket._handleClose('transport close');
				}
			} catch (error) {
				console.error('[WebSocket] Close handling error:', error);
			}
		},

		onError: (event, ws) => {
			try {
				const socket = ws.raw!.__socket;
				if (socket) {
					console.error(`[WebSocket] Socket ${socket.id} error:`, event);
					socket._handleError(new Error('WebSocket error'));
				}
			} catch (error) {
				console.error('[WebSocket] Error handling error:', error);
			}
		},
	};
});

// Extend ServerWebSocket type to include socket reference
declare module 'bun' {
	interface ServerWebSocket {
		__socket?: any;
	}
}

// Export io instance for external use
export { io };
