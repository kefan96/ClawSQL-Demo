/**
 * Event Bus
 *
 * Simple event bus for internal event handling.
 */
import type { ClusterEvent, EventHandler, EventType } from '../types/events.js';
export declare class EventBus {
    private handlers;
    private eventHistory;
    private maxHistorySize;
    /**
     * Emit an event
     */
    emit(event: ClusterEvent): void;
    /**
     * Subscribe to events
     */
    on(type: EventType | '*', handler: EventHandler): void;
    /**
     * Unsubscribe from events
     */
    off(type: EventType | '*', handler: EventHandler): void;
    /**
     * Get event history
     */
    getHistory(limit?: number): ClusterEvent[];
    /**
     * Clear event history
     */
    clearHistory(): void;
}
export declare function getEventBus(): EventBus;
export declare function resetEventBus(): void;
//# sourceMappingURL=bus.d.ts.map