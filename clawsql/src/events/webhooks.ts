/**
 * Webhook Handler
 *
 * Handles sending and receiving webhooks.
 */

import type { ClusterEvent, WebhookConfig, WebhookPayload } from '../types/events.js';
import { getLogger } from '../logger.js';

const log = getLogger('webhooks');

export class WebhookHandler {
  private config: {
    enabled: boolean;
    secret?: string;
    endpoints: Array<{ url: string; events: string[] }>;
  };

  constructor(config: { enabled: boolean; secret?: string; endpoints: Array<{ url: string; events: string[] }> }) {
    this.config = config;
  }

  /**
   * Send webhook for an event
   */
  async sendWebhook(event: ClusterEvent): Promise<void> {
    if (!this.config.enabled || this.config.endpoints.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      event: event.type,
      cluster: event.cluster,
      timestamp: event.timestamp.toISOString(),
      data: event.details,
    };

    // Add signature if secret is configured
    if (this.config.secret) {
      payload.signature = await this.signPayload(payload);
    }

    for (const endpoint of this.config.endpoints) {
      // Check if endpoint wants this event type
      if (endpoint.events.length > 0 && !endpoint.events.includes(event.type)) {
        continue;
      }

      try {
        await this.sendToEndpoint(endpoint.url, payload);
        log.debug({ url: endpoint.url, eventType: event.type }, 'Webhook sent');
      } catch (error) {
        log.error({ error, url: endpoint.url }, 'Webhook send failed');
      }
    }
  }

  /**
   * Send payload to endpoint
   */
  private async sendToEndpoint(url: string, payload: WebhookPayload): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
  }

  /**
   * Sign payload with secret
   */
  private async signPayload(payload: WebhookPayload): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));
    const key = encoder.encode(this.config.secret!);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
    return Buffer.from(signature).toString('hex');
  }

  /**
   * Verify webhook signature
   */
  async verifySignature(payload: string, signature: string): Promise<boolean> {
    if (!this.config.secret) {
      return true;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const key = encoder.encode(this.config.secret);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBuffer = Buffer.from(signature, 'hex');
    return crypto.subtle.verify('HMAC', cryptoKey, sigBuffer, data);
  }
}

// Singleton instance
let _handler: WebhookHandler | null = null;

export function getWebhookHandler(config?: {
  enabled: boolean;
  secret?: string;
  endpoints: Array<{ url: string; events: string[] }>;
}): WebhookHandler {
  if (!_handler && config) {
    _handler = new WebhookHandler(config);
  }
  if (!_handler) {
    throw new Error('Webhook handler not initialized');
  }
  return _handler;
}

export function resetWebhookHandler(): void {
  _handler = null;
}