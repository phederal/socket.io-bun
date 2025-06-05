process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Handshake', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should expose handshake details', async () => {
    const io = await createServer();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Handshake timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        clearTimeout(timeout);
        try {
          expect(socket.handshake).toBeDefined();
          expect(typeof socket.handshake.time).toBe('string');
          expect(socket.handshake.auth).toEqual({ token: 'abc' });
          expect(typeof socket.handshake.query).toBe('function');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      createClient({ auth: { token: 'abc' }, query: { foo: 'bar' } });
    });
  });
});
