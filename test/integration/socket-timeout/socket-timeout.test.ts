process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Socket timeout', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should timeout if client does not ACK', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout test failed')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.timeout(50).emit('unknown', (err: Error) => {
          clearTimeout(timeout);
          try {
            expect(err).toBeInstanceOf(Error);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  test('should not timeout if ACK is received', async () => {
    const io = await createServer();
    const client = createClient();

    client.on('echo', (arg: number, cb: Function) => {
      cb(arg);
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout ack test failed')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.timeout(100).emit('echo', 42, (err: Error | null, value?: number) => {
          clearTimeout(timeout);
          try {
            expect(err).toBeNull();
            expect(value).toBe(42);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });
});
