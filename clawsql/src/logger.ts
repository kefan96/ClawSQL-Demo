/**
 * Logger Module
 *
 * Provides a structured logger using pino
 */

import { pino, type Logger, type LoggerOptions } from 'pino';
import type { LoggingConfig } from './types/config.js';

let _logger: Logger | undefined;

export function initLogger(config: LoggingConfig): Logger {
  const options: LoggerOptions = {
    level: config.level,
  };

  if (config.format === 'pretty') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  _logger = pino(options);
  return _logger;
}

export function getLogger(name: string): Logger {
  if (!_logger) {
    _logger = pino({ level: 'info' });
  }
  return _logger.child({ name });
}

export function getRootLogger(): Logger {
  if (!_logger) {
    _logger = pino({ level: 'info' });
  }
  return _logger;
}