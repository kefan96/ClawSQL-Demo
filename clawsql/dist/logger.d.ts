/**
 * Logger Module
 *
 * Provides a structured logger using pino
 */
import { type Logger } from 'pino';
import type { LoggingConfig } from './types/config.js';
export declare function initLogger(config: LoggingConfig): Logger;
export declare function getLogger(name: string): Logger;
export declare function getRootLogger(): Logger;
//# sourceMappingURL=logger.d.ts.map