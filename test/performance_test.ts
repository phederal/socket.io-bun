/**
 * Тесты производительности для Socket.IO-Bun
 * Обновлен под новый унифицированный Socket API
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

	setIOInstance(io: any): void {
		this.ioInstance = io;
	}

	private getSocket(socketId: string) {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		const namespace = this.ioInstance.of('/');
		let socket = namespace.sockets.get(socketId);

		if (socket && socket.connected && socket.ws.readyState === 1) {
			return socket;
		}

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

		console.error(`❌ No active sockets found. Available sockets: ${availableSockets.length}`);
		return null;
	}

	/**
	 * Тест производительности простых emit
	 */
	async testSimpleEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Simple Emit', count);
		}

		console.log(`🚀 Starting simple emit test: ${count} operations with socket ${socket.id}`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if (i % 1000 === 0 && (!socket.connected || socket.ws.readyState !== 1)) {
				console.warn(`⚠️ Socket disconnected during test at operation ${i}`);
				break;
			}

			if (socket.emit('test_result', `simple_${i}`)) {
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
	 * Тест производительности быстрого emit
	 */
	async testFastEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Fast Emit', count);
		}

		console.log(`⚡ Starting fast emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if (socket.emitFast('test_result', `fast_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Fast Emit',
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
			return this.createFailedResult('Binary Emit', count);
		}

		console.log(`🔥 Starting binary emit test: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if (socket.emitBinary('notification', `binary_${i}`)) {
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
	 * Тест производительности batch emit
	 */
	async testBatchEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Batch Emit', count);
		}

		console.log(`📦 Starting batch emit test: ${count} operations`);

		const startTime = Date.now();

		// Создаем batch события
		const events = [];
		for (let i = 0; i < count; i++) {
			events.push({
				event: 'test_result',
				data: `batch_${i}`,
				binary: i % 2 === 0, // Каждое второе бинарное
			});
		}

		const successful = socket.emitBatch(events);

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Batch Emit',
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
	 * Тест производительности ACK с разными приоритетами
	 */
	async testAckPerformance(
		socketId: string,
		count: number = 1000,
		priority: 'low' | 'normal' | 'high' = 'normal'
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult(`ACK ${priority}`, count);
		}

		console.log(`🔄 Starting ACK test: ${count} operations with priority ${priority}`);

		return new Promise((resolve) => {
			const startTime = Date.now();
			let successful = 0;
			let completed = 0;

			// ИСПРАВЛЕНИЕ: Используем событие которое ТОЧНО обрабатывается на клиенте
			for (let i = 0; i < count; i++) {
				// Вместо socket.emitWithAck отправляем обычное событие и ждем ответ
				socket.emit('performance_ack_request', {
					id: i,
					priority,
					timestamp: Date.now(),
				});

				// Устанавливаем listener для ответа
				const responseHandler = (response: any) => {
					if (response.id === i) {
						completed++;
						successful++;
						socket.off('performance_ack_response', responseHandler);

						if (completed === count) {
							const endTime = Date.now();
							const timeMs = endTime - startTime;
							const opsPerSecond = Math.round((count / timeMs) * 1000);

							const result: PerformanceTestResults = {
								testName: `ACK ${priority}`,
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
				};

				socket.on('performance_ack_response', responseHandler);

				// Timeout для отдельной операции
				setTimeout(
					() => {
						if (completed < count) {
							completed++;
							socket.off('performance_ack_response', responseHandler);

							if (completed === count) {
								const endTime = Date.now();
								const timeMs = endTime - startTime;
								const opsPerSecond = Math.round((count / timeMs) * 1000);

								const result: PerformanceTestResults = {
									testName: `ACK ${priority}`,
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
					},
					priority === 'high' ? 1000 : priority === 'normal' ? 5000 : 15000
				);
			}
		});
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

		const namespace = this.ioInstance.of('/');

		for (let i = 0; i < count; i++) {
			if (namespace.emitFast('test_result', `broadcast_${i}`)) {
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

		const namespace = this.ioInstance.of('/');

		for (let i = 0; i < count; i++) {
			if (namespace.binary.emitFast('notification', `binary_broadcast_${i}`)) {
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

				setTimeout(checkSockets, 100);
			};

			checkSockets();
		});
	}

	/**
	 * Быстрый тест производительности
	 */
	async runQuickTests(socketId?: string): Promise<PerformanceTestResults[]> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		const testSocketId = socketId || (await this.waitForSocket(10000));

		if (!testSocketId) {
			throw new Error('No sockets connected for testing');
		}

		console.log(`\n⚡ Running quick performance tests with socket: ${testSocketId}`);
		console.log('='.repeat(60));

		// Быстрые тесты
		await this.testSimpleEmit(testSocketId, 10000);
		await this.testFastEmit(testSocketId, 10000);
		await this.testBinaryEmit(testSocketId, 10000);
		await this.testBatchEmit(testSocketId, 10000);
		await this.testAckPerformance(testSocketId, 1000, 'high');
		await this.testBroadcastPerformance(5000);

		this.printSummary();
		return this.results;
	}

	/**
	 * Обновленный оптимизированный тест
	 */
	async runOptimizedQuickTests(socketId?: string): Promise<PerformanceTestResults[]> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}

		console.log(`\n🚀 Starting OPTIMIZED performance tests...`);

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

		// Оптимизированные тесты с новым API
		await this.testFastEmit(testSocketId, 15000);
		await this.testBinaryEmit(testSocketId, 15000);
		await this.testBatchEmit(testSocketId, 20000);
		await this.testAckPerformance(testSocketId, 1000, 'high');

		// Сравнительные тесты
		console.log('\n📊 Running comparison tests...');
		await this.testSimpleEmit(testSocketId, 10000);
		await this.testAckPerformance(testSocketId, 500, 'normal');

		this.printOptimizedComparison();
		return this.results;
	}

	private createFailedResult(testName: string, count: number): PerformanceTestResults {
		return {
			testName,
			totalOperations: count,
			timeMs: 0,
			operationsPerSecond: 0,
			successful: 0,
			failed: count,
		};
	}

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

		const bestResult = this.results.reduce((best, current) =>
			current.operationsPerSecond > best.operationsPerSecond ? current : best
		);

		console.log(
			`\n🥇 Best Performance: ${
				bestResult.testName
			} - ${bestResult.operationsPerSecond.toLocaleString()} ops/sec`
		);
	}

	private printOptimizedComparison(): void {
		console.log('\n🏆 OPTIMIZED vs STANDARD COMPARISON');
		console.log('='.repeat(80));

		const optimized = this.results.filter(
			(r) =>
				r.testName.includes('Fast') ||
				r.testName.includes('Binary') ||
				r.testName.includes('Batch') ||
				r.testName.includes('high')
		);

		const standard = this.results.filter(
			(r) => !optimized.some((opt) => opt.testName === r.testName)
		);

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

		// Сравнения
		const comparisons = [
			{ opt: 'Fast Emit', std: 'Simple Emit' },
			{ opt: 'Binary Emit', std: 'Simple Emit' },
			{ opt: 'Batch Emit', std: 'Simple Emit' },
			{ opt: 'ACK high', std: 'ACK normal' },
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
			console.log('⚠️  No direct comparisons available');
		}

		console.log('='.repeat(80));
	}

	getResults(): PerformanceTestResults[] {
		return [...this.results];
	}

	clearResults(): void {
		this.results = [];
	}

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
