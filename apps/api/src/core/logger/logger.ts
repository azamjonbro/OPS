import { pino, type Logger, type LoggerOptions } from 'pino';

import { config } from '../../config/index.js';

/**
 * Anything matching these paths is replaced with `[redacted]` before it reaches
 * a log sink, so a stray object dump cannot leak a credential.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'passwordHash',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
];

const buildOptions = (): LoggerOptions => {
  const options: LoggerOptions = {
    level: config.log.level,
    base: { service: config.app.name, version: config.app.version, env: config.app.env },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!config.log.pretty) {
    return options;
  }

  return {
    ...options,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
    },
  };
};

export const logger: Logger = pino(buildOptions());

/** A child logger for one subsystem, e.g. `createLogger('mongo')`. */
export const createLogger = (context: string): Logger => logger.child({ context });

export type { Logger };
