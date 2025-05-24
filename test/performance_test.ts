/**
 * Тесты производительности для Socket.IO-Bun
 */

import { io } from './socket/server';

export interface PerformanceTestResults {
	testName: string;
	totalOperations: number;
	timeMs: number;
	operationsPerSecond: number;
	successful: number;
	failed: number;
}

export class PerformanceTest {
	private results: PerformanceTestResults[] = [];

	/**
	 * Тест производительности простых emit
	 */
	async testSimpleEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = io.sockets.sockets.get(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🚀 Starting simple emit test: ${count} operations`);
		
		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((socket as any).emitFast('test_event')) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Simple Emit',
			totalOperations: count,
			timeMs,
			operationsPerSecond: opsPerSecond,
			successful,
			failed: count - successful
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности string emit
	 */
	async testStringEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = io.sockets.sockets.get(socketId);
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
			failed: count - successful
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности batch emit
	 */
	async testBatchEmit(socketId: string, batchSize: number = 1000, batches: number = 10): Promise<PerformanceTestResults> {
		const socket = io.sockets.sockets.get(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		const totalOperations = batchSize * batches;
		console.log(`🚀 Starting batch emit test: ${totalOperations} operations in ${batches} batches`);
		
		const startTime = Date.now();
		let successful = 0;

		for (let batch = 0; batch < batches; batch++) {
			const events = [];
			for (let i = 0; i < batchSize; i++) {
				events.push({
					event: 'batch_test',
					data: `batch_${batch}_item_${i}`
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
			failed: totalOperations - successful
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Тест производительности fast ACK
	 */
	async testFastAck(socketId: string, count: number = 1000): Promise<PerformanceTestResults> {
		const socket = io.sockets.sockets.get(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🚀 Starting fast ACK test: ${count} operations`);
		
		return new Promise((resolve) => {
			const startTime = Date.now();
			let successful = 0;
			let completed = 0;

			for (let i = 0; i < count; i++) {
				(socket as any).emitWithFastAck('fast_ack_test', `data_${i}`, (err: any, response: any) => {
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
							failed: count - successful
						};

						this.results.push(result);
						this.logResult(result);
						resolve(result);
					}
				});
			}
		});
	}

	/**
	 * Тест производительности broadcast
	 */
	async testBroadcastPerformance(count: number = 5000): Promise<PerformanceTestResults> {
		console.log(`🚀 Starting broadcast test: ${count} operations`);
		
		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if ((io.sockets as any).emitFast('broadcast_test', `broadcast_${i}`)) {
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
			failed: count - successful
		};

		this.results.push(result);
		this.logResult(result);
		return result;
	}

	/**
	 * Запуск всех тестов
	 */
	async runAllTests(socketId?: string): Promise<PerformanceTestResults[]> {
		const testSocketId = socketId || Array.from(io.sockets.sockets.keys())[0];
		
		if (!testSocketId) {
			throw new Error('No sockets connected for testing');
		}

		console.log(`\n🎯 Running performance tests with socket: ${testSocketId}`);
		console.log('='.repeat(60));

		await this.testSimpleEmit(testSocketId, 50000);
		await this.testStringEmit(testSocketId, 50000);
		await this.testBatchEmit(testSocketId, 1000, 50);
		await this.testBroadcastPerformance(10000);
		
		// ACK тест последним, так как он асинхронный
		await this.testFastAck(testSocketId, 5000);

		this.printSummary();
		return this.results;
	}

	/**
	 * Вывод результата одного теста
	 */
	private logResult(result: PerformanceTestResults): void {
		console.log(`✅ ${result.testName}:`);
		console.log(`   📊 ${result.operationsPerSecond.toLocaleString()} ops/sec`);
		console.log(`   ⏱️  ${result.timeMs}ms total`);
		console.log(`   ✅ ${result.successful}/${result.totalOperations} successful`);
		console.log('');
	}

	/**
	 * Вывод общей сводки
	 */
	private printSummary(): void {
		console.log('\n🏆 PERFORMANCE SUMMARY');
		console.log('='.repeat(60));
		
		this.results.forEach(result => {
			const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
			console.log(`${result.testName.padEnd(15)} | ${result.operationsPerSecond.toLocaleString().padStart(8)} ops/sec | ${successRate}% success`);
		});

		const totalOps = this.results.reduce((sum, r) => sum + r.totalOperations, 0);
		const totalTime = this.results.reduce((sum, r) => sum + r.timeMs, 0);
		const avgOpsPerSec = Math.round((totalOps / totalTime) * 1000);

		console.log('-'.repeat(60));
		console.log(`${'AVERAGE'.padEnd(15)} | ${avgOpsPerSec.toLocaleString().padStart(8)} ops/sec | ${totalOps.toLocaleString()} total ops`);
		console.log('='.repeat(60));
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
}

// Экспорт для использования
export const performanceTest = new PerformanceTest();

// Функция для быстрого запуска тестов
export async function runQuickPerformanceTest(socketId?: string): Promise<void> {
	try {
		await performanceTest.runAllTests(socketId);
	} catch (error) {
		console.error('❌ Performance test failed:', error);
	}
}