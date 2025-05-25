/**
 * Server & WebSocket
 * Main file of backend with full TypeScript support
 */

import { Hono } from 'hono';
import { websocket, wsUpgrade, io } from './ws';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from './shared/types/socket.types';
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
	// In production, this would come from your authentication middleware
	c.set('user', { id: `user_${Date.now()}` });
	c.set('session', { id: `session_${Date.now()}` });

	await next();
});

app.get('/', serveStatic({ path: 'test/test-client.html' }));
app.get('/ws', wsUpgrade);
app.get('/ws/*', wsUpgrade);

// Create server first
export const server = Bun.serve({
	hostname: 'localhost', // isProduction ? '0.0.0.0' : 'localhost',
	port: 8443, // isProduction ? Number(process.env.APP_PORT) || 3000 : 8443,
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
	},

	tls: {
		key: Bun.file(import.meta.dir + '/dev/localhost-key.pem'),
		cert: Bun.file(import.meta.dir + '/dev/localhost.pem'),
	},
});

// Set Bun server instance for Socket.IO publishing BEFORE setting up events
io.setBunServer(server);

// ИСПРАВЛЕНИЕ: Включаем тестовый сервер обратно
import './test/test-server';
import { warmupPerformanceOptimizations } from './socket/socket';
warmupPerformanceOptimizations();

/**
 * Perfomance test
 */
// В index.ts добавьте:
import { runQuickPerformanceTest, saveResultsToFile } from './test/performance_test';
io.on('connection', (socket) => {
	console.log(`🎉 Socket ${socket.id} connected`);
	// Запускаем тест и сохраняем результаты
	setTimeout(async () => {
		try {
			await runQuickPerformanceTest(io, socket.id);
			// Сохраняем результаты в JSON файл
			saveResultsToFile(`performance-${socket.id}-${Date.now()}.json`);
		} catch (error) {
			console.error('❌ Performance test failed:', error);
		}
	}, 3000);
});

// /**
//  * Perfomance test 2
//  */
// import { performanceTest, saveResultsToFile } from './test/performance_test';

// io.on('connection', (socket) => {
//     console.log(`🎉 Socket ${socket.id} connected`);

//     setTimeout(async () => {
//         try {
//             // Настраиваем тест без вывода
//             performanceTest.setIOInstance(io);

//             // Запускаем только нужные тесты
//             await performanceTest.testSimpleEmit(socket.id, 10000);
//             await performanceTest.testBinaryEmit(socket.id, 10000);
//             await performanceTest.testUltraFastEmit(socket.id, 10000);

//             // Сохраняем результаты
//             const filename = `benchmark-${socket.id.slice(-8)}-${Date.now()}.json`;
//             saveResultsToFile(filename);

//             console.log(`📊 Performance test completed, results saved to ${filename}`);

//         } catch (error) {
//             console.error('❌ Performance test failed:', error);
//         }
//     }, 3000);
// });

// ИСПРАВЛЕНИЕ: Регистрируем обработчики событий с лучшей отладкой
// if (!isProduction) {
// 	console.log('[INDEX] Registering connection handler...');
// }
// io.on('connection', (socket) => {
// 	if (!isProduction) {
// 		console.log(`🎉 [INDEX] Socket ${socket.id} connected successfully!`);
// 		console.log(`📊 [INDEX] Total sockets: ${io.socketsCount}`);
// 	}

// 	// ✅ Базовые обработчики событий
// 	socket.on('ping', () => {
// 		if (!isProduction) {
// 			console.log(`📡 [INDEX] PING received from ${socket.id}`);
// 		}
// 		socket.emit('pong');
// 		if (!isProduction) {
// 			console.log(`📡 [INDEX] PONG sent to ${socket.id}`);
// 		}
// 	});

// 	socket.on('message', (data) => {
// 		if (!isProduction) {
// 			console.log(`📨 [INDEX] MESSAGE received from ${socket.id}:`, data);
// 		}
// 		// НЕ отправляем ACK для обычных событий
// 		socket.emit('message', `Echo: ${data}`);
// 		socket.broadcast.emit('message', `${socket.id} says: ${data}`);
// 	});

// 	socket.on('disconnect', (reason) => {
// 		if (!isProduction) {
// 			console.log(`❌ [INDEX] Socket ${socket.id} disconnected: ${reason}`);
// 			console.log(`📊 [INDEX] Remaining sockets: ${io.socketsCount}`);
// 		}
// 	});

// 	// ✅ Отправляем приветственное сообщение через несколько секунд
// 	setTimeout(() => {
// 		if (!isProduction) {
// 			console.log(`💬 [INDEX] Sending welcome message to ${socket.id}`);
// 		}
// 		try {
// 			const success = socket.emit('message', `Welcome ${socket.id}! Server is ready.`);
// 			if (!isProduction) {
// 				console.log(`💬 [INDEX] Welcome message sent: ${success}`);
// 			}
// 		} catch (error) {
// 			if (!isProduction) {
// 				console.error(`💬 [INDEX] Error sending welcome message:`, error);
// 			}
// 		}
// 	}, 2000);

// 	// ✅ Тестируем broadcast
// 	setTimeout(() => {
// 		if (!isProduction) {
// 			console.log(`📢 [INDEX] Broadcasting notification...`);
// 		}
// 		try {
// 			io.emit('message', `New user ${socket.id} joined! Total: ${io.socketsCount}`);
// 		} catch (error) {
// 			if (!isProduction) {
// 				console.error(`📢 [INDEX] Error broadcasting:`, error);
// 			}
// 		}
// 	}, 3000);
// });

// Дополнительная отладка
io.on('connect', (socket) => {
	if (!isProduction) {
		console.log(`🔗 [INDEX] Connect event received for ${socket.id}`);
	}
});

if (!isProduction) {
	console.log('[INDEX] Event handlers registered');
}

if (!isProduction) {
	console.log(`🚀 Server listening on https://${server.hostname}:${server.port}`);
	console.log(`📡 WebSocket endpoint: wss://${server.hostname}:${server.port}/ws`);
	console.log(`💬 Chat namespace: wss://${server.hostname}:${server.port}/ws/chat`);
	console.log();
}

// ✅ Export typed instances
export type App = typeof app;
export { io };
export type TypedSocket = Parameters<Parameters<typeof io.on>[1]>[0];
