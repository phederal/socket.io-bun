/**
 * Enhanced Server Test Example
 * Демонстрирует все новые методы и оптимизации
 */

import { io } from '../socket/server';

// Расширяем типы для полного тестирования
interface EnhancedClientEvents {
	// Базовые события
	message: (data: string) => void;
	ping: () => void;
	notification: (data: string) => void;

	// События с ACK
	echo: (data: string, callback: (response: string) => void) => void;
	get_user_info: (
		callback: (info: { id: string; name: string; timestamp: string }) => void
	) => void;
	calculate: (
		data: { operation: string; a: number; b: number },
		callback: (result: { result?: number; error?: string }) => void
	) => void;

	// Новые события для тестирования бинарного формата
	binary_ping: () => void;
	binary_message: (data: string) => void;
	ultra_fast_test: (data: string) => void;
	batch_test: () => void;
	performance_test: (type: string, iterations: number) => void;
	stress_test: (type: string, count: number) => void;

	// Broadcast тесты
	broadcast_test: () => void;
	room_test: () => void;
	binary_broadcast_test: () => void;

	// Server-to-client ACK тесты
	request_ping_back: () => void;
	request_validation: (data: any) => void;
}

interface EnhancedServerEvents {
	// Базовые события
	message: (data: string) => void;
	pong: () => void;
	notification: (data: string) => void;

	// Бинарные события
	binary_pong: () => void;
	binary_notification: (data: string) => void;

	// Тестовые события
	test_result: (data: any) => void;
	performance_result: (data: { type: string; time: number; ops: number }) => void;

	// События с ACK от сервера к клиенту
	server_ping: (callback: (response: string) => void) => void;
	validate_data: (
		data: any,
		callback: (result: { valid: boolean; message: string }) => void
	) => void;
	benchmark_ping: (callback: (response: string) => void) => void;
}

// Создаем типизированный namespace для тестов
const testNamespace = io.of<EnhancedClientEvents, EnhancedServerEvents>('/');

const isProduction = process.env.NODE_ENV === 'production';

