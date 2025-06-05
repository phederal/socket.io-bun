process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Rooms', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should handle room operations', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Room operations timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.join('test-room');
        socket.to('test-room').emit('room_broadcast', 'Hello room!');
      });

      client.on('room_broadcast', (message: string) => {
        clearTimeout(timeout);
        expect(message).toBe('Hello room!');
        resolve();
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
