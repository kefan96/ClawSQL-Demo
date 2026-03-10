/**
 * Event Handlers
 *
 * Built-in event handlers for common operations.
 */

import type { ClusterEvent } from '../types/events.js';
import { getEventBus } from './bus.js';
import { getWebhookHandler } from './webhooks.js';
import { getLogger } from '../logger.js';

const log = getLogger('event-handlers');

/**
 * Register built-in event handlers
 */
export function registerEventHandlers(): void {
  const bus = getEventBus();

  // Log all events
  bus.on('*', (event: ClusterEvent) => {
    log.info(
      {
        type: event.type,
        cluster: event.cluster,
        severity: event.severity,
        message: event.message,
      },
      'Event received'
    );
  });

  // Send webhooks for important events
  bus.on('failover_complete', async (event: ClusterEvent) => {
    try {
      const webhookHandler = getWebhookHandler();
      await webhookHandler.sendWebhook(event);
    } catch (error) {
      log.warn({ error }, 'Failed to send webhook');
    }
  });

  bus.on('switchover_complete', async (event: ClusterEvent) => {
    try {
      const webhookHandler = getWebhookHandler();
      await webhookHandler.sendWebhook(event);
    } catch (error) {
      log.warn({ error }, 'Failed to send webhook');
    }
  });

  bus.on('topology_change', async (event: ClusterEvent) => {
    try {
      const webhookHandler = getWebhookHandler();
      await webhookHandler.sendWebhook(event);
    } catch (error) {
      log.warn({ error }, 'Failed to send webhook');
    }
  });

  log.info('Event handlers registered');
}