testNamespace.on('connection', (socket) => {
	if (!isProduction) {
		console.log(`🧪 Enhanced test socket ${socket.id} connected`);
	}

	// ===== БАЗОВЫЕ ОБРАБОТЧИКИ =====

	socket.on('message', (data) => {
		if (!isProduction) {
			console.log(`📨 Message from ${socket.id}:`, data);
		}
		socket.emit('message', `Echo: ${data}`);
		socket.broadcast.emit('message', `${socket.id} says: ${data}`);
	});

	socket.on('ping', () => {
		if (!isProduction) {
			console.log(`📡 Regular ping from ${socket.id}`);
		}
		socket.emit('pong');
	});

	// ===== НОВЫЕ БИНАРНЫЕ ОБРАБОТЧИКИ =====

	socket.on('binary_ping', () => {
		if (!isProduction) {
			console.log(`🔥 Binary ping from ${socket.id}`);
		}
		// Отвечаем в бинарном формате
		socket.emitBinary('binary_pong');
	});

	socket.on('binary_message', (data) => {
		if (!isProduction) {
			console.log(`🔥 Binary message from ${socket.id}:`, data);
		}
		// Эхо в бинарном формате
		socket.emitBinary('binary_notification', `Binary echo: ${data}`);
	});

	socket.on('ultra_fast_test', (data) => {
		if (!isProduction) {
			console.log(`⚡ Ultra fast test from ${socket.id}:`, data);
		}
		// Тестируем все варианты ultra fast
		socket.emitUltraFast('notification', `Ultra text: ${data}`, false);
		socket.emitUltraFast('notification', `Ultra binary: ${data}`, true);
	});

	// ===== ACK ОБРАБОТЧИКИ =====

	socket.on('echo', (data, callback) => {
		if (!isProduction) {
			console.log(`🔄 Echo request from ${socket.id}:`, data);
		}

		// Проверяем что callback действительно функция
		if (typeof callback === 'function') {
			setTimeout(() => {
				callback(`Echo: ${data} (from ${socket.id})`);
			}, 5); // Минимальная задержка
		} else {
			console.warn(`[Server] Echo callback is not a function for ${socket.id}`);
		}
	});

	socket.on('get_user_info', (callback) => {
		if (!isProduction) {
			console.log(`👤 User info request from ${socket.id}`);
		}
		const userInfo = {
			id: socket.id,
			name: `User_${socket.id.slice(-8)}`,
			timestamp: new Date().toISOString(),
		};
		callback(userInfo);
	});

	socket.on('calculate', (data, callback) => {
		if (!isProduction) {
			console.log(`🧮 Calculation request from ${socket.id}:`, data);
		}
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
				if (b === 0) return callback({ error: 'Division by zero' });
				result = a / b;
				break;
			default:
				return callback({ error: 'Unknown operation' });
		}

		callback({ result });
	});

	// ===== НОВЫЕ ТЕСТОВЫЕ ОБРАБОТЧИКИ =====

	socket.on('batch_test', () => {
		if (!isProduction) {
			console.log(`📦 Batch test from ${socket.id}`);
		}

		// Тестируем обычный batch
		const success1 = socket.emitBatch([
			{ event: 'test_result', data: 'Batch item 1' },
			{ event: 'test_result', data: 'Batch item 2' },
			{ event: 'test_result', data: 'Batch item 3' },
		]);

		// Тестируем pooled batch с binary контролем
		const success2 = socket.emitBatchPooled([
			{ event: 'test_result', data: 'Pooled text 1' },
			{ event: 'notification', data: 'Pooled binary 1', binary: true },
			{ event: 'test_result', data: 'Pooled text 2' },
			{ event: 'notification', data: 'Pooled binary 2', binary: true },
		]);

		console.log(`📦 Batch results: normal=${success1}, pooled=${success2}`);
	});

	socket.on('performance_test', (type, iterations) => {
		console.log(`⚡ Performance test: ${type} x ${iterations} from ${socket.id}`);

		if (type === 'fastAck') {
			// Специальная обработка для Fast ACK тестов
			const startTime = Date.now();
			let completed = 0;
			let successful = 0;

			const finish = () => {
				const endTime = Date.now();
				const duration = endTime - startTime;
				const opsPerSecond = Math.round((iterations / duration) * 1000);

				socket.emit('performance_result', {
					type: 'Fast ACK',
					time: duration,
					ops: opsPerSecond,
					successful,
					total: iterations,
				});

				console.log(
					`⚡ Fast ACK Performance: ${duration}ms, ${opsPerSecond} ops/sec, ${successful}/${iterations} successful`
				);
			};

			for (let i = 0; i < iterations; i++) {
				setTimeout(() => {
					socket.emit('fast_ack_test', `perf_${i}`, (response) => {
						if (response) successful++;
						completed++;
						if (completed === iterations) finish();
					});
				}, Math.floor(i / 500)); // Батчинг для избежания перегрузки
			}
		} else {
			// Остальные performance тесты без изменений
			const startTime = Date.now();

			switch (
				type
				// ... остальные случаи
			) {
			}
		}
	});

	socket.on('stress_test', (type, count) => {
		console.log(`💪 Stress test: ${type} x ${count} from ${socket.id}`);

		if (type === 'ack') {
			// Для ACK stress test отправляем события которые клиент ТОЧНО обработает
			const startTime = Date.now();
			let completed = 0;
			let errors = 0;

			const finish = () => {
				const duration = Date.now() - startTime;
				const opsPerSecond = Math.round((count / duration) * 1000);

				socket.emit('test_result', {
					type: `stress_${type}`,
					completed,
					errors,
					duration,
					opsPerSecond,
				});

				console.log(
					`💪 Stress ACK: ${completed}/${count}, ${duration}ms, ${opsPerSecond} ops/sec`
				);
			};

			// Отправляем stress_ack_test события вместо benchmark_ping
			for (let i = 0; i < count; i++) {
				setTimeout(() => {
					try {
						socket.emit('stress_ack_test', `data_${i}`, (response) => {
							completed++;
							if (completed === count) finish();
						});
					} catch (error) {
						errors++;
						completed++;
						if (completed === count) finish();
					}
				}, Math.floor(i / 100)); // Небольшая задержка для предотвращения перегрузки
			}
		} else {
			// Обработка других типов stress тестов без изменений
			// ... остальной код
		}
	});

	socket.on('benchmark_ping', (callback) => {
		if (!isProduction) {
			console.log(`📊 Benchmark ping from ${socket.id}`);
		}

		if (typeof callback === 'function') {
			callback('benchmark_pong');
		}
	});

	// ===== BROADCAST ТЕСТЫ =====

	socket.on('broadcast_test', () => {
		console.log(`📡 Broadcast test from ${socket.id}`);

		// Обычный broadcast
		testNamespace.emit('notification', 'Regular broadcast from server');

		// Бинарный broadcast
		testNamespace.binary.emit('binary_notification', 'Binary broadcast from server');

		// Room broadcast
		testNamespace.to('test-room').emit('notification', 'Room broadcast');
		testNamespace.to('test-room').binary.emit('binary_notification', 'Binary room broadcast');

		// Bulk broadcast
		testNamespace.emitBulk([
			{ event: 'notification', data: 'Bulk broadcast 1' },
			{ event: 'binary_notification', data: 'Bulk binary 1', binary: true },
			{ event: 'notification', data: 'Bulk broadcast 2', rooms: 'test-room' },
		]);

		socket.emit('test_result', 'Broadcast tests completed');
	});

	socket.on('room_test', () => {
		console.log(`🏠 Room test from ${socket.id}`);

		// Присоединяемся к тестовой комнате
		socket.join('test-room');

		// Broadcast в комнату
		socket.to('test-room').emit('notification', `${socket.id} joined test-room`);
		socket.to('test-room').binary.emit('binary_notification', `Binary: ${socket.id} in room`);

		socket.emit('test_result', 'Room tests completed');
	});

	socket.on('binary_broadcast_test', () => {
		console.log(`🔥 Binary broadcast test from ${socket.id}`);

		// Различные бинарные broadcast операции
		testNamespace.binary.emit('binary_notification', 'Global binary broadcast');
		testNamespace.binary.to('test-room').emit('binary_notification', 'Room binary broadcast');
		testNamespace.binary.except(socket.id).emit('binary_notification', 'Binary except sender');

		// Ultra fast broadcast
		testNamespace
			.to('test-room')
			.emitUltraFast('binary_notification', 'Ultra fast binary', true);

		socket.emit('test_result', 'Binary broadcast tests completed');
	});

	// ===== SERVER-TO-CLIENT ACK ТЕСТЫ =====

	socket.on('request_ping_back', () => {
		console.log(`📡 Ping back request from ${socket.id}`);
		socket.emit('server_ping', (response) => {
			console.log(`📡 Ping response from ${socket.id}:`, response);
		});
	});

	socket.on('request_validation', (data) => {
		console.log(`🔍 Validation request from ${socket.id}:`, data);
		socket.emit('validate_data', data, (result) => {
			console.log(`🔍 Validation result from ${socket.id}:`, result);
		});
	});

	// 2. Добавляем правильный обработчик для fast_ack_test
	socket.on('fast_ack_test', (data, callback) => {
		if (!isProduction) {
			console.log(`⚡ Fast ACK test from ${socket.id}:`, data);
		}

		if (typeof callback === 'function') {
			// Немедленный ответ без setTimeout для максимальной скорости
			callback(`fast_ack_response_${data}`);
		} else {
			console.warn(`[Server] Fast ACK callback is not a function for ${socket.id}`);
		}
	});

	// ===== АВТОМАТИЧЕСКИЕ ТЕСТЫ ПРИ ПОДКЛЮЧЕНИИ =====

	setTimeout(() => {
		socket.emit('message', '🎉 Enhanced test server ready!');
		socket.emitBinary('binary_notification', '🔥 Binary protocol available!');
	}, 1000);

	// Присоединяем к тестовой комнате
	socket.join('test-room');
	console.log(`🏠 Socket ${socket.id} joined test-room`);

	socket.on('disconnect', (reason) => {
		console.log(`🧪 Enhanced test socket ${socket.id} disconnected: ${reason}`);
	});
});

