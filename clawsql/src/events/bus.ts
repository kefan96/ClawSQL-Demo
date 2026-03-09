/**
 * Event Bus
 *
 * Simple event bus for internal event handling.
 */

import type { ClusterEvent, EventHandler, EventType } from '../types/events.js';
import { getLogger } from '../logger.js';

const log = getLogger('event-bus');

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private eventHistory: ClusterEvent[] = [];
  private maxHistorySize = 1000;

  /**
   * Emit an event
   */
  emit(event: ClusterEvent): void {
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
      } catch (error) {
        log.error({ error, eventType: event.type }, 'Event handler error');
      }
    }
  }

  /**
   * Subscribe to events
   */
  on(type: EventType | '*', handler: EventHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  /**
   * Unsubscribe from events
   */
  off(type: EventType | '*', handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  /**
   * Get event history
   */
  getHistory(limit?: number): ClusterEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
}

// Singleton instance
let _bus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!_bus) {
    _bus = new EventBus();
  }
  return _bus;
}

export function resetEventBus(): void {
  _bus = null;
}