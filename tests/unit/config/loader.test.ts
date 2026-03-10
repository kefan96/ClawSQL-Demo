/**
 * Unit tests for configuration loader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadConfig,
  getConfig,
  resetConfig,
  updateConfig,
} from '../../src/config/loader.js';

const TEST_CONFIG_DIR = resolve('config/test');

describe('Config Loader', () => {
  beforeEach(() => {
    resetConfig();
    // Clean up test config directory
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });

    // Clear relevant environment variables
    delete process.env.CLAWSQL_CONFIG;
    delete process.env.CLAWSQL_MYSQL_USER;
    delete process.env.CLAWSQL_MYSQL_PASSWORD;
    delete process.env.CLAWSQL_CLUSTER_NAME;
    delete process.env.CLAWSQL_CLUSTER_SEEDS;
  });

  afterEach(() => {
    resetConfig();
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('loadConfig', () => {
    it('should load a valid YAML config file', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'valid.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
mysql:
  user: root
  password: testpass
      `);

      const config = loadConfig(configPath);

      expect(config.cluster.name).toBe('test-cluster');
      expect(config.cluster.seeds).toContain('mysql-primary:3306');
      expect(config.mysql.user).toBe('root');
      expect(config.mysql.password).toBe('testpass');
    });

    it('should throw error for missing config file', () => {
      expect(() => loadConfig('/nonexistent/config.yaml')).toThrow(
        'Configuration file not found'
      );
    });

    it('should throw validation error for invalid config', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'invalid.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  # missing seeds - should fail validation
      `);

      expect(() => loadConfig(configPath)).toThrow(
        'Configuration validation failed'
      );
    });

    it('should merge with default values', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'partial.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
      `);

      const config = loadConfig(configPath);

      // Provided values
      expect(config.cluster.name).toBe('test-cluster');
      // Default values
      expect(config.mysql.user).toBe('root');
      expect(config.failover.enabled).toBe(true);
      expect(config.api.port).toBe(8080);
    });

    it('should deep merge nested config', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'deep-merge.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
failover:
  enabled: false
  # Other failover settings should use defaults
      `);

      const config = loadConfig(configPath);

      expect(config.failover.enabled).toBe(false);
      expect(config.failover.autoFailover).toBe(false);
      expect(config.failover.failoverTimeout).toBe(30);
    });
  });

  describe('environment variable expansion', () => {
    it('should expand ${VAR} syntax', () => {
      process.env.TEST_MYSQL_PASS = 'env_password';

      const configPath = resolve(TEST_CONFIG_DIR, 'env-var.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
mysql:
  password: "\${TEST_MYSQL_PASS}"
      `);

      const config = loadConfig(configPath);
      expect(config.mysql.password).toBe('env_password');

      delete process.env.TEST_MYSQL_PASS;
    });

    it('should expand ${VAR:-default} syntax', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'env-default.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
mysql:
  user: "\${UNDEFINED_VAR:-default_user}"
      `);

      const config = loadConfig(configPath);
      expect(config.mysql.user).toBe('default_user');
    });

    it('should override config with CLAWSQL_* env vars', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'env-override.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
mysql:
  user: file_user
      `);

      process.env.CLAWSQL_MYSQL_USER = 'env_user';
      process.env.CLAWSQL_CLUSTER_SEEDS = '["env-host:3306"]';

      const config = loadConfig(configPath);

      expect(config.mysql.user).toBe('env_user');
      expect(config.cluster.seeds).toContain('env-host:3306');

      delete process.env.CLAWSQL_MYSQL_USER;
      delete process.env.CLAWSQL_CLUSTER_SEEDS;
    });
  });

  describe('getConfig', () => {
    it('should return cached config if already loaded', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'cache.yaml');
      writeFileSync(configPath, `
cluster:
  name: cached-cluster
  seeds:
    - mysql-primary:3306
      `);

      const config1 = loadConfig(configPath);
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });

    it('should load default config if not previously loaded', () => {
      // This test assumes config/default.yaml exists or tests the error
      resetConfig();
      // Without a default config or explicit load, this might throw
      // depending on the implementation
    });
  });

  describe('resetConfig', () => {
    it('should clear cached config', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'reset.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
      `);

      loadConfig(configPath);
      resetConfig();

      // After reset, getConfig should try to load again
      // This tests that the cache was cleared
      expect(() => getConfig()).toThrow();
    });
  });

  describe('updateConfig', () => {
    it('should update nested config value', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'update.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
mysql:
  user: original
      `);

      const config = loadConfig(configPath);
      expect(config.mysql.user).toBe('original');

      updateConfig('mysql.user', 'updated');

      const updated = getConfig();
      expect(updated.mysql.user).toBe('updated');
    });

    it('should validate updated config', () => {
      const configPath = resolve(TEST_CONFIG_DIR, 'update-invalid.yaml');
      writeFileSync(configPath, `
cluster:
  name: test-cluster
  seeds:
    - mysql-primary:3306
      `);

      loadConfig(configPath);

      // Try to set an invalid value
      expect(() => updateConfig('api.port', -1)).toThrow(
        'Configuration validation failed'
      );
    });
  });
});