process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Connection - Server side disconnect', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle server-side disconnection', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server disconnection timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.disconnect();
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
