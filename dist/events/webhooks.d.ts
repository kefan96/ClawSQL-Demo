/**
 * Webhook Handler
 *
 * Handles sending and receiving webhooks.
 */
import type { ClusterEvent } from '../types/events.js';
export declare class WebhookHandler {
    private config;
    constructor(config: {
        enabled: boolean;
        secret?: string;
        endpoints: Array<{
            url: string;
            events: string[];
        }>;
    });
    /**
     * Send webhook for an event
     */
    sendWebhook(event: ClusterEvent): Promise<void>;
    /**
     * Send payload to endpoint
     */
    private sendToEndpoint;
    /**
     * Sign payload with secret
     */
    private signPayload;
    /**
     * Verify webhook signature
     */
    verifySignature(payload: string, signature: string): Promise<boolean>;
}
export declare function getWebhookHandler(config?: {
    enabled: boolean;
    secret?: string;
    endpoints: Array<{
        url: string;
        events: string[];
    }>;
}): WebhookHandler;
export declare function resetWebhookHandler(): void;
//# sourceMappingURL=webhooks.d.ts.map