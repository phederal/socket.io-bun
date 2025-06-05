process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Events - Acknowledgments', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle acknowledgments', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ACK timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.on('test_ack', (data: string, callback: Function) => {
          callback(`ACK: ${data}`);
        });
      });

      client.on('connect', () => {
        client.emit('test_ack', 'ack test', (response: string) => {
          clearTimeout(timeout);
          try {
            expect(response).toBe('ACK: ack test');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
