/**
 * Тесты производительности для Socket.IO-Bun
 */

export interface PerformanceTestResults {
	testName: string;
	totalOperations: number;
	timeMs: number;
	operationsPerSecond: number;
	successful: number;
	failed: number;
}

const isProduction = process.env.NODE_ENV === 'production';

export class PerformanceTest {
	private results: PerformanceTestResults[] = [];
	private ioInstance: any = null;

	/**
	 * Установить instance io сервера
	 */
	setIOInstance(io: any): void {
		this.ioInstance = io;
	}

	/**
	 * Получить активный сокет по ID с fallback логикой
	 */
	private getSocket(socketId: string) {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		const namespace = this.ioInstance.of('/');

		// Сначала пытаемся найти точный сокет
		let socket = namespace.sockets.get(socketId);

		if (socket && socket.connected && socket.ws.readyState === 1) {
			return socket;
		}

		// Если целевой сокет не найден или отключен, ищем любой активный
		console.warn(`⚠️ Socket ${socketId} not available, searching for alternatives...`);

		const availableSockets = Array.from(namespace.sockets.entries());
		console.log(`📊 Total sockets in namespace: ${availableSockets.length}`);

		for (const [id, sock] of availableSockets) {
			console.log(
				`🔍 Checking socket ${id}: connected=${sock.connected}, readyState=${sock.ws?.readyState}`
			);

			if (sock.connected && sock.ws && sock.ws.readyState === 1) {
				console.log(`✅ Using fallback socket: ${id}`);
				return sock;
			}
		}

		// Если активных сокетов нет, возвращаем null
		console.error(`❌ No active sockets found. Available sockets: ${availableSockets.length}`);
		availableSockets.forEach(([id, sock]) => {
			console.log(
				`  - ${id}: connected=${sock.connected}, readyState=${sock.ws?.readyState}`
			);
		});

		return null;
	}

