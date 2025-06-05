process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Events - Binary', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle binary data', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Binary data timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.on('binary_test', (data: Buffer) => {
          expect(data).toBeInstanceOf(Buffer);
          socket.emit('binary_response', Buffer.from('response'));
        });
      });

      client.on('binary_response', (response: Buffer) => {
        clearTimeout(timeout);
        expect(response).toBeInstanceOf(Buffer);
        expect(response.toString()).toBe('response');
        resolve();
      });

      client.on('connect', () => {
        const binaryData = Buffer.from('test binary data');
        client.emit('binary_test', binaryData);
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
