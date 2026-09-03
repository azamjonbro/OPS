import type { Logger } from 'pino';

export interface ShutdownTask {
  name: string;
  run: () => Promise<void> | void;
}

export interface ShutdownManagerOptions {
  logger: Logger;
  /** Hard deadline before the process is killed regardless of pending tasks. */
  timeoutMs: number;
  /** Injected so tests can observe the exit code instead of killing the runner. */
  exit?: (code: number) => void;
}

export interface ShutdownManager {
  register: (task: ShutdownTask) => void;
  shutdown: (reason: string, exitCode?: number) => Promise<void>;
}

/**
 * Runs cleanup tasks in reverse registration order (last acquired, first
 * released) exactly once, then exits.
 */
export const createShutdownManager = (options: ShutdownManagerOptions): ShutdownManager => {
  const { logger, timeoutMs, exit = (code) => process.exit(code) } = options;
  const tasks: ShutdownTask[] = [];
  let inProgress = false;

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (inProgress) {
      logger.warn({ reason }, 'shutdown already in progress');
      return;
    }

    inProgress = true;
    logger.info({ reason }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.fatal({ reason, timeoutMs }, 'shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);

    forceExit.unref();

    for (const task of [...tasks].reverse()) {
      try {
        await task.run();
        logger.debug({ task: task.name }, 'shutdown task completed');
      } catch (error) {
        logger.error({ err: error, task: task.name }, 'shutdown task failed');
      }
    }

    clearTimeout(forceExit);
    logger.info({ reason }, 'shutdown complete');
    exit(exitCode);
  };

  return {
    register: (task) => {
      tasks.push(task);
    },
    shutdown,
  };
};

/**
 * Binds the process-level signals. An uncaught exception or an unhandled
 * rejection leaves the process in an unknown state, so both trigger a
 * non-zero-code shutdown rather than being swallowed.
 */
export const registerProcessSignalHandlers = (manager: ShutdownManager, logger: Logger): void => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void manager.shutdown(signal);
    });
  }

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void manager.shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void manager.shutdown('unhandledRejection', 1);
  });
};
