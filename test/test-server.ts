/**
 * Упрощенный тестовый сервер
 * Только необходимые обработчики событий
 */

import { io } from '../socket/server';

const isProduction = process.env.NODE_ENV === 'production';

// Простые типы событий
interface SimpleClientEvents {
	message: (data: string) => void;
	ping: () => void;
	notification: (data: string) => void;
	echo: (data: string, callback: (response: string) => void) => void;
	get_user_info: (
		callback: (info: { id: string; name: string; timestamp: string }) => void
	) => void;
	calculate: (
		data: { operation: string; a: number; b: number },
		callback: (result: { result?: number; error?: string }) => void
	) => void;
	ack_test: (data: string, callback: (response: string) => void) => void;
	batch_test: () => void;
	performance_test: (type: string, iterations: number) => void;
}

interface SimpleServerEvents {
	message: (data: string) => void;
	pong: () => void;
	notification: (data: string) => void;
	binary_pong: () => void;
	binary_notification: (data: string) => void;
	test_result: (data: any) => void;
	performance_result: (data: { type: string; time: number; ops: number }) => void;
}

// Создаем простой namespace
const testNamespace = io.of<SimpleClientEvents, SimpleServerEvents>('/');

testNamespace.on('connection', (socket) => {
	if (!isProduction) {
		console.log(`🧪 Test socket ${socket.id} connected`);
		console.log(`📊 Total sockets: ${testNamespace.socketsCount}`);
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
			console.log(`📡 Ping from ${socket.id}`);
		}
		socket.emit('pong');
	});

	// ===== ACK ОБРАБОТЧИКИ =====

	socket.on('echo', (data, callback) => {
		if (!isProduction) {
			console.log(`🔄 Echo request from ${socket.id}:`, data);
		}

		if (typeof callback === 'function') {
			callback(`Echo: ${data} (from ${socket.id})`);
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

	socket.on('ack_test', (data, callback) => {
		if (!isProduction) {
			console.log(`🔄 ACK test from ${socket.id}:`, data);
		}

		if (typeof callback === 'function') {
			callback(`ack_response_${data}`);
		}
	});

	// ===== PERFORMANCE ОБРАБОТЧИКИ =====

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

			case 'batch':
				const batchEvents = [];
				for (let i = 0; i < iterations; i++) {
					batchEvents.push({
						event: 'test_result',
						data: `batch_${i}`,
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
			`⚡ ${type}: ${duration}ms, ${opsPerSecond} ops/sec, ${successful}/${iterations} successful`
		);
	});

	socket.on('batch_test', () => {
		if (!isProduction) {
			console.log(`📦 Batch test from ${socket.id}`);
		}

		const success = socket.emitBatch([
			{ event: 'test_result', data: 'Batch item 1' },
			{ event: 'test_result', data: 'Batch item 2' },
			{ event: 'notification', data: 'Batch item 3' },
		]);

		console.log(`📦 Batch success: ${success} operations`);
	});

	// ===== АВТОМАТИЧЕСКИЕ ТЕСТЫ =====

	setTimeout(() => {
		socket.emit('message', '🎉 Simple test server ready!');
		socket.emitBinary('binary_notification', '🔥 Binary protocol ready!');
	}, 1000);

	// Присоединяем к тестовой комнате
	socket.join('test-room');
	if (!isProduction) {
		console.log(`🏠 Socket ${socket.id} joined test-room`);
	}

	socket.on('disconnect', (reason) => {
		if (!isProduction) {
			console.log(`🧪 Test socket ${socket.id} disconnected: ${reason}`);
			console.log(`📊 Remaining sockets: ${testNamespace.socketsCount}`);
		}
	});
});

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

console.log('🧪 Simple test server initialized');
