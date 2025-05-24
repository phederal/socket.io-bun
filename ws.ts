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
				const socket = await namespace.handleConnection(ws.raw!, user, session);
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

				// Handle ack responses
				if (packet.event === '__ack' && packet.ackId) {
					socket._handleAck(packet.ackId, packet.data);
					return;
				}

				// Handle ping/pong
				if (packet.event === 'ping') {
					socket.emit('pong' as any);
					return;
				}

				// Handle acknowledgment requests from client
				if (packet.ackId) {
					// Client expects an acknowledgment - we need to respond after processing
					const originalEmit = socket.emit.bind(socket);

					// Create a callback wrapper that will send ack response
					const ackWrapper = (...args: any[]) => {
						const ackResponse = SocketParser.encodeAckResponse(packet.ackId!, args[0]);
						socket.ws.send(ackResponse);
					};

					// If event has a callback parameter, inject our ack wrapper
					if (packet.data && typeof packet.data === 'object' && packet.data.callback) {
						packet.data.callback = ackWrapper;
					} else {
						// For events expecting callback as last parameter
						const listeners = socket.listeners(packet.event);
						if (listeners.length > 0) {
							const listener = listeners[0] as Function;
							const listenerLength = listener.length;

							// If listener expects a callback (has more than 1 parameter)
							if (listenerLength > 1) {
								// Temporarily store the ack wrapper
								(socket as any).__tempAckWrapper = ackWrapper;
							}
						}
					}
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
