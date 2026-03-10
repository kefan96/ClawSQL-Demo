/**
 * Event Bus
 *
 * Simple event bus for internal event handling.
 */
import { getLogger } from '../logger.js';
const log = getLogger('event-bus');
export class EventBus {
    handlers = new Map();
    eventHistory = [];
    maxHistorySize = 1000;
    /**
     * Emit an event
     */
    emit(event) {
        // Store in history
        this.eventHistory.push(event);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
        // Get handlers for this event type
        const typeHandlers = this.handlers.get(event.type) ?? new Set();
        const wildcardHandlers = this.handlers.get('*') ?? new Set();
        // Call all handlers
        const allHandlers = [...typeHandlers, ...wildcardHandlers];
        for (const handler of allHandlers) {
            try {
                const result = handler(event);
                if (result instanceof Promise) {
                    result.catch(err => {
                        log.error({ err, eventType: event.type }, 'Async event handler error');
                    });
                }
            }
            catch (error) {
                log.error({ error, eventType: event.type }, 'Event handler error');
            }
        }
    }
    /**
     * Subscribe to events
     */
    on(type, handler) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type).add(handler);
    }
    /**
     * Unsubscribe from events
     */
    off(type, handler) {
        this.handlers.get(type)?.delete(handler);
    }
    /**
     * Get event history
     */
    getHistory(limit) {
        if (limit) {
            return this.eventHistory.slice(-limit);
        }
        return [...this.eventHistory];
    }
    /**
     * Clear event history
     */
    clearHistory() {
        this.eventHistory = [];
    }
}
// Singleton instance
let _bus = null;
export function getEventBus() {
    if (!_bus) {
        _bus = new EventBus();
    }
    return _bus;
}
export function resetEventBus() {
    _bus = null;
}
//# sourceMappingURL=bus.js.map