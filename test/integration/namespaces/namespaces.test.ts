process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Namespaces', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle namespaces', async () => {
    const io = await createServer();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Namespace timeout')), 5000);

      const chatNamespace = io.of('/chat');

      chatNamespace.on('connection', (socket: Socket) => {
        clearTimeout(timeout);
        expect(socket.nsp.name).toBe('/chat');
        resolve();
      });

      const client = createClient({ namespace: '/chat' });

      client.on('connect', () => {
        expect((client as any).nsp).toBe('/chat');
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
