process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';

// Multiple clients connection

describe('Connection - Multiple clients', () => {
  const { createServer, createClient, cleanup, testEnv } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle multiple clients', async () => {
    const io = await createServer();
    const client1 = createClient();
    const client2 = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Multiple clients timeout')), 5000);
      let connectedCount = 0;

      const checkConnections = () => {
        connectedCount++;
        if (connectedCount === 2) {
          clearTimeout(timeout);
          expect(testEnv.clientsConnectedCount).toBe(2);
          expect(client1.id).not.toBe(client2.id);
          resolve();
        }
      };

      client1.on('connect', checkConnections);
      client2.on('connect', checkConnections);

      client1.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      client2.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