// ===== ГЛОБАЛЬНЫЕ ФУНКЦИИ ТЕСТИРОВАНИЯ =====

export function runServerPerformanceTest() {
	console.log('\n🚀 Running server-side performance tests...');

	const sockets = Array.from(testNamespace.sockets.values());
	if (sockets.length === 0) {
		console.log('❌ No sockets connected for testing');
		return;
	}

	console.log(`📊 Testing with ${sockets.length} connected sockets`);

	sockets.forEach((socket, index) => {
		console.log(`🧪 Testing socket ${index + 1}: ${socket.id}`);

		// Тест различных методов emit
		const iterations = 1000;

		console.time(`Socket ${index + 1} - Regular emit`);
		for (let i = 0; i < iterations; i++) {
			socket.emit('test_result', `regular ${i}`);
		}
		console.timeEnd(`Socket ${index + 1} - Regular emit`);

		console.time(`Socket ${index + 1} - Binary emit`);
		for (let i = 0; i < iterations; i++) {
			socket.emitBinary('notification', `binary ${i}`);
		}
		console.timeEnd(`Socket ${index + 1} - Binary emit`);

		console.time(`Socket ${index + 1} - Ultra fast`);
		for (let i = 0; i < iterations; i++) {
			socket.emitUltraFast('notification', `ultra ${i}`, true);
		}
		console.timeEnd(`Socket ${index + 1} - Ultra fast`);

		console.time(`Socket ${index + 1} - Batch`);
		const batchSize = 100;
		for (let i = 0; i < iterations / batchSize; i++) {
			const batch = [];
			for (let j = 0; j < batchSize; j++) {
				batch.push({ event: 'test_result', data: `batch ${i}_${j}` });
			}
			socket.emitBatch(batch);
		}
		console.timeEnd(`Socket ${index + 1} - Batch`);
	});

	console.log('✅ Server performance tests completed');
}

