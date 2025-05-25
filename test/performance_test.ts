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
	 * Получить сокет по ID
	 */
	private getSocket(socketId: string) {
		if (!this.ioInstance) {
			throw new Error('IO instance not set. Call setIOInstance() first.');
		}
		const namespace = this.ioInstance.of('/');
		return namespace.sockets.get(socketId);
	}

	/**
	 * Тест производительности простых emit
	 */
	async testSimpleEmit(socketId: string, count: number = 10000): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
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
			failed: count - successful,
		};

		this.results.push(result);
		this.logResult(result);
		return result;
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
		count: number = 1000
	): Promise<PerformanceTestResults> {
		const socket = this.getSocket(socketId);
		if (!socket) {
			throw new Error(`Socket ${socketId} not found`);
		}

		console.log(`🚀 Starting super fast ACK test: ${count} operations`);

		return new Promise((resolve) => {
			const startTime = Date.now();
			let successful = 0;
			let completed = 0;

			for (let i = 0; i < count; i++) {
				(socket as any).emitWithSuperFastAck(
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
								testName: 'Super Fast ACK',
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

		const namespace = this.ioInstance.of('/');
		const availableSockets = Array.from(namespace.sockets.keys());

		const testSocketId = socketId || availableSockets[0];

		if (!testSocketId) {
			throw new Error('No sockets connected for testing');
		}

		console.log(`\n⚡ Running optimized performance tests with socket: ${testSocketId}`);
		console.log('='.repeat(60));

		// Новые оптимизированные тесты
		await this.testInstantEmit(testSocketId, 15000);
		await this.testOptimizedBinaryEmit(testSocketId, 15000);
		await this.testPrecompiledBatch(testSocketId, 10000);
		await this.testSuperFastAck(testSocketId, 2000);

		// Сравнение со старыми методами
		await this.testSimpleEmit(testSocketId, 10000);
		await this.testBinaryEmit(testSocketId, 10000);

		this.printOptimizedSummary();
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
