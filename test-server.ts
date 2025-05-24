/**
 * Server ACK Test Example
 * Демонстрирует все типы acknowledgments в Socket.IO
 */

import { io } from './socket/server';

// Расширяем типы для тестирования
interface TestClientEvents {
	// Базовые события без ACK
	message: (data: string) => void;
	ping: () => void;

	// События с ACK от клиента к серверу
	echo: (data: string, callback: (response: string) => void) => void;
	get_user_info: (
		callback: (info: { id: string; name: string; timestamp: string }) => void
	) => void;
	calculate: (
		data: { operation: string; a: number; b: number },
		callback: (result: { result?: number; error?: string }) => void
	) => void;
	trigger_error: (callback: (error: { error: string; code: number }) => void) => void;
	slow_response: (callback: (response: string) => void) => void;

	// Запросы server-to-client ACK
	request_ping_back: () => void;
	request_validation: (data: any) => void;
}

interface TestServerEvents {
	// Базовые события
	message: (data: string) => void;
	pong: () => void;

	// События с ACK от сервера к клиенту
	server_ping: (callback: (response: string) => void) => void;
	validate_data: (
		data: any,
		callback: (result: { valid: boolean; message: string }) => void
	) => void;
	request_feedback: (data: string, callback: (feedback: string) => void) => void;
}

// Создаем типизированный namespace для тестов
const testNamespace = io.of<TestClientEvents, TestServerEvents>('/');

testNamespace.on('connect', (socket) => {
	console.log('\n|||||||||||||||||||||||||||||||||||||||||||||\n');
	console.log(`🧪 Test socket ${socket.id} connected`);

	// ===== ОБРАБОТЧИКИ СОБЫТИЙ БЕЗ ACK =====

	socket.on('message', (data) => {
		console.log(`📨 Message from ${socket.id}:`, data);
		socket.emit('message', `Server echo: ${data}`);
		socket.broadcast.emit('message', `${socket.id} says: ${data}`);
	});

	socket.on('ping', () => {
		console.log(`📡 Ping from ${socket.id}`);
		socket.emit('pong');
	});

	// ===== ОБРАБОТЧИКИ СОБЫТИЙ С ACK (CLIENT-TO-SERVER) =====

	// Простое эхо с ACK
	socket.on('echo', (data, callback) => {
		console.log(`🔄 Echo request from ${socket.id}:`, data);

		// Имитируем небольшую задержку
		setTimeout(() => {
			callback(`Echo: ${data} (from ${socket.id})`);
		}, 100);
	});

	// Получение информации о пользователе
	socket.on('get_user_info', (callback) => {
		console.log(`👤 User info request from ${socket.id}`);

		const userInfo = {
			id: socket.id,
			name: `User_${socket.id.slice(-8)}`,
			timestamp: new Date().toISOString(),
		};

		callback(userInfo);
	});

	// Математические вычисления с обработкой ошибок
	socket.on('calculate', (data, callback) => {
		console.log(`🧮 Calculation request from ${socket.id}:`, data);

		const { operation, a, b } = data;

		if (typeof a !== 'number' || typeof b !== 'number') {
			return callback({ error: 'Invalid numbers provided' });
		}

		let result: number;
		switch (operation) {
			case 'add':
				result = a + b;
				break;
			case 'subtract':
				result = a - b;
				break;
			case 'multiply':
				result = a * b;
				break;
			case 'divide':
				if (b === 0) {
					return callback({ error: 'Division by zero' });
				}
				result = a / b;
				break;
			default:
				return callback({ error: 'Unknown operation' });
		}

		callback({ result });
	});

	// Принудительная ошибка для тестирования
	socket.on('trigger_error', (callback) => {
		console.log(`❌ Error trigger from ${socket.id}`);
		callback({
			error: 'This is a test error',
			code: 400,
		});
	});

	// Медленный ответ для тестирования timeout
	socket.on('slow_response', (callback) => {
		console.log(`⏰ Slow response request from ${socket.id}`);

		// Ждем 10 секунд перед ответом (больше чем timeout в клиенте)
		setTimeout(() => {
			callback('This response took 10 seconds');
		}, 10000);
	});

	// ===== SERVER-TO-CLIENT ACK ТЕСТЫ =====

	// Запрос ping от клиента
	socket.on('request_ping_back', () => {
		console.log(`📡 Ping back request from ${socket.id}`);

		// Отправляем ping клиенту и ждем ответ
		socket.emit('server_ping', (response) => {
			console.log(`📡 Ping response from ${socket.id}:`, response);
		});
	});

	// Запрос валидации данных
	socket.on('request_validation', (data) => {
		console.log(`🔍 Validation request from ${socket.id}:`, data);

		// Отправляем данные клиенту для валидации
		socket.emit('validate_data', data, (result) => {
			console.log(`🔍 Validation result from ${socket.id}:`, result);
		});
	});

	// ===== АВТОМАТИЧЕСКИЕ ТЕСТЫ =====

	// Отправляем приветственное сообщение
	setTimeout(() => {
		socket.emit('message', '🎉 Welcome to Socket.IO ACK Test Server!');
	}, 1000);

	// Тестируем server-to-client ACK через 3 секунды
	setTimeout(() => {
		console.log(`🧪 Testing server-to-client ACK with ${socket.id}`);

		socket.emit('server_ping', (response) => {
			console.log(`✅ Auto-test ACK response from ${socket.id}:`, response);
		});
	}, 3000);

	// Тестируем timeout ACK через 5 секунд
	setTimeout(() => {
		console.log(`⏰ Testing timeout ACK with ${socket.id}`);

		socket.timeout(2000).emit('request_feedback', 'How is the connection?', (err, feedback) => {
			if (err) {
				console.log(`⏰ Timeout from ${socket.id}:`, err.message);
			} else {
				console.log(`✅ Feedback from ${socket.id}:`, feedback);
			}
		});
	}, 5000);

	// ===== ОБРАБОТЧИК ОТКЛЮЧЕНИЯ =====

	socket.on('disconnect', (reason) => {
		console.log(`🧪 Test socket ${socket.id} disconnected: ${reason}`);
	});
});

