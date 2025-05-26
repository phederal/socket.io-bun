/**
 * Unit tests for BroadcastOperator class with real WebSocket connections
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';

// Глобальные переменные для WebSocket подключений
let sockets: WebSocket[] = [];

async function createWebSocketConnection(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket('wss://localhost:8443/ws/?EIO=4&transport=websocket');

		ws.onopen = () => {
			resolve(ws);
		};

		ws.onerror = (error) => {
			reject(error);
		};

		// Добавляем базовую обработку сообщений
		ws.onmessage = (event) => {
			// Обработка Socket.IO handshake
			if (typeof event.data === 'string' && event.data.startsWith('0{')) {
				// Получили handshake
			}
		};
	});
}

async function sendSocketIOEvent(ws: WebSocket, event: string, data?: any): Promise<void> {
	const packet = data !== undefined ? `42["${event}",${JSON.stringify(data)}]` : `42["${event}"]`;

	if (ws.readyState === WebSocket.OPEN) {
		ws.send(packet);
	}
}

describe('BroadcastOperator with Real WebSocket', () => {
	beforeEach(async () => {
		// Создаем 3 реальных WebSocket подключения
		sockets = [];
		for (let i = 0; i < 3; i++) {
			const ws = await createWebSocketConnection();
			sockets.push(ws);
		}

		// Даем время на handshake
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterEach(() => {
		// Закрываем все соединения
		sockets.forEach((ws) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.close();
			}
		});
		sockets = [];
	});

	describe('Basic Connection', () => {
		test('should establish WebSocket connections', () => {
			expect(sockets.length).toBe(3);
			sockets.forEach((ws) => {
				expect(ws.readyState).toBe(WebSocket.OPEN);
			});
		});

		test('should send and receive events', async () => {
			const [ws1] = sockets;
			let messageReceived = false;

			ws1.onmessage = (event) => {
				if (typeof event.data === 'string' && event.data.includes('test_response')) {
					messageReceived = true;
				}
			};

			// Отправляем тестовое событие
			await sendSocketIOEvent(ws1, 'test_echo', 'hello');

			// Ждем ответа
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(messageReceived).toBe(true);
		});
	});

	describe('Room Operations', () => {
		test('should handle room joining and messaging', async () => {
			const [ws1, ws2, ws3] = sockets;
			let roomMessagesReceived = 0;

			// Настраиваем обработчики сообщений
			[ws1, ws2].forEach((ws) => {
				ws.onmessage = (event) => {
					if (typeof event.data === 'string' && event.data.includes('room_message')) {
						roomMessagesReceived++;
					}
				};
			});

			ws3.onmessage = (event) => {
				if (typeof event.data === 'string' && event.data.includes('room_message')) {
					roomMessagesReceived++;
				}
			};

			// ws1 и ws2 присоединяются к комнате
			await sendSocketIOEvent(ws1, 'join_test_room', 'test-room');
			await sendSocketIOEvent(ws2, 'join_test_room', 'test-room');
			// ws3 не присоединяется

			await new Promise((resolve) => setTimeout(resolve, 100));

			// Отправляем сообщение в комнату
			await sendSocketIOEvent(ws1, 'send_to_room', { room: 'test-room', message: 'test' });

			await new Promise((resolve) => setTimeout(resolve, 200));

			// Должны получить 2 сообщения (ws1 и ws2)
			expect(roomMessagesReceived).toBe(2);
		});
	});

	describe('Binary Protocol', () => {
		test('should handle binary events', async () => {
			const [ws1] = sockets;
			let binaryResponseReceived = false;

			ws1.onmessage = (event) => {
				if (typeof event.data === 'string' && event.data.includes('binary_response')) {
					binaryResponseReceived = true;
				}
			};

			await sendSocketIOEvent(ws1, 'test_binary', 'binary test data');

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(binaryResponseReceived).toBe(true);
		});
	});

	describe('Acknowledgments', () => {
		test('should handle ACK callbacks', async () => {
			const [ws1] = sockets;
			let ackReceived = false;

			ws1.onmessage = (event) => {
				if (typeof event.data === 'string' && event.data.startsWith('43')) {
					// ACK response
					ackReceived = true;
				}
			};

			// Отправляем событие с ACK
			const ackId = Math.floor(Math.random() * 1000).toString();
			const packet = `42${ackId}["test_ack","ack test data"]`;
			ws1.send(packet);

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(ackReceived).toBe(true);
		});
	});

	describe('Error Handling', () => {
		test('should handle error events gracefully', async () => {
			const [ws1] = sockets;
			let errorReceived = false;

			ws1.onmessage = (event) => {
				if (typeof event.data === 'string' && event.data.includes('error_response')) {
					errorReceived = true;
				}
			};

			await sendSocketIOEvent(ws1, 'test_error', 'trigger error');

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(errorReceived).toBe(true);
		});
	});
});
