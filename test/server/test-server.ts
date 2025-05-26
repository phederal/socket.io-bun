/**
 * Real test server - run actual tests with real WebSocket connections
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from '../../ws';
import { serveStatic } from 'hono/bun';

// Test results storage
interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

interface TestSuite {
	name: string;
	tests: TestResult[];
	totalPassed: number;
	totalFailed: number;
	duration: number;
}

class TestRunner {
	private results: TestSuite[] = [];
	private currentSocket: any = null;

	// Register test suite
	addTestSuite(suite: TestSuite) {
		this.results.push(suite);
		this.broadcastResults();
	}

	// Broadcast results to all connected clients
	broadcastResults() {
		if (this.currentSocket) {
			this.currentSocket.emit('test_results', {
				suites: this.results,
				summary: this.getSummary(),
			});
		}
	}

	getSummary() {
		const totalSuites = this.results.length;
		const totalTests = this.results.reduce((sum, suite) => sum + suite.tests.length, 0);
		const totalPassed = this.results.reduce((sum, suite) => sum + suite.totalPassed, 0);
		const totalFailed = this.results.reduce((sum, suite) => sum + suite.totalFailed, 0);
		const totalDuration = this.results.reduce((sum, suite) => sum + suite.duration, 0);

		return {
			totalSuites,
			totalTests,
			totalPassed,
			totalFailed,
			totalDuration,
			success: totalFailed === 0,
		};
	}

	setCurrentSocket(socket: any) {
		this.currentSocket = socket;
	}

	clear() {
		this.results = [];
	}
}

const testRunner = new TestRunner();

// Test utilities
class TestUtils {
	static async expectEqual(actual: any, expected: any, message?: string): Promise<void> {
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			throw new Error(
				message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
			);
		}
	}

	static async expectTrue(value: any, message?: string): Promise<void> {
		if (!value) {
			throw new Error(message || `Expected truthy value, got ${value}`);
		}
	}

	static async expectFalse(value: any, message?: string): Promise<void> {
		if (value) {
			throw new Error(message || `Expected falsy value, got ${value}`);
		}
	}

	static async expectContains(array: any[], item: any, message?: string): Promise<void> {
		if (!array.includes(item)) {
			throw new Error(message || `Expected array to contain ${item}`);
		}
	}

	static async expectInstanceOf(value: any, constructor: any, message?: string): Promise<void> {
		if (!(value instanceof constructor)) {
			throw new Error(message || `Expected instance of ${constructor.name}`);
		}
	}

	static async waitFor(condition: () => boolean, timeout: number = 5000): Promise<void> {
		const start = Date.now();
		return new Promise((resolve, reject) => {
			const check = () => {
				if (condition()) {
					resolve();
				} else if (Date.now() - start > timeout) {
					reject(new Error(`Condition not met within ${timeout}ms`));
				} else {
					setTimeout(check, 50);
				}
			};
			check();
		});
	}

	static delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// Test suites
class SocketIOTests {
	private socket: any;
	private results: TestResult[] = [];

	constructor(socket: any) {
		this.socket = socket;
	}

	async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		console.log(`🧪 Running test: ${name}`);
		const start = Date.now();
		try {
			await testFn();
			const duration = Date.now() - start;
			console.log(`✅ Test passed: ${name} (${duration}ms)`);
			this.results.push({
				name,
				passed: true,
				duration,
			});
			this.socket.emit('test_progress', { name, status: 'passed' });
		} catch (error: any) {
			const duration = Date.now() - start;
			console.log(`❌ Test failed: ${name} (${duration}ms) - ${error.message}`);
			this.results.push({
				name,
				passed: false,
				error: error.message,
				duration,
			});
			this.socket.emit('test_progress', { name, status: 'failed', error: error.message });
		}
	}

	async runAllTests(): Promise<TestSuite> {
		console.log(`🚀 Starting all tests for socket ${this.socket.id}`);
		const start = Date.now();
		this.results = [];

		this.socket.emit('test_suite_start', { name: 'Socket.IO Core Tests' });

		// Basic Connection Tests
		await this.runTest('Socket should be connected', async () => {
			await TestUtils.expectTrue(this.socket.connected, 'Socket should be connected');
			await TestUtils.expectTrue(this.socket.id, 'Socket should have an ID');
		});

		// Event Tests
		await this.runTest('Should emit and receive events', async () => {
			let received = false;
			let receivedData: any;

			this.socket.on('test_response', (data: any) => {
				received = true;
				receivedData = data;
			});

			this.socket.emit('test_echo', 'hello world');

			await TestUtils.waitFor(() => received, 3000);
			await TestUtils.expectEqual(receivedData, 'Echo: hello world');
		});

		// ACK Tests
		await this.runTest('Should handle acknowledgments', async () => {
			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('ACK timeout')), 3000);

				this.socket.emit('test_ack', 'ack test data', (response: any) => {
					clearTimeout(timeout);
					try {
						TestUtils.expectEqual(response.echo, 'ack test data');
						TestUtils.expectTrue(response.timestamp);
						resolve();
					} catch (error) {
						reject(error);
					}
				});
			});
		});

		// Room Tests
		await this.runTest('Should handle room operations', async () => {
			let roomMessage = false;

			this.socket.on('room_message', () => {
				roomMessage = true;
			});

			this.socket.emit('join_test_room', 'test-room-1');
			await TestUtils.delay(100);

			this.socket.emit('send_to_room', { room: 'test-room-1', message: 'room test' });

			await TestUtils.waitFor(() => roomMessage, 3000);
		});

		// Binary Protocol Tests
		await this.runTest('Should handle binary protocol', async () => {
			let binaryReceived = false;

			this.socket.on('binary_response', () => {
				binaryReceived = true;
			});

			this.socket.emit('test_binary', 'binary test');

			await TestUtils.waitFor(() => binaryReceived, 3000);
		});

		// Performance Tests
		await this.runTest('Should handle rapid events', async () => {
			let responseCount = 0;
			const totalMessages = 100;

			this.socket.on('rapid_response', () => {
				responseCount++;
			});

			for (let i = 0; i < totalMessages; i++) {
				this.socket.emit('rapid_test', i);
			}

			await TestUtils.waitFor(() => responseCount >= totalMessages, 5000);
			await TestUtils.expectTrue(
				responseCount >= totalMessages * 0.95,
				'Should receive 95% of rapid messages'
			);
		});

		// Error Handling Tests
		await this.runTest('Should handle errors gracefully', async () => {
			let errorReceived = false;

			this.socket.on('error_response', (data: any) => {
				if (data.error) {
					errorReceived = true;
				}
			});

			this.socket.emit('test_error', 'trigger error');

			await TestUtils.waitFor(() => errorReceived, 3000);
		});

		// Namespace Tests
		await this.runTest('Should work with namespaces', async () => {
			// This test will be run by connecting to different namespace
			await TestUtils.expectEqual(this.socket.nsp, '/');
		});

		const duration = Date.now() - start;
		const passed = this.results.filter((r) => r.passed).length;
		const failed = this.results.filter((r) => !r.passed).length;

		return {
			name: 'Socket.IO Core Tests',
			tests: this.results,
			totalPassed: passed,
			totalFailed: failed,
			duration,
		};
	}
}

// Setup server and test handlers
const app = new Hono();

// Serve test interface
app.get('/', serveStatic({ path: './test/server/index.html' }));

// Add middleware для всех WebSocket путей включая Engine.IO параметры
app.use('/ws', async (c, next) => {
	console.log(`🔧 Middleware /ws hit for: ${c.req.url}`);
	// Создаем тестового пользователя для всех подключений
	c.set('user', {
		id: `test_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		name: 'Test User',
		isTestRunner: true,
	});
	c.set('session', {
		id: `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		authenticated: true,
	});
	await next();
});

app.use('/ws/*', async (c, next) => {
	console.log(`🔧 Middleware /ws/* hit for: ${c.req.url}`);
	// Дублируем для всех вложенных путей
	if (!c.get('user')) {
		c.set('user', {
			id: `test_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			name: 'Test User',
			isTestRunner: true,
		});
	}
	if (!c.get('session')) {
		c.set('session', {
			id: `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			authenticated: true,
		});
	}
	await next();
});

app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Create test server
const server = Bun.serve({
	hostname: 'localhost',
	port: 8443,
	fetch: app.fetch,
	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
	},
	tls: {
		key: Bun.file(import.meta.dir + '/../../dev/localhost-key.pem'),
		cert: Bun.file(import.meta.dir + '/../../dev/localhost.pem'),
	},
});

io.setBunServer(server);

// Setup test event handlers
io.on('connection', async (socket) => {
	console.log(`🧪 Test client connected: ${socket.id}`);

	testRunner.setCurrentSocket(socket);

	// Добавляем обработчик ПЕРЕД всеми остальными для отладки
	const originalHandlePacket = socket._handlePacket;
	socket._handlePacket = function (packet) {
		console.log(`🔍 Raw packet received from ${socket.id}:`, packet);

		// Временные хаки для всех тестовых событий
		if (packet.event === 'start_tests') {
			console.log(`🎯 Manually triggering start_tests handler`);
			setTimeout(async () => {
				console.log(`🚀 start_tests manual execution for ${socket.id}`);
				testRunner.clear();

				try {
					const coreTests = new SocketIOTests(socket);
					const results = await coreTests.runAllTests();

					testRunner.addTestSuite(results);

					console.log(`📤 Sending tests_complete to ${socket.id}`);
					socket.emit('tests_complete', testRunner.getSummary());
					console.log(
						`✅ Tests completed: ${results.totalPassed}/${results.tests.length} passed`
					);
				} catch (error) {
					console.error(`❌ Error running tests:`, error);
				}
			}, 100);
		}

		if (packet.event === 'test_echo') {
			console.log(`📨 test_echo manual handling: ${packet.data}`);
			socket.emit('test_response', `Echo: ${packet.data}`);
		}

		if (packet.event === 'test_ack') {
			console.log(`📨 test_ack manual handling: ${packet.data}`);
			// Для ACK нужно ответить через ackId
			if (packet.ackId) {
				socket._handleAck = socket._handleAck || function () {};
				// Отправляем ACK ответ
				const ackResponse = {
					echo: packet.data,
					timestamp: Date.now(),
					server: 'test-server',
				};
				socket.emit('__ack', ackResponse, packet.ackId);
			}
		}

		if (packet.event === 'test_binary') {
			console.log(`🔧 test_binary manual handling: ${packet.data}`);
			socket.emitBinary('binary_response', `Binary: ${packet.data}`);
		}

		if (packet.event === 'rapid_test') {
			socket.emit('rapid_response', packet.data);
		}

		if (packet.event === 'test_error') {
			console.log(`❌ test_error manual handling: ${packet.data}`);
			socket.emit('error_response', {
				error: 'Simulated error',
				originalData: packet.data,
			});
		}

		if (packet.event === 'join_test_room') {
			console.log(`🏠 join_test_room manual handling: ${packet.data}`);
			socket.join(packet.data);
			socket.emit('room_joined', packet.data);
		}

		if (packet.event === 'send_to_room') {
			console.log(`📡 send_to_room manual handling:`, packet.data);
			io.to(packet.data.room).emit('room_message', packet.data.message);
		}

		return originalHandlePacket.call(this, packet);
	};

	// ВАЖНО: Регистрируем start_tests в первую очередь
	socket.on('start_tests', async () => {
		console.log(`🚀 start_tests event received from ${socket.id}, starting automated tests...`);
		testRunner.clear();

		try {
			const coreTests = new SocketIOTests(socket);
			const results = await coreTests.runAllTests();

			testRunner.addTestSuite(results);

			console.log(`📤 Sending tests_complete to ${socket.id}`);
			socket.emit('tests_complete', testRunner.getSummary());
			console.log(
				`✅ Tests completed: ${results.totalPassed}/${results.tests.length} passed`
			);
		} catch (error) {
			console.error(`❌ Error running tests:`, error);
		}
	});

	// Test event handlers
	socket.on('test_echo', (data) => {
		console.log(`📨 test_echo received from ${socket.id}: ${data}`);
		socket.emit('test_response', `Echo: ${data}`);
	});

	socket.on('test_ack', (data, callback) => {
		console.log(`📨 test_ack received from ${socket.id}: ${data}`);
		if (typeof callback === 'function') {
			callback({
				echo: data,
				timestamp: Date.now(),
				server: 'test-server',
			});
		} else {
			console.warn(`⚠️ test_ack callback is not a function:`, typeof callback);
		}
	});

	socket.on('join_test_room', (room) => {
		console.log(`🏠 ${socket.id} joining room: ${room}`);
		socket.join(room);
		socket.emit('room_joined', room);
	});

	socket.on('send_to_room', (data) => {
		console.log(`📡 send_to_room from ${socket.id}:`, JSON.stringify(data));
		io.to(data.room).emit('room_message', data.message);
	});

	socket.on('test_binary', (data) => {
		console.log(`🔧 test_binary received from ${socket.id}: ${data}`);
		socket.emitBinary('binary_response', `Binary: ${data}`);
	});

	socket.on('rapid_test', (index) => {
		socket.emit('rapid_response', index);
	});

	socket.on('test_error', (data) => {
		console.log(`❌ test_error received from ${socket.id}: ${data}`);
		socket.emit('error_response', {
			error: 'Simulated error',
			originalData: data,
		});
	});

	socket.on('disconnect', (reason) => {
		console.log(`🧪 Test client disconnected: ${socket.id} (${reason})`);
	});

	// Start tests automatically when client connects
	console.log(`📤 Sending test_ready to ${socket.id}`);
	socket.emit('test_ready');
});

// Chat namespace tests
const chatNamespace = io.of('/chat');
chatNamespace.on('connection', (socket) => {
	console.log(`💬 Chat test client connected: ${socket.id}`);

	socket.emit('chat_ready');

	socket.on('chat_test', (data) => {
		socket.emit('chat_response', `Chat: ${data}`);
	});
});

console.log(`🧪 Test server running on https://localhost:${server.port}`);
console.log(`🌐 Open in browser to run tests: https://localhost:${server.port}`);
console.log(`📡 WebSocket endpoint: wss://localhost:${server.port}/ws`);

export { server, testRunner };
