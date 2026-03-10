/**
 * Global test setup and teardown
 */

import { afterEach, beforeEach } from 'vitest';

// Reset all singleton instances before each test
beforeEach(() => {
  // Clear any cached modules
});

// Clean up after each test
afterEach(() => {
  // Reset environment variables
  delete process.env.CLAWSQL_CONFIG;
  delete process.env.CLAWSQL_MYSQL_HOST;
  delete process.env.CLAWSQL_MYSQL_PASSWORD;
  delete process.env.CLAWSQL_PROXYSQL_HOST;
});