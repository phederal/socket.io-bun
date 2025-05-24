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

				// Парсим namespace из URL (Socket.IO совместимость)
				let nspName = url.pathname.replace('/ws', '') || '/';
				if (nspName === '') nspName = '/';

				const namespace = io.of(nspName);
				const socket = await namespace.handleConnection(ws.raw!, user, session);
				ws.raw!.__socket = socket;

				console.log(`[WebSocket] Socket ${socket.id} connected to namespace ${nspName}`);

				// Отправляем Engine.IO handshake имитацию (если это начальное подключение)
				const eio = url.searchParams.get('EIO');
				const transport = url.searchParams.get('transport');

				console.log(`[WebSocket] EIO version: ${eio}, transport: ${transport}`);

				if (eio && transport === 'websocket') {
					// Проверяем версию Engine.IO
					const eioVersion = parseInt(eio);
					if (eioVersion >= 4) {
						// Socket.IO v3.x+ использует Engine.IO v4+
						const handshakeResponse = SocketParser.createHandshakeResponse(
							socket.sessionId
						);
						console.log(`[WebSocket] Sending Engine.IO handshake:`, handshakeResponse);
						ws.raw!.send(handshakeResponse);
						console.log(`[WebSocket] Sent Engine.IO v${eio} handshake to ${socket.id}`);
					} else {
						console.warn(`[WebSocket] Unsupported Engine.IO version: ${eio}`);
					}
				}

				// ИСПРАВЛЕНИЕ: После успешного создания сокета сразу эмиттим события
				// Эмиттим на namespace
				namespace.emit('connection', socket);

				// ВАЖНО: Эмиттим на server для совместимости с io.on('connection')
				if (nspName === '/') {
					io.emit('connection', socket);
				}
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

				// Log raw message for debugging
				const rawMessage = typeof event.data === 'string' ? event.data : 'binary';
				console.log(`[WebSocket] Raw message from ${socket.id}:`, rawMessage);

				// Decode Socket.IO packet instead of msgpack
				const packet = await SocketParser.decode(
					event.data as string | Blob | ArrayBuffer | ArrayBufferView<ArrayBufferLike>
				);

				if (!packet) {
					console.warn('[WebSocket] Failed to parse Socket.IO packet from:', rawMessage);
					return;
				}

				console.log(`[WebSocket] Parsed packet from ${socket.id}:`, packet);

				// Handle Engine.IO level packets
				if (packet.event === 'ping') {
					// Respond to Engine.IO ping with pong
					console.log(`[WebSocket] Responding to Engine.IO ping from ${socket.id}`);
					ws.raw!.send('3'); // Engine.IO pong
					return;
				}

				if (packet.event === 'pong') {
					// Handle Engine.IO pong - just ignore
					console.log(`[WebSocket] Received Engine.IO pong from ${socket.id}`);
					return;
				}

				// Handle Socket.IO level packets
				if (packet.event === '__ack' && packet.ackId) {
					console.log(`[WebSocket] Handling ACK ${packet.ackId} from ${socket.id}`);
					socket._handleAck(packet.ackId, packet.data);
					return;
				}

				if (packet.event === '__connect') {
					// Handle namespace connection
					console.log(
						`[WebSocket] Socket ${socket.id} connecting to namespace ${
							packet.namespace || '/'
						}`
					);

					// Отправляем подтверждение подключения к namespace в формате Socket.IO v4
					const connectData = { sid: socket.id };
					const connectResponse = SocketParser.encodeConnect(
						packet.namespace || '/',
						connectData
					);
					ws.raw!.send(connectResponse);
					console.log(`[WebSocket] Sent connect confirmation: ${connectResponse}`);

					// ИСПРАВЛЕНИЕ: НЕ эмиттим connection здесь, так как это уже сделано в onOpen
					return;
				}

				if (packet.event === '__disconnect') {
					// Handle namespace disconnection
					console.log(
						`[WebSocket] Socket ${socket.id} disconnecting from namespace ${
							packet.namespace || '/'
						}`
					);
					socket._handleClose('client namespace disconnect');
					return;
				}

				// Handle regular Socket.IO events
				console.log(
					`[WebSocket] Handling Socket.IO event '${packet.event}' from ${socket.id}`
				);
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
