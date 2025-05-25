/**
 * Enhanced Server Test Example
 * Обновлен под новый унифицированный Socket API
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

	// Новые события для тестирования
	binary_ping: () => void;
	binary_message: (data: string) => void;
	performance_test: (type: string, iterations: number) => void;
	stress_test: (type: string, count: number) => void;

	// Broadcast тесты
	broadcast_test: () => void;
	room_test: () => void;
	binary_broadcast_test: () => void;

	// Server-to-client ACK тесты
	request_ping_back: () => void;
	request_validation: (data: any) => void;

	// Унифицированные ACK тесты
	ack_test: (data: string, callback: (response: string) => void) => void;
	batch_test: () => void;
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
}

// Создаем типизированный namespace для тестов
const testNamespace = io.of<EnhancedClientEvents, EnhancedServerEvents>('/');

const isProduction = process.env.NODE_ENV === 'production';

testNamespace.on('connection', (socket) => {
	if (!isProduction) {
		console.log(`🧪 Enhanced test socket ${socket.id} connected`);
		console.log(`📊 Total connected sockets: ${testNamespace.socketsCount}`);
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

	// ===== БИНАРНЫЕ ОБРАБОТЧИКИ =====

	socket.on('binary_ping', () => {
		if (!isProduction) {
			console.log(`🔥 Binary ping from ${socket.id}`);
		}
		socket.emitBinary('binary_pong');
	});

	socket.on('binary_message', (data) => {
		if (!isProduction) {
			console.log(`🔥 Binary message from ${socket.id}:`, data);
		}
		socket.emitBinary('binary_notification', `Binary echo: ${data}`);
	});

	// ===== УНИФИЦИРОВАННЫЕ ACK ОБРАБОТЧИКИ =====

	socket.on('echo', (data, callback) => {
		if (!isProduction) {
			console.log(`🔄 Echo request from ${socket.id}:`, data);
		}

		if (typeof callback === 'function') {
			setTimeout(() => {
				callback(`Echo: ${data} (from ${socket.id})`);
			}, 5);
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

	// ===== НОВЫЕ УНИФИЦИРОВАННЫЕ ACK ТЕСТЫ =====

	socket.on('ack_test', (data, callback) => {
		if (!isProduction) {
			console.log(`🔄 Unified ACK test from ${socket.id}:`, data);
		}

		if (typeof callback === 'function') {
			callback(`ack_response_${data}`);
		}
	});

	socket.on('performance_ack_request', (data) => {
		// Немедленно отвечаем
		socket.emit('performance_ack_response', {
			id: data.id,
			priority: data.priority,
			serverTimestamp: Date.now(),
			clientTimestamp: data.timestamp,
		});
	});

	// ===== ТЕСТОВЫЕ ОБРАБОТЧИКИ =====

	socket.on('batch_test', () => {
		if (!isProduction) {
			console.log(`📦 Batch test from ${socket.id}`);
		}

		// Тестируем batch операции
		const success = socket.emitBatch([
			{ event: 'test_result', data: 'Batch item 1' },
			{ event: 'test_result', data: 'Batch item 2', binary: false },
			{ event: 'notification', data: 'Binary batch item', binary: true },
			{ event: 'test_result', data: 'Batch item 3' },
		]);

		console.log(`📦 Batch results: ${success} successful operations`);
	});

	socket.on('performance_test', (type, iterations) => {
		console.log(`⚡ Performance test: ${type} x ${iterations} from ${socket.id}`);

		const startTime = Date.now();
		let successful = 0;

		switch (type) {
			case 'emit':
				for (let i = 0; i < iterations; i++) {
					if (socket.emit('test_result', `emit_${i}`)) successful++;
				}
				break;

			case 'emitBinary':
				for (let i = 0; i < iterations; i++) {
					if (socket.emitBinary('notification', `binary_${i}`)) successful++;
				}
				break;

			case 'emitFast':
				for (let i = 0; i < iterations; i++) {
					if (socket.emitFast('test_result', `fast_${i}`)) successful++;
				}
				break;

			case 'emitWithAck':
				let completed = 0;
				const finish = () => {
					const endTime = Date.now();
					const duration = endTime - startTime;
					const opsPerSecond = Math.round((iterations / duration) * 1000);

					socket.emit('performance_result', {
						type: 'emitWithAck',
						time: duration,
						ops: opsPerSecond,
					});

					console.log(`⚡ ACK Performance: ${duration}ms, ${opsPerSecond} ops/sec`);
				};

				for (let i = 0; i < iterations; i++) {
					socket.emitWithAck(
						'ack_test',
						`perf_${i}`,
						(err, response) => {
							if (!err && response) successful++;
							completed++;
							if (completed === iterations) finish();
						},
						{ priority: 'high' } // Быстрые ACK для performance тестов
					);
				}
				return; // Не отправляем результат сразу

			case 'batch':
				const batchEvents = [];
				for (let i = 0; i < iterations; i++) {
					batchEvents.push({
						event: 'test_result',
						data: `batch_${i}`,
						binary: i % 2 === 0,
					});
				}
				successful = socket.emitBatch(batchEvents);
				break;

			default:
				socket.emit('test_result', { error: `Unknown test type: ${type}` });
				return;
		}

		const endTime = Date.now();
		const duration = endTime - startTime;
		const opsPerSecond = Math.round((iterations / duration) * 1000);

		socket.emit('performance_result', {
			type,
			time: duration,
			ops: opsPerSecond,
		});

		console.log(
			`⚡ ${type} Performance: ${duration}ms, ${opsPerSecond} ops/sec, ${successful}/${iterations} successful`
		);
	});

	socket.on('stress_test', (type, count) => {
		console.log(`💪 Stress test: ${type} x ${count} from ${socket.id}`);

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
				`💪 Stress ${type}: ${completed}/${count}, ${duration}ms, ${opsPerSecond} ops/sec`
			);
		};

		switch (type) {
			case 'ack':
				for (let i = 0; i < count; i++) {
					setTimeout(() => {
						try {
							socket.emitWithAck(
								'ack_test',
								`stress_${i}`,
								(err, response) => {
									completed++;
									if (err) errors++;
									if (completed === count) finish();
								},
								{ priority: 'high', timeout: 3000 }
							);
						} catch (error) {
							errors++;
							completed++;
							if (completed === count) finish();
						}
					}, Math.floor(i / 50)); // Батчинг по 50
				}
				break;

			case 'emit':
				for (let i = 0; i < count; i++) {
					if (socket.emit('test_result', `stress_emit_${i}`)) {
						completed++;
					} else {
						errors++;
						completed++;
					}
				}
				finish();
				break;

			case 'binary':
				for (let i = 0; i < count; i++) {
					if (socket.emitBinary('notification', `stress_binary_${i}`)) {
						completed++;
					} else {
						errors++;
						completed++;
					}
				}
				finish();
				break;

			default:
				socket.emit('test_result', { error: `Unknown stress type: ${type}` });
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

		socket.emit('test_result', 'Broadcast tests completed');
	});

	socket.on('room_test', () => {
		console.log(`🏠 Room test from ${socket.id}`);

		socket.join('test-room');
		socket.to('test-room').emit('notification', `${socket.id} joined test-room`);

		socket.emit('test_result', 'Room tests completed');
	});

	socket.on('binary_broadcast_test', () => {
		console.log(`🔥 Binary broadcast test from ${socket.id}`);

		testNamespace.binary.emit('binary_notification', 'Global binary broadcast');
		testNamespace.binary.to('test-room').emit('binary_notification', 'Room binary broadcast');

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

	// ===== АВТОМАТИЧЕСКИЕ ТЕСТЫ ПРИ ПОДКЛЮЧЕНИИ =====

	setTimeout(() => {
		socket.emit('message', '🎉 Enhanced test server ready!');
		socket.emitBinary('binary_notification', '🔥 Binary protocol available!');
	}, 1000);

	// Присоединяем к тестовой комнате
	socket.join('test-room');
	console.log(`🏠 Socket ${socket.id} joined test-room`);

	socket.on('disconnect', (reason) => {
		if (!isProduction) {
			console.log(`🧪 Enhanced test socket ${socket.id} disconnected: ${reason}`);
			console.log(`📊 Remaining connected sockets: ${testNamespace.socketsCount}`);
		}
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

		const iterations = 1000;

		// Тест обычного emit
		console.time(`Socket ${index + 1} - Regular emit`);
		for (let i = 0; i < iterations; i++) {
			socket.emit('test_result', `regular ${i}`);
		}
		console.timeEnd(`Socket ${index + 1} - Regular emit`);

		// Тест бинарного emit
		console.time(`Socket ${index + 1} - Binary emit`);
		for (let i = 0; i < iterations; i++) {
			socket.emitBinary('notification', `binary ${i}`);
		}
		console.timeEnd(`Socket ${index + 1} - Binary emit`);

		// Тест быстрого emit
		console.time(`Socket ${index + 1} - Fast emit`);
		for (let i = 0; i < iterations; i++) {
			socket.emitFast('test_result', `fast ${i}`);
		}
		console.timeEnd(`Socket ${index + 1} - Fast emit`);

		// Тест batch
		console.time(`Socket ${index + 1} - Batch`);
		const batchEvents = [];
		for (let i = 0; i < iterations; i++) {
			batchEvents.push({ event: 'test_result', data: `batch ${i}` });
		}
		socket.emitBatch(batchEvents);
		console.timeEnd(`Socket ${index + 1} - Batch`);

		// Тест ACK
		console.time(`Socket ${index + 1} - ACK`);
		let ackCompleted = 0;
		const ackIterations = 100; // Меньше для ACK тестов

		for (let i = 0; i < ackIterations; i++) {
			socket.emitWithAck(
				'ack_test',
				`ack_${i}`,
				(err, response) => {
					ackCompleted++;
					if (ackCompleted === ackIterations) {
						console.timeEnd(`Socket ${index + 1} - ACK`);
					}
				},
				{ priority: 'high' }
			);
		}
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

	console.time('Fast broadcast');
	for (let i = 0; i < iterations; i++) {
		testNamespace.emitFast('test_result', `fast broadcast ${i}`);
	}
	console.timeEnd('Fast broadcast');

	console.log('✅ Broadcast performance tests completed');
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

console.log('🧪 Enhanced test server initialized with unified ACK system');
