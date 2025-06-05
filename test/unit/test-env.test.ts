/**
 * Unit tests for TestEnvironment
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { TestEnvironment } from '../utils/test-env';

function ensureCerts() {
	if (!existsSync('dev')) {
	    mkdirSync('dev');
	}
	if (!existsSync('dev/localhost-key.pem') || !existsSync('dev/localhost.pem')) {
	    spawnSync('openssl', [
	        'req',
	        '-x509',
	        '-newkey', 'rsa:2048',
	        '-nodes',
	        '-keyout', 'dev/localhost-key.pem',
	        '-out', 'dev/localhost.pem',
	        '-subj', '/CN=localhost',
	        '-days', '1',
	    ], { stdio: 'ignore' });
	}
}

ensureCerts();

describe('TestEnvironment', () => {
	let env: TestEnvironment;

	afterEach(() => {
	    env.cleanup();
	});

	test('TLS is enabled by default', () => {
	    env = new TestEnvironment();
	    expect((env as any).usesTLS).toBe(true);
	});

	test('passing { tls: false } disables TLS', () => {
	    env = new TestEnvironment({ tls: false });
	    expect((env as any).usesTLS).toBe(false);
	});

	test('cleanup stops server and disconnects clients', async () => {
	    env = new TestEnvironment({ tls: false });
	    await env.createServer();
	    const client = env.createClient();
	    await new Promise((resolve) => client.on('connect', resolve));
	    expect(client.connected).toBe(true);

	    env.cleanup();

	    expect(env.url).toBeUndefined();
	    expect(client.connected).toBe(false);
	    expect(env.clientsConnectedCount).toBe(0);
	});
});
