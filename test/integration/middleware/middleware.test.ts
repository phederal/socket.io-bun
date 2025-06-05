process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Server middleware', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should call middleware functions before connection', async () => {
    const io = await createServer();
    let run = 0;
    io.use((socket: Socket, next) => {
      run++;
      next();
    });
    io.use((socket: Socket, next) => {
      run++;
      next();
    });

    return new Promise<void>((resolve, reject) => {
      const client = createClient();
      const timeout = setTimeout(() => reject(new Error('Middleware timeout')), 5000);

      client.on('connect', () => {
        clearTimeout(timeout);
        try {
          expect(run).toBe(2);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  test('should pass error from middleware', async () => {
    const io = await createServer();
    io.use((socket: Socket, next) => {
      next(new Error('Auth error'));
    });

    return new Promise<void>((resolve, reject) => {
      const client = createClient();
      const timeout = setTimeout(() => reject(new Error('Middleware error timeout')), 5000);

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        try {
          expect(err.message).toBe('Auth error');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
