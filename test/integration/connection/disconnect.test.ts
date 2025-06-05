process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';

// Client initiated disconnection

describe('Connection - Disconnection', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle disconnection', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Disconnection timeout')), 5000);

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
      });

      client.on('disconnect', () => {
        clearTimeout(timeout);
        expect(client.connected).toBe(false);
        resolve();
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