// ===== BROADCAST ACK ТЕСТЫ =====

// Функция для тестирования broadcast ACK
export function testBroadcastAck() {
	console.log('\n🧪 Testing broadcast acknowledgments...');

	const sockets = Array.from(testNamespace.sockets.values());
	if (sockets.length === 0) {
		console.log('❌ No sockets connected for broadcast test');
		return;
	}

	console.log(`📡 Broadcasting ping to ${sockets.length} sockets`);

	// Broadcast ACK test
	testNamespace.emit('server_ping', (err, responses) => {
		if (err) {
			console.error('❌ Broadcast ACK error:', err.message);
		} else {
			console.log(`✅ Broadcast ACK: received ${responses.length} responses`);
			responses.forEach((response, index) => {
				console.log(`  Response ${index + 1}:`, response);
			});
		}
	});

	// Timeout broadcast test
	testNamespace.timeout(3000).emit('validate_data', { test: 'broadcast' }, (err, responses) => {
		if (err) {
			console.log(`⏰ Broadcast timeout: ${err.message}`);
		} else {
			console.log(`✅ Broadcast validation: ${responses.length} responses within timeout`);
		}
	});
}

// ===== STRESS TEST =====

export function stressTestAck(socketId: string, count: number = 100) {
	const socket = testNamespace.sockets.get(socketId);
	if (!socket) {
		console.log(`❌ Socket ${socketId} not found`);
		return;
	}

	console.log(`💪 Starting stress test: ${count} ACK requests to ${socketId}`);
	const startTime = Date.now();
	let completed = 0;
	let errors = 0;

	for (let i = 0; i < count; i++) {
		socket.emit('server_ping', (response) => {
			completed++;
			if (!response || response.includes('error')) {
				errors++;
			}

			if (completed === count) {
				const duration = Date.now() - startTime;
				console.log(
					`💪 Stress test completed: ${completed}/${count} in ${duration}ms, ${errors} errors`
				);
			}
		});
	}
}

// ===== УТИЛИТЫ =====

export function getConnectedSockets() {
	return Array.from(testNamespace.sockets.keys());
}

export function sendTestMessage(socketId: string, message: string) {
	const socket = testNamespace.sockets.get(socketId);
	if (socket) {
		socket.emit('message', `Test: ${message}`);
		return true;
	}
	return false;
}

// Автоматический запуск broadcast тестов каждые 30 секунд
setInterval(() => {
	if (testNamespace.sockets.size > 0) {
		testBroadcastAck();
	}
}, 30000);

console.log('🧪 ACK Test Server initialized!');
console.log('📋 Available test functions:');
console.log('  - testBroadcastAck()');
console.log('  - stressTestAck(socketId, count)');
console.log('  - getConnectedSockets()');
console.log('  - sendTestMessage(socketId, message)');
