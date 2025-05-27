/**
 * Тестирование acknowledgments во всех вариантах использования
 */

import { io } from '../src/server';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/socket.types';

// Расширяем типы для тестирования acknowledgments
interface TestClientEvents extends ClientToServerEvents {
	get_server_info: (callback: (info: { version: string; uptime: number }) => void) => void;
	ping_with_data: (data: string, callback: (response: string) => void) => void;
	simple_ping: (callback: () => void) => void;
	request_user_count: (callback: (count: number) => void) => void;
}

interface TestServerEvents extends ServerToClientEvents {
	server_ping: (callback: (pong: string) => void) => void;
	get_client_info: (callback: (info: { id: string; rooms: string[] }) => void) => void;
	check_status: (callback: () => void) => void;
	broadcast_test: (data: string, callback: (received: boolean) => void) => void;
}

// Создаем тестовый namespace
const testNamespace = io.of<TestClientEvents, TestServerEvents>('/test');

testNamespace.on('connection', (socket) => {
	console.log(`Test socket ${socket.id} connected`);

	// ===== ТЕСТИРОВАНИЕ ACKNOWLEDGMENTS ДЛЯ SOCKET =====

	// ✅ Тест 1: emit(event, callback)
	socket.on('simple_ping', (callback) => {
		console.log('Received simple ping');
		callback(); // Простой ack без данных
	});

	// ✅ Тест 2: emit(event, data, callback)
	socket.on('ping_with_data', (data, callback) => {
		console.log('Received ping with data:', data);
		callback(`Pong: ${data}`); // Ack с данными
	});

	// ✅ Тест 3: emit(event, callback) с объектом
	socket.on('get_server_info', (callback) => {
		callback({
			version: '1.0.0',
			uptime: process.uptime(),
		});
	});

	// ✅ Тест 4: emit(event, callback) с числом
	socket.on('request_user_count', (callback) => {
		callback(testNamespace.socketsCount);
	});

	// ===== ТЕСТИРОВАНИЕ ИСХОДЯЩИХ ACKNOWLEDGMENTS =====

	// Периодически тестируем исходящие acks
	const testOutgoingAcks = () => {
		// ✅ Тест исходящего ack: socket.emit(event, callback)
		socket.emit('check_status', () => {
			console.log(`Socket ${socket.id} confirmed status check`);
		});

		// ✅ Тест исходящего ack: socket.emit(event, data, callback)
		socket.emit('get_client_info', (info) => {
			console.log(`Client info from ${socket.id}:`, info);
		});

		// ✅ Тест timeout ack
		socket.timeout(2000).emit('server_ping', (err, response) => {
			if (err) {
				console.log(`Socket ${socket.id} did not respond to ping:`, err.message);
			} else {
				console.log(`Socket ${socket.id} ping response:`, response);
			}
		});
	};

	// Запускаем тесты через 1 секунду
	setTimeout(testOutgoingAcks, 1000);

	socket.on('disconnect', () => {
		console.log(`Test socket ${socket.id} disconnected`);
	});
});

// ===== ТЕСТИРОВАНИЕ BROADCAST ACKNOWLEDGMENTS =====

// Функция для тестирования broadcast acks
export function testBroadcastAcknowledgments() {
	console.log('\n=== TESTING BROADCAST ACKNOWLEDGMENTS ===');

	// ✅ Тест 1: Broadcast с ack без данных
	testNamespace.emit('check_status', (err, responses) => {
		if (err) {
			console.error('Broadcast ack error:', err.message);
		} else {
			console.log(`Broadcast check_status: ${responses.length} responses`);
			responses.forEach((resp, i) => {
				console.log(`  Response ${i + 1}:`, resp);
			});
		}
	});

	// ✅ Тест 2: Broadcast с данными и ack
	testNamespace.emit('broadcast_test', 'Hello everyone!', (err, responses) => {
		if (err) {
			console.error('Broadcast test error:', err.message);
		} else {
			console.log(`Broadcast test: ${responses.length} responses`);
			responses.forEach((resp, i) => {
				console.log(`  Response ${i + 1}:`, resp);
			});
		}
	});

	// ✅ Тест 3: Room broadcast с ack
	testNamespace.to('test-room').emit('get_client_info', (err, responses) => {
		if (err) {
			console.error('Room broadcast ack error:', err.message);
		} else {
			console.log(`Room broadcast: ${responses.length} responses from test-room`);
			responses.forEach((resp, i) => {
				console.log(`  Room response ${i + 1}:`, resp);
			});
		}
	});

	// ✅ Тест 4: Timeout broadcast ack
	testNamespace.timeout(1000).emit('server_ping', (err, responses) => {
		if (err) {
			console.error('Timeout broadcast error:', err.message);
		} else {
			console.log(`Timeout broadcast: ${responses.length} responses within 1s`);
			responses.forEach((resp, i) => {
				console.log(`  Timeout response ${i + 1}:`, resp);
			});
		}
	});

	// ✅ Тест 5: Except broadcast с ack
	const firstSocket = Array.from(testNamespace.sockets.keys())[0];
	if (firstSocket) {
		testNamespace.except(firstSocket).emit('check_status', (err, responses) => {
			if (err) {
				console.error('Except broadcast ack error:', err.message);
			} else {
				console.log(
					`Except broadcast: ${responses.length} responses (excluding ${firstSocket})`
				);
			}
		});
	}
}

// ===== АВТОМАТИЧЕСКОЕ ТЕСТИРОВАНИЕ =====

// Запускаем тесты каждые 10 секунд если есть подключенные сокеты
setInterval(() => {
	if (testNamespace.socketsCount > 0) {
		testBroadcastAcknowledgments();
	}
}, 10000);

// ===== УТИЛИТЫ ДЛЯ ТЕСТИРОВАНИЯ =====

export function manualAckTest() {
	console.log('\n=== MANUAL ACK TEST ===');

	// Получаем первый сокет для тестирования
	const sockets = Array.from(testNamespace.sockets.values());
	if (sockets.length === 0) {
		console.log('No sockets connected for testing');
		return;
	}

	const socket = sockets[0];
	if (!socket) {
		console.log('No socket found for testing');
		return;
	}

	// ✅