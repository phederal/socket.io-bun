import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WSContext } from 'hono/ws';
import type { Context } from 'hono';
import { io } from './socket/server';
import { SocketParser } from './socket/parser';

const isProduction = process.env.NODE_ENV === 'production';

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

				// Парсим namespace из URL (Socket.IO совместимость)
				let nspName = url.pathname.replace('/ws', '') || '/';
				if (nspName === '') nspName = '/';

				const namespace = io.of(nspName);
				const socket = await namespace.handleConnection(ws.raw!, user, session);
				ws.raw!.__socket = socket;

				if (!isProduction) {
					console.log(
						`[WebSocket] Socket ${socket.id} connected to namespace ${nspName}`
					);
				}

				// Отправляем Engine.IO handshake имитацию
				const eio = url.searchParams.get('EIO');
				const transport = url.searchParams.get('transport');

				if (eio && transport === 'websocket') {
					const handshakeResponse = SocketParser.createHandshakeResponse(
						socket.sessionId
					);
					if (!isProduction) {
						console.log(`[WebSocket] Sending Engine.IO handshake:`, handshakeResponse);
					}
					ws.raw!.send(handshakeResponse);
				}

				// ИСПРАВЛЕНИЕ: Эмиттим connection событие только через namespace
				// namespace автоматически пробросит на server если это дефолтный namespace
				if (!isProduction) {
					console.log(`[WebSocket] Emitting connection event for ${socket.id}`);
				}
				namespace.emit('connection', socket);
			} catch (error) {
				if (!isProduction) {
					console.error('[WebSocket] Connection error:', error);
				}
				ws.close(1011, 'Internal server error');
			}
		},

		onMessage: async (event, ws) => {
			try {
				const socket = ws.raw!.__socket;
				if (!socket) {
					if (!isProduction) {
						console.warn('[WebSocket] Message received but no socket found');
					}
					return;
				}

				// Проверяем состояние сокета перед обработкой
				if (!socket.connected || socket.ws.readyState !== 1) {
					console.warn(`[WebSocket] Message from disconnected socket ${socket.id}`);
					return;
				}

				const packet = await SocketParser.decode(
					event.data as string | Blob | ArrayBuffer | ArrayBufferView<ArrayBufferLike>
				);

				if (!packet) {
					return;
				}

				// // Добавляем защиту от flood
				// if (!socket.checkRateLimit || !socket.checkRateLimit(1)) {
				// 	console.warn(`[WebSocket] Rate limit exceeded for ${socket.id}`);
				// 	ws.close(1008, 'Rate limit exceeded');
				// 	return;
				// }

				if (!isProduction) {
					console.log(`[WebSocket] Packet from ${socket.id}:`, packet.event, packet.data);
				}

				// Handle Engine.IO level packets
				if (packet.event === 'ping') {
					ws.raw!.send('3'); // Engine.IO pong
					return;
				}

				if (packet.event === 'pong') {
					return;
				}

				// Handle Socket.IO level packets
				if (packet.event === '__ack' && packet.ackId) {
					socket._handleAck(packet.ackId, packet.data);
					return;
				}

				if (packet.event === '__connect') {
					// Отправляем подтверждение подключения к namespace
					const connectData = { sid: socket.id };
					const connectResponse = SocketParser.encodeConnect(
						packet.namespace || '/',
						connectData
					);
					ws.raw!.send(connectResponse);
					return;
				}

				if (packet.event === '__disconnect') {
					socket._handleClose('client namespace disconnect');
					return;
				}

				// Handle regular Socket.IO events
				socket._handlePacket(packet);
			} catch (error) {
				if (!isProduction) {
					console.error('[WebSocket] Message handling error:', error);
				}
			}
		},

		onClose: (event, ws) => {
			try {
				const socket = ws.raw!.__socket;
				if (socket) {
					if (!isProduction) {
						console.log(
							`[WebSocket] Socket ${socket.id} disconnected (code: ${event.code}, reason: ${event.reason})`
						);
					}

					// Определяем причину отключения по коду
					let reason: string;
					if (event.code >= 4000) {
						reason = 'application error';
					} else {
						switch (event.code) {
							case 1000:
								reason = 'normal closure';
								break;
							case 1001:
								reason = 'going away';
								break;
							case 1006:
								reason = 'abnormal closure';
								break;
							case 1008:
								reason = 'rate limit exceeded';
								break;
							case 1011:
								reason = 'internal error';
								break;
							case 1011:
								reason = 'internal error';
								break;
							default:
								reason = `transport close (${event.code})`;
						}
					}

					socket._handleClose(reason as any);
				}
			} catch (error) {
				if (!isProduction) {
					console.error('[WebSocket] Close handling error:', error);
				}
			}
		},

		onError: (event, ws) => {
			try {
				const socket = ws.raw!.__socket;
				if (socket) {
					if (!isProduction) {
						console.error(`[WebSocket] Socket ${socket.id} error:`, event);
					}
					socket._handleError(new Error('WebSocket error'));
				}
			} catch (error) {
				if (!isProduction) {
					console.error('[WebSocket] Error handling error:', error);
				}
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

export { io };
