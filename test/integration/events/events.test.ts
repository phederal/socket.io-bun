process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { describe, test, expect, afterEach } from 'bun:test';
import { TestEnvironment } from '../../utils/test-env';
import type { Socket } from '../../../src/socket';

describe('Events', () => {
  const { createServer, createClient, cleanup } = new TestEnvironment({ tls: false });

  afterEach(() => {
    cleanup();
  });

  test('should exchange events between client and server', async () => {
    const io = await createServer();
    const client = createClient();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Event exchange timeout')), 5000);

      io.on('connection', (socket: Socket) => {
        socket.on('test_event', (data: string) => {
          socket.emit('test_response', `Server received: ${data}`);
        });
      });

      client.on('test_response', (response: string) => {
        clearTimeout(timeout);
        expect(response).toBe('Server received: hello from client');
        resolve();
      });

      client.on('connect', () => {
        client.emit('test_event', 'hello from client');
      });

      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });
});
