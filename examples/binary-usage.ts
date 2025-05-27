/**
 * Пример использования бинарного протокола
 * Демонстрирует новые методы для контроля бинарного кодирования
 */

import { io } from '../src/server';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/socket.types';

// Создаем типизированный namespace
const binaryTestNamespace = io.of<ClientToServerEvents, ServerToClientEvents>('/binary-test');

binaryTestNamespace.on('connection', (socket) => {
	console.log(`🔧 Binary test socket ${socket.id} connected`);

	// ===== ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ БИНАРНОГО ФОРМАТА =====

	// 1. Обычная отправка (текстовый формат по умолчанию)
	socket.emit('message', 'This is a regular text message');
	console.log('📤 Sent regular text message');

	// 2. Принудительное использование бинарного формата для конкретного сообщения
	socket.emitBinary('ping'); // Отправится в бинарном формате если поддерживается
	socket.emitBinary('message', 'This will be binary if supported');
	console.log('📤 Sent binary messages');

	// 3. Ultra-fast emit с контролем бинарного формата
	socket.emitUltraFast('notification', 'Fast text message', false); // Текстовый
	socket.emitUltraFast('notification', 'Fast binary message', true); // Бинарный
	console.log('📤 Sent ultra-fast messages');

	// 4. Batch операции с смешанным форматом
	socket.emitBatchPooled([
		{ event: 'message', data: 'Regular message' }, // Текстовый по умолчанию
		{ event: 'ping', binary: true }, // Бинарный
		{ event: 'notification', data: 'Another text message', binary: false }, // Явно текстовый
		{ event: 'message', data: 'Binary message', binary: true }, // Бинарный
	]);
	console.log('📤 Sent batch with mixed formats');

	// ===== ПРИМЕРЫ BROADCAST С БИНАРНЫМ ФОРМАТОМ =====

	setTimeout(() => {
		// 5. Обычный broadcast (текстовый)
		binaryTestNamespace.emit('message', 'Regular broadcast message');
		console.log('📡 Sent regular broadcast');

		// 6. Принудительный бинарный broadcast
		binaryTestNamespace.binary.emit('ping'); // Бинарный формат
		binaryTestNamespace.binary.emit('message', 'Binary broadcast message');
		console.log('📡 Sent binary broadcast');

		// 7. Смешанный broadcast с использованием to/except
		binaryTestNamespace.to('room1').emit('message', 'Text to room1');
		binaryTestNamespace.to('room1').binary.emit('notification', 'Binary to room1');
		console.log('📡 Sent mixed broadcasts to room1');

		// 8. Ultra-fast broadcast с контролем формата
		binaryTestNamespace.to('room2').emitUltraFast('ping', undefined, false); // Текстовый
		binaryTestNamespace.to('room2').emitUltraFast('message', 'Fast binary', true); // Бинарный
		console.log('📡 Sent ultra-fast broadcasts to room2');

		// 9. Bulk operations с контролем формата
		binaryTestNamespace.emitBulk([
			{ event: 'message', data: 'Bulk text message' },
			{ event: 'ping', binary: true },
			{ event: 'notification', data: 'Bulk binary message', binary: true },
			{ event: 'message', data: 'Another text', rooms: 'room3' },
		]);
		console.log('📡 Sent bulk operations');
	}, 2000);

	// ===== ОБРАБОТКА ВХОДЯЩИХ СОБЫТИЙ =====

	socket.on('message', (data) => {
		console.log(`📨 Received message from ${socket.id}:`, data);

		// Ответ в том же формате что получили (автоматически детектируется парсером)
		socket.emit('message', `Echo: ${data}`);
	});

	socket.on('ping', () => {
		console.log(`📡 Received ping from ${socket.id}`);

		// Можем ответить в бинарном формате
		socket.emitBinary('pong');
	});

	socket.on('request_binary_test', () => {
		console.log(`🧪 Binary test requested by ${socket.id}`);

		// Отправляем серию сообщений в разных форматах для тестирования
		socket.emit('test_result', 'Text format');
		socket.emitBinary('test_result', 'Binary format');
		socket.emitUltraFast('test_result', 'Ultra-fast text', false);
		socket.emitUltraFast('test_result', 'Ultra-fast binary', true);
	});

	// ===== ПРИСОЕДИНЕНИЕ К КОМНАТАМ ДЛЯ ТЕСТИРОВАНИЯ =====

	socket.join(['room1', 'room2', 'room3']);
	console.log(`🏠 Socket ${socket.id} joined test rooms`);

	// ===== ОТКЛЮЧЕНИЕ =====

	socket.on('disconnect', (reason) => {
		console.log(`🔧 Binary test socket ${socket.id} disconnected: ${reason}`);
	});
});

