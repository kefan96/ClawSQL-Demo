/**
 * Logger Module
 *
 * Provides a structured logger using pino
 */
import { pino } from 'pino';
let _logger;
export function initLogger(config) {
    const options = {
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
export function getLogger(name) {
    if (!_logger) {
        _logger = pino({ level: 'info' });
    }
    return _logger.child({ name });
}
export function getRootLogger() {
    if (!_logger) {
        _logger = pino({ level: 'info' });
    }
    return _logger;
}
//# sourceMappingURL=logger.js.map