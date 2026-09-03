import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { createShutdownManager } from './shutdown.js';

const silentLogger = pino({ level: 'silent' });

describe('createShutdownManager', () => {
  it('runs tasks in reverse registration order and exits', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const manager = createShutdownManager({ logger: silentLogger, timeoutMs: 1_000, exit });

    manager.register({ name: 'database', run: () => void order.push('database') });
    manager.register({ name: 'http-server', run: () => void order.push('http-server') });

    await manager.shutdown('SIGTERM');

    expect(order).toEqual(['http-server', 'database']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps going when a task fails and still exits with the requested code', async () => {
    const exit = vi.fn();
    const manager = createShutdownManager({ logger: silentLogger, timeoutMs: 1_000, exit });
    const second = vi.fn();

    manager.register({ name: 'second', run: second });
    manager.register({
      name: 'first',
      run: () => Promise.reject(new Error('close failed')),
    });

    await manager.shutdown('uncaughtException', 1);

    expect(second).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('ignores a second shutdown request', async () => {
    const exit = vi.fn();
    const manager = createShutdownManager({ logger: silentLogger, timeoutMs: 1_000, exit });

    await manager.shutdown('SIGINT');
    await manager.shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledOnce();
  });
});
