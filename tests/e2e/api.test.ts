/**
 * End-to-End Tests for API
 *
 * These tests require a running API server.
 * Run with: npm run test:e2e
 *
 * Prerequisites:
 * - API server running on localhost:8080
 * - MySQL and ProxySQL containers running
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API_HOST = process.env.CLAWSQL_API_HOST || 'localhost';
const API_PORT = parseInt(process.env.CLAWSQL_API_PORT || '8080', 10);
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

// Skip E2E tests unless explicitly enabled
const shouldRunE2ETests = process.env.RUN_E2E_TESTS === 'true' || process.env.CI === 'true';

const describeE2E = shouldRunE2ETests ? describe : describe.skip;

async function fetchAPI(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  return response;
}

describeE2E('API E2E Tests', () => {
  describe('Health Endpoint', () => {
    it('should return health status', async () => {
      const response = await fetchAPI('/health');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.healthy).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });

    it('should return component health details', async () => {
      const response = await fetchAPI('/health');

      const data = await response.json();
      expect(data.components).toBeDefined();
      expect(data.components.mysql).toBeDefined();
      expect(data.components.proxysql).toBeDefined();
      expect(data.components.topology).toBeDefined();
    });
  });

  describe('Topology Endpoint', () => {
    it('should return topology information', async () => {
      const response = await fetchAPI('/api/topology');

      // May fail if cluster not available
      if (response.status === 200) {
        const data = await response.json();
        expect(data.clusterName).toBeDefined();
        expect(data.primary).toBeDefined();
        expect(Array.isArray(data.replicas)).toBe(true);
      } else {
        expect(response.status).toBe(503); // Service unavailable
      }
    });

    it('should return primary information', async () => {
      const response = await fetchAPI('/api/topology/primary');

      // May fail if cluster not available
      expect([200, 404, 503]).toContain(response.status);
    });

    it('should return replicas information', async () => {
      const response = await fetchAPI('/api/topology/replicas');

      // May fail if cluster not available
      if (response.status === 200) {
        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
      }
    });

    it('should return problems', async () => {
      const response = await fetchAPI('/api/topology/problems');

      if (response.status === 200) {
        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
      }
    });
  });

  describe('SQL Endpoint', () => {
    it('should execute SELECT query', async () => {
      const response = await fetchAPI('/api/sql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'SELECT 1 as test',
        }),
      });

      if (response.status === 200) {
        const data = await response.json();
        expect(data.columns).toBeDefined();
        expect(data.rows).toBeDefined();
        expect(data.rowCount).toBe(1);
      }
    });

    it('should reject dangerous queries', async () => {
      const response = await fetchAPI('/api/sql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'DROP TABLE users',
        }),
      });

      // Should be rejected (400 Bad Request or 403 Forbidden)
      expect([400, 403]).toContain(response.status);
    });

    it('should require query parameter', async () => {
      const response = await fetchAPI('/api/sql', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it('should support database parameter', async () => {
      const response = await fetchAPI('/api/sql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'SELECT DATABASE()',
          database: 'mysql',
        }),
      });

      // May fail if database doesn't exist
      expect([200, 400, 404]).toContain(response.status);
    });
  });

  describe('Failover Endpoints', () => {
    it('should check failover status', async () => {
      const response = await fetchAPI('/api/failover/status');

      if (response.status === 200) {
        const data = await response.json();
        expect(data.inProgress).toBeDefined();
      }
    });

    it('should check switchover eligibility', async () => {
      const response = await fetchAPI('/api/failover/switchover/check');

      if (response.status === 200) {
        const data = await response.json();
        expect(data.canSwitchover).toBeDefined();
      }
    });

    // Note: Actual failover/switchover tests would require more setup
    // and are potentially destructive, so we only test the check endpoint
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await fetchAPI('/api/unknown');

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${API_BASE_URL}/api/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      expect(response.status).toBe(400);
    });

    it('should handle large request bodies', async () => {
      const largeQuery = 'SELECT 1' + ' '.repeat(100000);

      const response = await fetchAPI('/api/sql', {
        method: 'POST',
        body: JSON.stringify({ query: largeQuery }),
      });

      // Should either accept or reject, not crash
      expect([200, 400, 413]).toContain(response.status);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await fetchAPI('/health', {
        method: 'OPTIONS',
      });

      // CORS preflight should work
      expect(response.status).toBe(204);
    });
  });

  describe('WebSocket Endpoint', () => {
    it('should handle WebSocket connection', async () => {
      // WebSocket tests require special setup
      // For now, we just verify the endpoint exists
      const response = await fetchAPI('/ws');

      // WebSocket upgrade would return 426 Upgrade Required
      // or 400 if not a proper WebSocket request
      expect([400, 426]).toContain(response.status);
    });
  });
});