/**
 * Скрипт для запуска тестов с реальным сервером
 */

import { spawn } from 'bun';

async function runTestsWithServer() {
	console.log('🚀 Starting test server...');

	// Запускаем тест-сервер
	const server = spawn({
		cmd: ['bun', 'run', 'test/server/test-server.ts'],
		env: {
			...process.env,
			NODE_ENV: 'test',
			NODE_TLS_REJECT_UNAUTHORIZED: '0', // Отключаем проверку SSL для тестов
		},
		stdout: 'pipe',
		stderr: 'pipe',
	});

	// Ждем запуска сервера
	await new Promise((resolve) => setTimeout(resolve, 3000));
	console.log('✅ Test server started on port 8443');

	try {
		// Запускаем все существующие тесты
		console.log('🧪 Running unit tests with real server...');

		const testProcess = spawn({
			cmd: ['bun', 'test', 'test/unit/', '--timeout', '10000'],
			env: {
				...process.env,
				TEST_SERVER_URL: 'wss://localhost:8443',
				NODE_TLS_REJECT_UNAUTHORIZED: '0', // Отключаем проверку SSL для тестов
			},
			stdout: 'inherit',
			stderr: 'inherit',
		});

		const testResult = await testProcess.exited;

		if (testResult === 0) {
			console.log('✅ All tests passed!');
		} else {
			console.log('❌ Some tests failed');
		}

		return testResult;
	} finally {
		// Останавливаем сервер
		console.log('🛑 Stopping test server...');
		server.kill();
		await server.exited;
		console.log('✅ Test server stopped');
	}
}

// Запускаем если скрипт вызван напрямую
if (import.meta.main) {
	const exitCode = await runTestsWithServer();
	process.exit(exitCode);
}
