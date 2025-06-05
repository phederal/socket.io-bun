process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Socket middleware', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should call middleware functions', async () => {
    const io = await createServer();
    const client = createClient({ autoConnect: false });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Middleware timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        let run = 0;
        socket.use((event, next) => {
          expect(event).toEqual(['join', 'room1']);
          event.unshift('wrapped');
          run++;
          next();
        });
        socket.use((event, next) => {
          expect(event).toEqual(['wrapped', 'join', 'room1']);
          run++;
          next();
        });
        socket.on('wrapped', (data1: string, data2: string) => {
          clearTimeout(timeout);
          try {
            expect(data1).toBe('join');
            expect(data2).toBe('room1');
            expect(run).toBe(2);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      client.on('connect', () => {
        client.emit('join', 'room1');
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.connect();
    });
  });

  test('should pass errors from middleware', async () => {
    const io = await createServer();
    const client = createClient({ autoConnect: false });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Middleware error timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.use((event, next) => {
          next(new Error('Authentication error'));
        });
        socket.on('error', (err) => {
          clearTimeout(timeout);
          try {
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('Authentication error');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      client.on('connect_error', () => {});
      client.connect();
    });
  });
});
