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
	const user = c.get('user');
	const session = c.get('session');

	if (!user || !session) {
		return Promise.reject({ code: 3000, reason: 'Unauthorized' });
	}

	return {
		onOpen: async (event, ws) => {
			try {
				const url = new URL(c.req.url);
				const nspName = url.pathname.replace('/ws', '') || '/';
				const namespace = io.of(nspName);
				const socket = await namespace.handleConnection(ws, user, session);
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

				const packet = await SocketParser.decode(
					event.data as string | Blob | ArrayBuffer | ArrayBufferView<ArrayBufferLike>
				);
				if (!packet) {
					console.warn('[WebSocket] Failed to parse packet');
					return;
				}

				// ✅ ИСПРАВЛЕНИЕ: Добавляем обработку ack ответов
				if (packet.event === '__ack' && packet.ackId) {
					socket._handleAck(packet.ackId, packet.data);
					return;
				}

				// ✅ ИСПРАВЛЕНИЕ: Добавляем обработку ping/pong
				if (packet.event === 'ping') {
					socket.emit('pong' as any);
					return;
				}

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
