#!/usr/bin/env bun

import { rmSync, mkdirSync, existsSync } from 'fs';

const outdir = './dist';

console.log('🧹 Cleaning dist directory...');
// Очищаем dist
try {
	rmSync(outdir, { recursive: true, force: true });
} catch (e) {
	console.log('No dist directory to clean');
}

mkdirSync(outdir, { recursive: true });
console.log('📁 Created dist directory');

// Проверяем что файл существует
if (!existsSync('./index.ts')) {
	console.error('❌ index.ts not found!');
	process.exit(1);
}

console.log('🔨 Building JavaScript files...');

try {
	const result = await Bun.build({
		entrypoints: ['./index.ts'],
		outdir,
		format: 'esm',
		target: 'bun',
		splitting: true,
		minify: true,
		sourcemap: 'none',
		external: ['hono', 'hono/bun', 'hono/ws', '@msgpack/msgpack', '@socket.io/component-emitter', 'base64id', 'engine.io-parser', 'debug', 'events'],
	});

	if (result.success) {
		console.log('✅ JavaScript build complete');
		console.log(
			'📦 Output files:',
			result.outputs.map((o) => o.path),
		);
	} else {
		console.error('❌ Build failed:');
		result.logs.forEach((log) => console.error(log));
		process.exit(1);
	}
} catch (error) {
	console.error('❌ Build error:', error);
	process.exit(1);
}

console.log('📝 Generating TypeScript declarations...');

try {
	const tscProcess = Bun.spawn(['bunx', 'tsc', '--project', 'tsconfig.build.json', '--emitDeclarationOnly', '--outDir', 'dist'], {
		stdio: ['inherit', 'pipe', 'pipe'],
	});

	const exitCode = await tscProcess.exited;

	if (exitCode === 0) {
		console.log('✅ TypeScript declarations generated');
	} else {
		console.error('❌ TypeScript declarations failed with exit code:', exitCode);

		// Читаем stderr если есть ошибки
		const stderr = await new Response(tscProcess.stderr).text();
		if (stderr) {
			console.error('tsc stderr:', stderr);
		}
	}
} catch (error) {
	console.error('❌ tsc error:', error);
}