	/**
	 * Тест производительности простых emit
	 */
	async testSimpleEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			console.warn(`❌ No active socket available for Simple Emit test`);
			return {
				testName: 'Simple Emit',
				totalOperations: count,
				timeMs: 0,
				operationsPerSecond: 0,
				successful: 0,
				failed: count,
			};
		}

		console.log(`🚀 Starting simple emit test: ${count} operations with socket ${socket.id}`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			// Проверяем сокет каждые 1000 операций
			if (i % 1000 === 0 && (!socket.connected || socket.ws.readyState !== 1)) {
				console.warn(`⚠️ Socket disconnected during test at operation ${i}`);
				break;
			}

			if ((socket as any).emitFast && (socket as any).emitFast('test_event')) {
				successful++;
			} else if (socket.emit && socket.emit('test_event')) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = timeMs > 0 ? Math.round((successful / timeMs) * 1000) : 0;

		const result: PerformanceTestResults = {
			testName: 'Simple Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Ждем подключения хотя бы одного сокета
	 */
	private async waitForSocket(timeoutMs: number = 10000): Promise<string | null> {
		return new Promise((resolve) => {
			const startTime = Date.now();

			const checkSockets = () => {
				if (!this.ioInstance) {
					resolve(null);
					return;
				}

				const namespace = this.ioInstance.of('/');
				const activeSockets = Array.from(namespace.sockets.entries()).filter(
					([id, socket]) => socket.connected && socket.ws?.readyState === 1
				);

				if (activeSockets.length > 0) {
					const [socketId, socket] = activeSockets[0];
					console.log(`✅ Found active socket: ${socketId}`);
					resolve(socketId);
					return;
				}

				const elapsed = Date.now() - startTime;
				if (elapsed >= timeoutMs) {
					console.error(`❌ Timeout waiting for socket after ${timeoutMs}ms`);
					resolve(null);
					return;
				}

				// Повторная проверка через 100ms
				setTimeout(checkSockets, 100);
			};

			checkSockets();
		});
	}

	/**
	 * Тест мгновенного emit
	 */
	async testInstantEmit(
		socketId: string,
		count: number = 10000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`⚡ Starting instant emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((socket as any).emitInstant('ping')) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Instant Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности string emit
	 */
	async testStringEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🚀 Starting string emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((socket as any).emitString('test_string', `message_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'String Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности binary emit
	 */
	async testBinaryEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🔥 Starting binary emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((socket as any).emitBinary('test_binary', `binary_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Binary Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест оптимизированного binary emit
	 */
	async testOptimizedBinaryEmit(
		socketId: string,
		count: number = 10000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🔥 Starting optimized binary emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((socket as any).emitBinaryOptimized('message', `binary_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Optimized Binary Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности ultra fast emit
	 */
	async testUltraFastEmit(
		socketId: string,
		count: number = 10000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`⚡ Starting ultra fast emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((socket as any).emitUltraFast('test_ultra', `ultra_${i}`, true)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Ultra Fast Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест оптимизированного ultra fast emit
	 */
	async testUltraFastOptimized(
		socketId: string,
		count: number = 20000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`⚡ Starting ultra fast optimized test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			// Используем оптимизированный метод если доступен, иначе fallback на обычный
			const method = (socket as any).emitUltraFastOptimized || (socket as any).emitUltraFast;

			if (method.call(socket, 'notification', `ultra_${i % 20}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Ultra Fast Optimized',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности batch emit
	 */
	async testBatchEmit(
		socketId: string,
		batchSize: number = 1000,
		batches: number = 10
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		const totalOperations = batchSize * batches;
		console.log(
			`📦 Starting batch emit test: ${totalOperations} operations in ${batches} batches`
		);

		const startTime = Date.now();
		let successful = 0;

		for (let batch = 0; batch < batches; batch++) {
			const events = [];
			for (let i = 0; i < batchSize; i++) {
				events.push({
					event: 'batch_test',
					data: `batch_${batch}_item_${i}`,
				});
			}

			successful += (socket as any).emitBatch(events);
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((totalOperations / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Batch Emit',
			totalOperations,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: totalOperations - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест precompiled batch
	 */
	async testPrecompiledBatch(
		socketId: string,
		count: number = 10000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`📦 Starting precompiled batch test: ${count} operations`);

		const startTime = Date.now();

		// Предварительная компиляция пакетов
		const events = [];
		for (let i = 0; i < count; i++) {
			events.push({ event: 'test_result', data: `batch_${i}` });
		}

		const { SocketParser } = require('../socket/parser');
		const precompiledPackets = SocketParser.precompilePackets(events);

		// Отправка precompiled пакетов
		const successful = (socket as any).emitBatchPrecompiled(precompiledPackets);

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Precompiled Batch',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности broadcast
	 */
	async testBroadcastPerformance(count: number = 5000): Promise<PerformanceTestResults> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		console.log(`📡 Starting broadcast test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		// Используем emitFast для broadcast
		const namespace = this.ioInstance.of('/');

		for (let i = 0; i < count; i++) {
			if (namespace.emitFast('broadcast_test', `broadcast_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Broadcast Fast',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности binary broadcast
	 */
	async testBinaryBroadcastPerformance(count: number = 5000): Promise<PerformanceTestResults> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		console.log(`🔥 Starting binary broadcast test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		// Используем binary broadcast
		const namespace = this.ioInstance.of('/');

		for (let i = 0; i < count; i++) {
			if (namespace.binary.emitFast('broadcast_binary', `binary_broadcast_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Binary Broadcast',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности fast ACK
	 */
	async testFastAck(socketId: string, count: number = 1000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🔄 Starting fast ACK test: ${count} operations`);

		return new Promise((resolve) => {
			const startTime = Date.now();
			let successful = 0;
			let completed = 0;

			for (let i = 0; i < count; i++) {
				(socket as any).emitWithFastAck(
					'fast_ack_test',
					`data_${i}`,
					(err: any, response: any) => {
						completed++;
						if (!err) successful++;

						if (completed === count) {
							const endTime = Date.now();
							const timeMs = endTime - startTime;
							const opsPerSecond = Math.round((count / timeMs) * 1000);

							const result: PerformanceTestResults = {
								testName: 'Fast ACK',
								totalOperations: count,
								timeMs,
								operationsPerSecond: opsPerSecond,
								successful,
								failed: count - successful,
							};

							this.results.push(result);
							this.logResult(result);
							resolve(result);
						}
					}
				);
			}
		});
	}

	/**
	 * Тест супер-быстрого ACK
	 */
	async testSuperFastAck(
		socketId: string,
		count: number = 2000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		// Уменьшаем количество операций если метод недоступен
		if (!(socket as any).emitWithSuperFastAck) {
			console.warn(`⚠️ emitWithSuperFastAck method not available, skipping test`);
			return {
				testName: 'Super Fast ACK',
				totalOperations: count,
				timeMs: 0,
				operationsPerSecond: 0,
				successful: 0,
				failed: count,
			};
		}

		console.log(
			`🚀 Starting super fast ACK test: ${count} operations with socket ${socket.id}`
		);

		return new Promise((resolve) => {
			const startTime = Date.now();
			let successful = 0;
			let completed = 0;

			// Проверяем что сокет подключен
			if (!socket.connected || socket.ws.readyState !== 1) {
				console.warn(`⚠️ Socket ${socketId} is not properly connected`);
				resolve({
					testName: 'Super Fast ACK',
					totalOperations: count,
					timeMs: 0,
					operationsPerSecond: 0,
					successful: 0,
					failed: count,
				});
				return;
			}

			const batchSize = 25; // Уменьшаем размер батча для стабильности
			const batches = Math.ceil(count / batchSize);
			let batchesCompleted = 0;

			console.log(`📦 Sending ${count} operations in ${batches} batches of ${batchSize}`);

			for (let batch = 0; batch < batches; batch++) {
				setTimeout(() => {
					const batchStart = batch * batchSize;
					const batchEnd = Math.min(batchStart + batchSize, count);

					for (let i = batchStart; i < batchEnd; i++) {
						// Проверяем сокет перед каждой отправкой
						if (!socket.connected || socket.ws.readyState !== 1) {
							console.warn(
								`⚠️ Socket disconnected during Super Fast ACK at operation ${i}`
							);
							completed += batchEnd - i;
							checkCompletion();
							break;
						}

						try {
							(socket as any).emitWithSuperFastAck(
								'super_fast_ack_test',
								`super_fast_ack_${i}`,
								(err: any, response: any) => {
									completed++;
									if (!err && response) {
										successful++;
									} else if (err && !isProduction) {
										console.warn(`Super Fast ACK error for ${i}:`, err.message);
									}
									checkCompletion();
								}
							);
						} catch (error) {
							completed++;
							if (!isProduction) {
								console.warn(`Super Fast ACK send error for ${i}:`, error);
							}
							checkCompletion();
						}
					}

					batchesCompleted++;
					if (!isProduction && batchesCompleted % 10 === 0) {
						console.log(
							`📊 Super Fast ACK progress: ${batchesCompleted}/${batches} batches sent`
						);
					}
				}, batch * 5); // Минимальная задержка между батчами
			}

			function checkCompletion() {
				if (completed >= count) {
					const endTime = Date.now();
					const timeMs = endTime - startTime;
					const opsPerSecond = timeMs > 0 ? Math.round((count / timeMs) * 1000) : 0;

					const result: PerformanceTestResults = {
						testName: 'Super Fast ACK',
						totalOperations: count,
						timeMs,
						operationsPerSecond: opsPerSecond,
						successful,
						failed: count - successful,
					};

					console.log(
						`✅ Super Fast ACK completed: ${successful}/${count} successful in ${timeMs}ms`
					);
					resolve(result);
				}
			}

			// Защитный timeout - 20 секунд
			setTimeout(() => {
				if (completed < count) {
					console.warn(
						`⚠️ Super Fast ACK test timeout, completed: ${completed}/${count}`
					);
					checkCompletion();
				}
			}, 20000);
		});
	}

	/**
	 * Тест производительности bulk operations
	 */
	async testBulkOperations(count: number = 5000): Promise<PerformanceTestResults> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		console.log(`📦 Starting bulk operations test: ${count} operations`);

		const startTime = Date.now();

		// Подготавливаем bulk операции
		const operations = [];
		for (let i = 0; i < count; i++) {
			operations.push({
				event: 'bulk_test' as any,
				data: `bulk_${i}`,
				binary: i % 2 === 0, // Каждая вторая операция бинарная
			});
		}

		const namespace = this.ioInstance.of('/');
		const successful = namespace.emitBulk(operations);

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Bulk Operations',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Запуск всех тестов
	 */
	async runAllTests(socketId?: string): Promise<PerformanceTestResults[]> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		const namespace = this.ioInstance.of('/');
		const availableSockets = Array.from(namespace.sockets.keys());

		const testSocketId = socketId || availableSockets[0];

		if (!testSocketId) {
			throw new Error('No sockets connected for testing');
		}

		console.log(`\n🎯 Running performance tests with socket: ${testSocketId}`);
		console.log('='.repeat(60));

		// Socket-level тесты
		await this.testSimpleEmit(testSocketId, 50000);
		await this.testStringEmit(testSocketId, 50000);
		await this.testBinaryEmit(testSocketId, 50000);
		await this.testUltraFastEmit(testSocketId, 50000);
		await this.testBatchEmit(testSocketId, 1000, 50);

		// Broadcast тесты
		await this.testBroadcastPerformance(10000);
		await this.testBinaryBroadcastPerformance(10000);
		await this.testBulkOperations(10000);

		// ACK тест последним, так как он асинхронный
		await this.testFastAck(testSocketId, 5000);

		this.printSummary();
		return this.results;
	}

	/**
	 * Быстрый тест производительности
	 */
	async runQuickTests(socketId?: string): Promise<PerformanceTestResults[]> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		const namespace = this.ioInstance.of('/');
		const availableSockets = Array.from(namespace.sockets.keys());

		const testSocketId = socketId || availableSockets[0];

		if (!testSocketId) {
			throw new Error('No sockets connected for testing');
		}

		console.log(`\n⚡ Running quick performance tests with socket: ${testSocketId}`);
		console.log('='.repeat(60));

		// Быстрые тесты с меньшим количеством операций
		await this.testSimpleEmit(testSocketId, 10000);
		await this.testBinaryEmit(testSocketId, 10000);
		await this.testUltraFastEmit(testSocketId, 10000);
		await this.testBroadcastPerformance(5000);
		await this.testFastAck(testSocketId, 1000);

		this.printSummary();
		return this.results;
	}

	/**
	 * Обновленный быстрый тест с новыми методами
	 */
	async runOptimizedQuickTests(socketId?: string): Promise<PerformanceTestResults[]> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		console.log(`\n🚀 Starting OPTIMIZED performance tests...`);

		// Ждем активный сокет если нужно
		let testSocketId = socketId;

		if (!testSocketId || !this.getSocket(testSocketId)) {
			console.log(`🔍 Waiting for active socket...`);
			testSocketId = await this.waitForSocket(10000);

			if (!testSocketId) {
				throw new Error('No active sockets available for testing after 10 second timeout');
			}
		}

		console.log(`🎯 Using socket: ${testSocketId}`);
		console.log('='.repeat(70));

		this.clearResults();

		// Определяем план тестов
		const testPlan = [
			{
				name: 'Instant Emit',
				method: 'testInstantEmit',
				params: [15000],
				checkMethod: 'emitInstant',
			},
			{
				name: 'Optimized Binary Emit',
				method: 'testOptimizedBinaryEmit',
				params: [15000],
				checkMethod: 'emitBinaryOptimized',
			},
			{
				name: 'Ultra Fast Optimized',
				method: 'testUltraFastOptimized',
				params: [20000],
				checkMethod: 'emitUltraFastOptimized',
			},
			{
				name: 'Precompiled Batch',
				method: 'testPrecompiledBatch',
				params: [20000],
				checkMethod: 'emitBatchPrecompiled',
			},
			{
				name: 'Super Fast ACK',
				method: 'testSuperFastAck',
				params: [2000],
				checkMethod: 'emitWithSuperFastAck',
			},
		];

		const comparisonPlan = [
			{
				name: 'Simple Emit',
				method: 'testSimpleEmit',
				params: [10000],
			},
			{
				name: 'Binary Emit',
				method: 'testBinaryEmit',
				params: [10000],
			},
			{
				name: 'Ultra Fast Emit',
				method: 'testUltraFastEmit',
				params: [10000],
			},
			{
				name: 'Fast ACK',
				method: 'testFastAck',
				params: [1000],
			},
		];

		// Выполняем оптимизированные тесты
		console.log(`📊 Running optimized tests...`);
		await this.executeTestPlan(testPlan, testSocketId, 'optimized');

		// Выполняем сравнительные тесты
		console.log('\n📊 Running comparison tests...');
		await this.executeTestPlan(comparisonPlan, testSocketId, 'comparison');

		this.printOptimizedComparison();
		return this.results;
	}

	/**
	 * Выполнение плана тестов с retry логикой
	 */
	private async executeTestPlan(
		testPlan: Array<{
			name: string;
			method: string;
			params: any[];
			checkMethod?: string;
		}>,
		initialSocketId: string,
		phase: string
	): Promise<void> {
		for (const test of testPlan) {
			let currentSocketId = initialSocketId;
			let attempts = 0;
			const maxAttempts = 3;
			let testCompleted = false;

			while (attempts < maxAttempts && !testCompleted) {
				try {
					// Получаем активный сокет
					const socket = this.getSocket(currentSocketId);
					if (!socket) {
						throw new Error(`No active socket available`);
					}

					// Проверяем доступность метода если указан
					if (test.checkMethod && !(socket as any)[test.checkMethod]) {
						console.log(
							`⚠️ ${test.checkMethod} method not available on socket ${socket.id}, skipping ${test.name}`
						);
						testCompleted = true;
						break;
					}

					console.log(
						`🧪 Running ${test.name} with socket ${socket.id} (attempt ${
							attempts + 1
						})...`
					);

					// Выполняем тест
					const testMethod = (this as any)[test.method];
					if (!testMethod) {
						throw new Error(`Test method ${test.method} not found`);
					}

					await testMethod.call(this, socket.id, ...test.params);
					testCompleted = true;
				} catch (error) {
					attempts++;
					console.error(`❌ ${test.name} attempt ${attempts} failed:`, error);

					if (attempts < maxAttempts) {
						console.log(
							`🔄 Retrying ${test.name} in 1 second... (attempt ${
								attempts + 1
							}/${maxAttempts})`
						);
						await new Promise((resolve) => setTimeout(resolve, 1000));

						// Ищем новый активный сокет
						const newSocketId = await this.waitForSocket(5000);
						if (newSocketId) {
							currentSocketId = newSocketId;
							console.log(`🔄 Retry ${test.name} with socket: ${currentSocketId}`);
						} else {
							console.error(`❌ No active sockets for retry of ${test.name}`);
							break;
						}
					} else {
						console.error(
							`❌ ${test.name} failed after ${maxAttempts} attempts, adding empty result`
						);

						// Добавляем пустой результат чтобы тест был учтен
						this.results.push({
							testName: test.name,
							totalOperations: test.params[0] || 0,
							timeMs: 0,
							operationsPerSecond: 0,
							successful: 0,
							failed: test.params[0] || 0,
						});
					}
				}
			}
		}
	}

	/**
	 * Вывод результата одного теста
	 */
	private logResult(result: PerformanceTestResults): void {
		console.log(`✅ ${result.testName}:`);
		console.log(`   📊 ${result.operationsPerSecond.toLocaleString()} ops/sec`);
		console.log(`   ⏱️  ${result.timeMs}ms total`);
		console.log(`   ✅ ${result.successful}/${result.totalOperations} successful`);
		if (result.failed > 0) {
			console.log(`   ❌ ${result.failed} failed`);
		}
		console.log('');
	}

	/**
	 * Вывод общей сводки
	 */
	private printSummary(): void {
		console.log('\n🏆 PERFORMANCE SUMMARY');
		console.log('='.repeat(70));

		this.results.forEach((result) => {
			const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
			const opsPerSecFormatted = result.operationsPerSecond.toLocaleString().padStart(10);
			console.log(
				`${result.testName.padEnd(
					18
				)} | ${opsPerSecFormatted} ops/sec | ${successRate.padStart(5)}% success`
			);
		});

		const totalOps = this.results.reduce((sum, r) => sum + r.totalOperations, 0);
		const totalTime = this.results.reduce((sum, r) => sum + r.timeMs, 0);
		const avgOpsPerSec = Math.round((totalOps / totalTime) * 1000);

		console.log('-'.repeat(70));
		console.log(
			`${'AVERAGE'.padEnd(18)} | ${avgOpsPerSec
				.toLocaleString()
				.padStart(10)} ops/sec | ${totalOps.toLocaleString()} total ops`
		);
		console.log('='.repeat(70));

		// Дополнительная статистика
		const bestResult = this.results.reduce((best, current) =>
			current.operationsPerSecond > best.operationsPerSecond ? current : best
		);

		console.log(
			`\n🥇 Best Performance: ${
				bestResult.testName
			} - ${bestResult.operationsPerSecond.toLocaleString()} ops/sec`
		);
	}

	/**
	 * Печать оптимизированной сводки
	 */
	private printOptimizedSummary(): void {
		console.log('\n🏆 OPTIMIZED PERFORMANCE SUMMARY');
		console.log('='.repeat(70));

		// Группируем результаты по категориям
		const optimized = this.results.filter(
			(r) =>
				r.testName.includes('Instant') ||
				r.testName.includes('Optimized') ||
				r.testName.includes('Super') ||
				r.testName.includes('Precompiled')
		);

		const standard = this.results.filter(
			(r) =>
				!r.testName.includes('Instant') &&
				!r.testName.includes('Optimized') &&
				!r.testName.includes('Super') &&
				!r.testName.includes('Precompiled')
		);

		console.log('🚀 OPTIMIZED METHODS:');
		optimized.forEach((result) => {
			const opsFormatted = result.operationsPerSecond.toLocaleString().padStart(10);
			const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
			console.log(
				`${result.testName.padEnd(20)} | ${opsFormatted} ops/sec | ${successRate.padStart(
					5
				)}% success`
			);
		});

		console.log('\n📊 STANDARD METHODS:');
		standard.forEach((result) => {
			const opsFormatted = result.operationsPerSecond.toLocaleString().padStart(10);
			const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
			console.log(
				`${result.testName.padEnd(20)} | ${opsFormatted} ops/sec | ${successRate.padStart(
					5
				)}% success`
			);
		});

		// Сравнение производительности
		const instantEmit = optimized.find((r) => r.testName === 'Instant Emit');
		const simpleEmit = standard.find((r) => r.testName === 'Simple Emit');

		if (instantEmit && simpleEmit) {
			const improvement = (
				(instantEmit.operationsPerSecond / simpleEmit.operationsPerSecond - 1) *
				100
			).toFixed(1);
			console.log(
				`\n📈 IMPROVEMENT: Instant Emit is ${improvement}% faster than Simple Emit`
			);
		}
	}

	/**
	 * Печать сравнения оптимизированных методов
	 */
	private printOptimizedComparison(): void {
		console.log('\n🏆 OPTIMIZED vs STANDARD COMPARISON');
		console.log('='.repeat(80));

		// Разделяем результаты на оптимизированные и стандартные
		const optimized = this.results.filter(
			(r) =>
				r.testName.includes('Instant') ||
				r.testName.includes('Optimized') ||
				r.testName.includes('Super') ||
				r.testName.includes('Precompiled')
		);

		const standard = this.results.filter(
			(r) => !optimized.some((opt) => opt.testName === r.testName)
		);

		// Выводим оптимизированные методы
		if (optimized.length > 0) {
			console.log('🚀 OPTIMIZED METHODS:');
			optimized.forEach((result) => {
				const opsFormatted = result.operationsPerSecond.toLocaleString().padStart(12);
				const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
				console.log(
					`${result.testName.padEnd(
						22
					)} | ${opsFormatted} ops/sec | ${successRate.padStart(5)}% success`
				);
			});
		}

		// Выводим стандартные методы
		if (standard.length > 0) {
			console.log('\n📊 STANDARD METHODS:');
			standard.forEach((result) => {
				const opsFormatted = result.operationsPerSecond.toLocaleString().padStart(12);
				const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
				console.log(
					`${result.testName.padEnd(
						22
					)} | ${opsFormatted} ops/sec | ${successRate.padStart(5)}% success`
				);
			});
		}

		// Сравнение производительности
		const comparisons = [
			{ opt: 'Instant Emit', std: 'Simple Emit' },
			{ opt: 'Optimized Binary Emit', std: 'Binary Emit' },
			{ opt: 'Ultra Fast Optimized', std: 'Ultra Fast Emit' },
			{ opt: 'Super Fast ACK', std: 'Fast ACK' },
		];

		console.log('\n📈 PERFORMANCE IMPROVEMENTS:');
		let hasComparisons = false;

		comparisons.forEach(({ opt, std }) => {
			const optResult = optimized.find((r) => r.testName === opt);
			const stdResult = standard.find((r) => r.testName === std);

			if (optResult && stdResult) {
				const improvement = (
					(optResult.operationsPerSecond / stdResult.operationsPerSecond - 1) *
					100
				).toFixed(1);
				const improvementColor = parseFloat(improvement) > 0 ? '📈' : '📉';
				console.log(
					`${opt.padEnd(25)} vs ${std.padEnd(
						20
					)}: ${improvementColor} ${improvement}% improvement`
				);
				hasComparisons = true;
			}
		});

		if (!hasComparisons) {
			console.log(
				'⚠️  No direct comparisons available (missing optimized or standard methods)'
			);
		}

		// Общая статистика
		console.log('\n📊 OVERALL STATISTICS:');
		console.log(`Total tests run: ${this.results.length}`);
		console.log(`Optimized methods: ${optimized.length}`);
		console.log(`Standard methods: ${standard.length}`);

		// Найти лучший результат
		if (this.results.length > 0) {
			const bestResult = this.results.reduce((best, current) =>
				current.operationsPerSecond > best.operationsPerSecond ? current : best
			);

			const worstResult = this.results.reduce((worst, current) =>
				current.operationsPerSecond < worst.operationsPerSecond ? current : worst
			);

			console.log(
				`\n🥇 BEST PERFORMANCE: ${
					bestResult.testName
				} - ${bestResult.operationsPerSecond.toLocaleString()} ops/sec`
			);

			console.log(
				`🥉 LOWEST PERFORMANCE: ${
					worstResult.testName
				} - ${worstResult.operationsPerSecond.toLocaleString()} ops/sec`
			);

			// Средняя производительность
			const avgPerformance = Math.round(
				this.results.reduce((sum, r) => sum + r.operationsPerSecond, 0) /
					this.results.length
			);
			console.log(`📊 AVERAGE PERFORMANCE: ${avgPerformance.toLocaleString()} ops/sec`);
		}

		console.log('='.repeat(80));
	}

	/**
	 * Получить результаты
	 */
	getResults(): PerformanceTestResults[] {
		return [...this.results];
	}

	/**
	 * Очистить результаты
	 */
	clearResults(): void {
		this.results = [];
	}

	/**
	 * Экспорт результатов в JSON
	 */
	exportResults(): string {
		return JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				results: this.results,
				summary: {
					totalTests: this.results.length,
					totalOperations: this.results.reduce((sum, r) => sum + r.totalOperations, 0),
					totalTime: this.results.reduce((sum, r) => sum + r.timeMs, 0),
					averageOpsPerSec: Math.round(
						(this.results.reduce((sum, r) => sum + r.totalOperations, 0) /
							this.results.reduce((sum, r) => sum + r.timeMs, 0)) *
							1000
					),
				},
			},
			null,
			2
		);
	}
}

// Экспорт для использования
export const performanceTest = new PerformanceTest();

// Функция для быстрого запуска тестов
export async function runQuickPerformanceTest(io: any, socketId?: string): Promise<void> {
	try {
		performanceTest.setIOInstance(io);
		await performanceTest.runQuickTests(socketId);
	} catch (error) {
		console.error('❌ Performance test failed:', error);
	}
}

export async function runOptimizedPerformanceTest(io: any, socketId?: string): Promise<void> {
	try {
		performanceTest.setIOInstance(io);
		await performanceTest.runOptimizedQuickTests(socketId);
	} catch (error) {
		console.error('❌ Optimized performance test failed:', error);
	}
}

// Функция для полного набора тестов
export async function runFullPerformanceTest(io: any, socketId?: string): Promise<void> {
	try {
		performanceTest.setIOInstance(io);
		await performanceTest.runAllTests(socketId);
	} catch (error) {
		console.error('❌ Performance test failed:', error);
	}
}

// Утилиты для получения информации о сокетах
export function getConnectedSocketIds(io: any): string[] {
	const namespace = io.of('/');
	return Array.from(namespace.sockets.keys());
}

export function getConnectedSocketsCount(io: any): number {
	const namespace = io.of('/');
	return namespace.sockets.size;
}

export function printConnectedSockets(io: any): void {
	const sockets = getConnectedSocketIds(io);
	console.log(`📊 Connected sockets (${sockets.length}):`);
	sockets.forEach((id, index) => {
		console.log(`  ${index + 1}. ${id}`);
	});
}

// Экспорт результатов в файл
export function saveResultsToFile(filename?: string): void {
	const fs = require('fs');
	const results = performanceTest.exportResults();
	const fname = filename || `performance-results-${Date.now()}.json`;

	try {
		fs.writeFileSync(fname, results);
		console.log(`📁 Results saved to ${fname}`);
	} catch (error) {
		console.error('❌ Failed to save results:', error);
	}
}
