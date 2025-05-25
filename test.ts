/**
 * Простой тестовый файл с новыми performance тестами
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from './ws';
import { serveStatic } from 'hono/bun';

const isProduction = process.env.NODE_ENV === 'production';

// App
const app = new Hono<{
	Variables: {
		user: unknown;
		session: unknown;
	};
}>();

// Add middleware to set mock user and session for testing
app.use('/ws/*', async (c, next) => {
	c.set('user', { id: `user_${Date.now()}` });
	c.set('session', { id: `session_${Date.now()}` });
	await next();
});

app.get('/', serveStatic({ path: './test/test-client.html' }));
app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Create server first
export const server = Bun.serve({
	hostname: 'localhost',
	port: 8443,
	fetch: app.fetch,
	development: !isProduction,
	maxRequestBodySize: 128 * 1024 * 1024,
	idleTimeout: 120,

	websocket: {
		open: websocket.open,
		message: websocket.message,
		close: websocket.close,
		idleTimeout: 120,
		maxPayloadLength: 16 * 1024 * 1024,
		publishToSelf: false,
		backpressureLimit: 64 * 1024,
	},

	tls: {
		key: Bun.file(import.meta.dir + '/dev/localhost-key.pem'),
		cert: Bun.file(import.meta.dir + '/dev/localhost.pem'),
	},
});

// Set Bun server instance for Socket.IO publishing
io.setBunServer(server);

// Import test server
import './test/test-server';
import { warmupPerformanceOptimizations } from './socket/socket';
warmupPerformanceOptimizations();

// Import new performance tests
import { runSimplePerformanceTest, saveResultsToFile } from './test/performance_test';

/**
 * Простая система тестов
 */
let testState = {
	completed: false,
	running: false,
	targetSocket: null as string | null,
};

io.on('connection', (socket) => {
	console.log(`🎉 Socket ${socket.id} connected`);

	// Если тест уже завершен, не запускаем повторно
	if (testState.completed) {
		console.log('📊 Tests already completed');
		return;
	}

	// Если тест уже запущен, ждем
	if (testState.running) {
		console.log(`⏳ Test is running with socket: ${testState.targetSocket}`);
		return;
	}

	// Запускаем простые тесты
	startSimpleTest(socket.id);
});

async function startSimpleTest(socketId: string) {
	testState.running = true;
	testState.targetSocket = socketId;

	// Даем время сокету полностью подключиться
	setTimeout(async () => {
		try {
			console.log(`\n🚀 Starting SIMPLE performance test with socket: ${socketId}...`);

			// Проверяем что сокет активен
			const namespace = io.of('/');
			const testSocket = namespace.sockets.get(socketId);

			if (!testSocket || !testSocket.connected) {
				console.warn(`⚠️ Target socket ${socketId} not available`);
				resetTestState();
				return;
			}

			// Запускаем простые тесты
			await runSimplePerformanceTest(io, socketId);

			// Сохраняем результаты
			const filename = `simple-performance-${socketId.slice(-8)}-${Date.now()}.json`;
			saveResultsToFile(filename);
			console.log(`\n✅ Performance test completed! Results saved to ${filename}`);

			testState.completed = true;
			console.log('📊 No more tests will run for new connections.');
		} catch (error) {
			console.error('❌ Performance test error:', error);
		} finally {
			resetTestState();
		}
	}, 2000); // 2 секунды задержка
}

function resetTestState() {
	testState.running = false;
	testState.targetSocket = null;
}

// Handle disconnections
io.on('disconnect', (socket, reason) => {
	console.log(`❌ Socket ${socket.id} disconnected: ${reason}`);

	if (testState.targetSocket === socket.id && testState.running) {
		console.warn(`⚠️ Performance test socket disconnected during test`);
	}
});

// Debug info
if (!isProduction) {
	io.on('connect', (socket) => {
		console.log(`🔗 Connect event for ${socket.id}`);
	});
	console.log(`🚀 Server listening on https://${server.hostname}:${server.port}`);
	console.log(`📡 WebSocket endpoint: wss://${server.hostname}:${server.port}/ws`);
	console.log(`🧪 Test client: https://${server.hostname}:${server.port}`);
	console.log();
}

// Export
export type App = typeof app;
export { io };
export type TypedSocket = Parameters<Parameters<typeof io.on>[1]>[0];