export function runBroadcastPerformanceTest() {
	console.log('\n📡 Running broadcast performance tests...');

	const iterations = 5000;

	console.time('Regular broadcast');
	for (let i = 0; i < iterations; i++) {
		testNamespace.emit('test_result', `broadcast ${i}`);
	}
	console.timeEnd('Regular broadcast');

	console.time('Binary broadcast');
	for (let i = 0; i < iterations; i++) {
		testNamespace.binary.emit('binary_notification', `binary broadcast ${i}`);
	}
	console.timeEnd('Binary broadcast');

	console.time('Ultra fast broadcast');
	for (let i = 0; i < iterations; i++) {
		testNamespace.emitUltraFast('notification', `ultra broadcast ${i}`, true);
	}
	console.timeEnd('Ultra fast broadcast');

	console.time('Bulk broadcast');
	const bulkOps = [];
	for (let i = 0; i < iterations; i++) {
		bulkOps.push({ event: 'test_result', data: `bulk ${i}` });
	}
	testNamespace.emitBulk(bulkOps);
	console.timeEnd('Bulk broadcast');

	console.log('✅ Broadcast performance tests completed');
}

export function runMemoryStressTest() {
	console.log('\n🧠 Running memory stress test...');

	const sockets = Array.from(testNamespace.sockets.values());
	if (sockets.length === 0) {
		console.log('❌ No sockets connected for testing');
		return;
	}

	const socket = sockets[0];
	const iterations = 50000;

	console.log(`🔥 Sending ${iterations} messages...`);

	const startMemory = process.memoryUsage();
	const startTime = Date.now();

	for (let i = 0; i < iterations; i++) {
		if (i % 5 === 0) {
			socket.emitBinary('notification', `memory test ${i}`);
		} else {
			socket.emit('test_result', `memory test ${i}`);
		}
	}

	const endTime = Date.now();
	const endMemory = process.memoryUsage();

	console.log(`⏱️  Duration: ${endTime - startTime}ms`);
	console.log(`🧠 Memory delta: ${(endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024} MB`);
	console.log(`📊 Rate: ${Math.round((iterations / (endTime - startTime)) * 1000)} ops/sec`);

	// Принудительная сборка мусора если доступна
	if (global.gc) {
		global.gc();
		const afterGC = process.memoryUsage();
		console.log(`🗑️  After GC: ${afterGC.heapUsed / 1024 / 1024} MB`);
	}

	console.log('✅ Memory stress test completed');
}

// Экспорт утилит
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

export function sendBinaryTestMessage(socketId: string, message: string) {
	const socket = testNamespace.sockets.get(socketId);
	if (socket) {
		socket.emitBinary('binary_notification', `Binary Test: ${message}`);
		return true;
	}
	return false;
}

console.log('🧪 Enhanced test server initialized');
console.log('📝 Available functions:');
console.log('  - runServerPerformanceTest() - Test server-side performance');
console.log('  - runBroadcastPerformanceTest() - Test broadcast performance');
console.log('  - runMemoryStressTest() - Test memory usage under load');
console.log('🔥 Enhanced features: binary protocol, ultra-fast methods, batch operations');