// ===== ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ ТЕСТИРОВАНИЯ =====

export function testBinaryProtocol() {
	console.log('\n🧪 Testing binary protocol capabilities...');

	const sockets = Array.from(binaryTestNamespace.sockets.values());
	if (sockets.length === 0) {
		console.log('❌ No sockets connected to binary test namespace');
		return;
	}

	console.log(`📊 Testing with ${sockets.length} connected sockets`);

	// Тест различных форматов
	binaryTestNamespace.emit('message', 'Test: Regular broadcast');
	binaryTestNamespace.binary.emit('message', 'Test: Binary broadcast');

	sockets.forEach((socket, index) => {
		console.log(`🔧 Testing socket ${index + 1}/${sockets.length}: ${socket.id}`);

		socket.emit('test_message', `Regular message ${index}`);
		socket.emitBinary('test_message', `Binary message ${index}`);
		socket.emitUltraFast('test_notification', `Fast text ${index}`, false);
		socket.emitUltraFast('test_notification', `Fast binary ${index}`, true);
	});

	console.log('✅ Binary protocol test completed');
}

export function benchmarkBinaryVsText(iterations: number = 1000) {
	console.log(`\n⚡ Benchmarking binary vs text performance (${iterations} iterations)...`);

	const sockets = Array.from(binaryTestNamespace.sockets.values());
	if (sockets.length === 0) {
		console.log('❌ No sockets for benchmark');
		return;
	}

	const socket = sockets[0];
	const testData = 'Benchmark test message';

	// Benchmark текстового формата
	console.time('Text Format');
	for (let i = 0; i < iterations; i++) {
		socket.emit('benchmark', testData);
	}
	console.timeEnd('Text Format');

	// Benchmark бинарного формата
	console.time('Binary Format');
	for (let i = 0; i < iterations; i++) {
		socket.emitBinary('benchmark', testData);
	}
	console.timeEnd('Binary Format');

	// Benchmark ultra-fast текстового
	console.time('Ultra-fast Text');
	for (let i = 0; i < iterations; i++) {
		socket.emitUltraFast('benchmark', testData, false);
	}
	console.timeEnd('Ultra-fast Text');

	// Benchmark ultra-fast бинарного
	console.time('Ultra-fast Binary');
	for (let i = 0; i < iterations; i++) {
		socket.emitUltraFast('benchmark', testData, true);
	}
	console.timeEnd('Ultra-fast Binary');

	console.log('📊 Benchmark completed');
}

// ===== АВТОМАТИЧЕСКОЕ ТЕСТИРОВАНИЕ =====

// Запускаем тесты каждые 30 секунд если есть подключенные сокеты
setInterval(() => {
	if (binaryTestNamespace.socketsCount > 0) {
		testBinaryProtocol();
	}
}, 30000);

console.log('🔧 Binary test namespace initialized');
console.log('📝 Available functions:');
console.log('  - testBinaryProtocol() - Test binary protocol capabilities');
console.log('  - benchmarkBinaryVsText(iterations) - Benchmark performance');
console.log('💡 Connect to /binary-test namespace to test binary features');
