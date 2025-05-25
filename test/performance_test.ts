/**
 * Полностью переписанные тесты производительности
 * Простые и надежные, без сложной логики
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
		const socket = namespace.sockets.get(socketId);

		if (socket && socket.connected && socket.ws.readyState === 1) {
			return socket;
		}

		console.warn(`⚠️ Socket ${socketId} not available`);
		return null;
	}

	/**
	 * Простой тест emit
	 */
	async testSimpleEmit(socketId: string, count: number = 5000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Simple Emit', count);
		}

		console.log(`🚀 Testing Simple Emit: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if (socket.emit('test_result', `simple_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((successful / timeMs) * 1000);

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
	 * Простой тест fast emit
	 */
	async testFastEmit(socketId: string, count: number = 5000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Fast Emit', count);
		}

		console.log(`⚡ Testing Fast Emit: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if (socket.emitFast('test_result', `fast_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((successful / timeMs) * 1000);

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
	 * Простой тест binary emit
	 */
	async testBinaryEmit(socketId: string, count: number = 5000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Binary Emit', count);
		}

		console.log(`🔥 Testing Binary Emit: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		for (let i = 0; i < count; i++) {
			if (socket.emitBinary('notification', `binary_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((successful / timeMs) * 1000);

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
	 * Простой тест batch emit
	 */
	async testBatchEmit(socketId: string, count: number = 1000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Batch Emit', count);
		}

		console.log(`📦 Testing Batch Emit: ${count} operations`);

		const startTime = Date.now();

		// Создаем простой batch
		const events = [];
		for (let i = 0; i < count; i++) {
			events.push({
				event: 'test_result',
				data: `batch_${i}`,
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
	 * МАКСИМАЛЬНО простой ACK тест - используем события которые точно работают
	 */
	async testSimpleAck(socketId: string, count: number = 100): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			return this.createFailedResult('Simple ACK', count);
		}

		console.log(`🔄 Testing Simple ACK: ${count} operations`);

		return new Promise((resolve) => {
			const startTime = Date.now();
			let successful = 0;
			let completed = 0;

			for (let i = 0; i < count; i++) {
				// Используем событие echo которое точно работает
				socket.emitWithAck(
					'echo',
					`test_${i}`,
					(err: any, response: any) => {
						completed++;
						if (!err && response) {
							successful++;
						}

						if (completed === count) {
							const endTime = Date.now();
							const timeMs = endTime - startTime;
							const opsPerSecond = Math.round((count / timeMs) * 1000);

							const result: PerformanceTestResults = {
								testName: 'Simple ACK',
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
					},
					{ timeout: 5000 }
				);
			}
		});
	}

	/**
	 * Простой broadcast тест
	 */
	async testBroadcast(count: number = 1000): Promise<PerformanceTestResults> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set');
		}

		console.log(`📡 Testing Broadcast: ${count} operations`);

		const startTime = Date.now();
		let successful = 0;

		const namespace = this.ioInstance.of('/');

		for (let i = 0; i < count; i++) {
			if (namespace.emit('test_result', `broadcast_${i}`)) {
				successful++;
			}
		}

		const endTime = Date.now();
		const timeMs = endTime - startTime;
		const opsPerSecond = Math.round((count / timeMs) * 1000);

		const result: PerformanceTestResults = {
			testName: 'Broadcast',
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
	 * Главный тест - простой и надежный
	 */
	async runSimpleTests(socketId: string): Promise<PerformanceTestResults[]> {
		if (!this.ioInstance) {
			throw new Error('IO instance not set');
		}

		console.log(`\n🚀 Running SIMPLE performance tests with socket: ${socketId}`);
		console.log('='.repeat(60));

		this.clearResults();

		// Простые тесты с разумными числами
		await this.testSimpleEmit(socketId, 5000);
		await this.testFastEmit(socketId, 5000);
		await this.testBinaryEmit(socketId, 5000);
		await this.testBatchEmit(socketId, 1000);
		await this.testSimpleAck(socketId, 100);
		await this.testBroadcast(1000);

		this.printSummary();
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
		const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
		console.log(`✅ ${result.testName}:`);
		console.log(`   📊 ${result.operationsPerSecond.toLocaleString()} ops/sec`);
		console.log(`   ⏱️  ${result.timeMs}ms total`);
		console.log(
			`   ✅ ${result.successful}/${result.totalOperations} successful (${successRate}%)`
		);
		if (result.failed > 0) {
			console.log(`   ❌ ${result.failed} failed`);
		}
		console.log('');
	}

	private printSummary(): void {
		console.log('\n🏆 PERFORMANCE SUMMARY');
		console.log('='.repeat(60));

		this.results.forEach((result) => {
			const successRate = ((result.successful / result.totalOperations) * 100).toFixed(1);
			const opsFormatted = result.operationsPerSecond.toLocaleString().padStart(8);
			console.log(
				`${result.testName.padEnd(12)} | ${opsFormatted} ops/sec | ${successRate.padStart(
					5
				)}% success`
			);
		});

		const totalOps = this.results.reduce((sum, r) => sum + r.successful, 0);
		const totalTime = this.results.reduce((sum, r) => sum + r.timeMs, 0);
		const avgOpsPerSec = totalTime > 0 ? Math.round((totalOps / totalTime) * 1000) : 0;

		console.log('-'.repeat(60));
		console.log(
			`${'AVERAGE'.padEnd(12)} | ${avgOpsPerSec
				.toLocaleString()
				.padStart(8)} ops/sec | ${totalOps.toLocaleString()} total ops`
		);

		const bestResult = this.results.reduce((best, current) =>
			current.operationsPerSecond > best.operationsPerSecond ? current : best
		);

		console.log(
			`\n🥇 Best: ${
				bestResult.testName
			} - ${bestResult.operationsPerSecond.toLocaleString()} ops/sec`
		);
		console.log('='.repeat(60));
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
					totalSuccessful: this.results.reduce((sum, r) => sum + r.successful, 0),
					averageOpsPerSec: Math.round(
						(this.results.reduce((sum, r) => sum + r.successful, 0) /
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

// Экспорт
export const performanceTest = new PerformanceTest();

export async function runSimplePerformanceTest(io: any, socketId: string): Promise<void> {
	try {
		performanceTest.setIOInstance(io);
		await performanceTest.runSimpleTests(socketId);
	} catch (error) {
		console.error('❌ Performance test failed:', error);
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
