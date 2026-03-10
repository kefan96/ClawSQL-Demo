/**
 * Unit tests for Config Type Schemas
 */

import { describe, it, expect } from 'vitest';
import {
  MySQLConfigSchema,
  ProxySQLConfigSchema,
  FailoverConfigSchema,
  AIConfigSchema,
  SchedulerConfigSchema,
  APIConfigSchema,
  LoggingConfigSchema,
  ClusterConfigSchema,
  ConfigSchema,
} from '../../src/types/config.js';

describe('Config Type Schemas', () => {
  describe('MySQLConfigSchema', () => {
    it('should parse valid MySQL config', () => {
      const result = MySQLConfigSchema.safeParse({
        user: 'root',
        password: 'secret',
        connectionPool: 10,
        connectTimeout: 5000,
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = MySQLConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user).toBe('root');
        expect(result.data.password).toBe('');
        expect(result.data.connectionPool).toBe(10);
      }
    });

    it('should reject invalid connectionPool', () => {
      const result = MySQLConfigSchema.safeParse({
        connectionPool: -1,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ProxySQLConfigSchema', () => {
    it('should parse valid ProxySQL config', () => {
      const result = ProxySQLConfigSchema.safeParse({
        host: 'proxysql',
        adminPort: 6032,
        dataPort: 6033,
        user: 'admin',
        password: 'admin',
        hostgroups: { writer: 10, reader: 20 },
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = ProxySQLConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.host).toBe('proxysql');
        expect(result.data.adminPort).toBe(6032);
        expect(result.data.hostgroups.writer).toBe(10);
      }
    });

    it('should reject invalid port', () => {
      const result = ProxySQLConfigSchema.safeParse({
        adminPort: -1, // Negative port should fail
      });

      expect(result.success).toBe(false);
    });

    it('should reject non-integer port', () => {
      const result = ProxySQLConfigSchema.safeParse({
        adminPort: 6032.5, // Non-integer should fail
      });

      expect(result.success).toBe(false);
    });

    it('should accept large port number (schema does not validate max)', () => {
      // Note: The schema only validates positive integers, not port range
      const result = ProxySQLConfigSchema.safeParse({
        adminPort: 70000, // Out of typical port range but valid per schema
      });

      expect(result.success).toBe(true);
    });
  });

  describe('FailoverConfigSchema', () => {
    it('should parse valid failover config', () => {
      const result = FailoverConfigSchema.safeParse({
        enabled: true,
        autoFailover: false,
        failoverTimeout: 30,
        recoveryTimeout: 60,
        minReplicas: 1,
        maxLagSeconds: 5,
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = FailoverConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.autoFailover).toBe(false);
        expect(result.data.minReplicas).toBe(1);
      }
    });

    it('should allow zero minReplicas', () => {
      const result = FailoverConfigSchema.safeParse({
        minReplicas: 0,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('AIConfigSchema', () => {
    it('should parse valid AI config with Anthropic', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'anthropic',
        apiKey: 'sk-ant-xxx',
        model: 'claude-sonnet-4-6',
        features: {
          analysis: true,
          recommendations: true,
          naturalLanguage: true,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should parse valid AI config with OpenAI', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'openai',
        apiKey: 'sk-xxx',
        model: 'gpt-4',
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = AIConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe('anthropic');
        expect(result.data.model).toBe('claude-sonnet-4-6');
        expect(result.data.features.analysis).toBe(true);
      }
    });

    it('should reject invalid provider', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'invalid',
      });

      expect(result.success).toBe(false);
    });

    it('should validate baseURL format', () => {
      const result = AIConfigSchema.safeParse({
        baseURL: 'not-a-url',
      });

      expect(result.success).toBe(false);
    });

    it('should accept valid baseURL', () => {
      const result = AIConfigSchema.safeParse({
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.baseURL).toBe('https://dashscope.aliyuncs.com/apps/anthropic');
      }
    });

    it('should accept undefined baseURL', () => {
      const result = AIConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.baseURL).toBeUndefined();
      }
    });

    it('should accept DashScope Anthropic-compatible URL', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'anthropic',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      });

      expect(result.success).toBe(true);
    });

    it('should accept DashScope OpenAI-compatible URL', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'openai',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });

      expect(result.success).toBe(true);
    });

    it('should accept Azure OpenAI URL', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'openai',
        baseURL: 'https://my-resource.openai.azure.com/',
      });

      expect(result.success).toBe(true);
    });

    it('should accept localhost URL for local LLMs', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'openai',
        baseURL: 'http://localhost:11434/v1',
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid URL format', () => {
      const result = AIConfigSchema.safeParse({
        baseURL: 'invalid-url',
      });

      expect(result.success).toBe(false);
    });

    it('should parse complete AI config with baseURL', () => {
      const result = AIConfigSchema.safeParse({
        provider: 'anthropic',
        apiKey: 'sk-test-key',
        baseURL: 'https://custom.api.endpoint',
        model: 'claude-opus-4-6',
        features: {
          analysis: false,
          recommendations: true,
          naturalLanguage: false,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe('anthropic');
        expect(result.data.apiKey).toBe('sk-test-key');
        expect(result.data.baseURL).toBe('https://custom.api.endpoint');
        expect(result.data.model).toBe('claude-opus-4-6');
        expect(result.data.features.analysis).toBe(false);
      }
    });
  });

  describe('SchedulerConfigSchema', () => {
    it('should parse valid scheduler config', () => {
      const result = SchedulerConfigSchema.safeParse({
        topologyPollInterval: 5000,
        healthCheckInterval: 3000,
        replicationMonitorInterval: 2000,
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = SchedulerConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.topologyPollInterval).toBe(5000);
        expect(result.data.healthCheckInterval).toBe(3000);
      }
    });

    it('should reject non-positive intervals', () => {
      const result = SchedulerConfigSchema.safeParse({
        topologyPollInterval: 0,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('APIConfigSchema', () => {
    it('should parse valid API config', () => {
      const result = APIConfigSchema.safeParse({
        port: 8080,
        host: '0.0.0.0',
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = APIConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
        expect(result.data.host).toBe('0.0.0.0');
      }
    });
  });

  describe('LoggingConfigSchema', () => {
    it('should parse valid logging config', () => {
      const result = LoggingConfigSchema.safeParse({
        level: 'debug',
        format: 'pretty',
      });

      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = LoggingConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.level).toBe('info');
        expect(result.data.format).toBe('json');
      }
    });

    it('should reject invalid level', () => {
      const result = LoggingConfigSchema.safeParse({
        level: 'invalid',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ClusterConfigSchema', () => {
    it('should parse valid cluster config', () => {
      const result = ClusterConfigSchema.safeParse({
        name: 'my-cluster',
        seeds: ['mysql-primary:3306', 'mysql-replica-1:3306'],
      });

      expect(result.success).toBe(true);
    });

    it('should require seeds array', () => {
      const result = ClusterConfigSchema.safeParse({
        name: 'my-cluster',
      });

      expect(result.success).toBe(false);
    });

    it('should apply default name', () => {
      const result = ClusterConfigSchema.safeParse({
        seeds: ['localhost:3306'],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('clawsql-cluster');
      }
    });

    it('should require at least one seed', () => {
      const result = ClusterConfigSchema.safeParse({
        seeds: [],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ConfigSchema (full config)', () => {
    it('should parse valid complete config', () => {
      const result = ConfigSchema.safeParse({
        cluster: {
          name: 'test-cluster',
          seeds: ['mysql-primary:3306'],
        },
        mysql: {
          user: 'root',
          password: 'secret',
        },
        proxysql: {
          host: 'proxysql',
        },
        failover: {
          enabled: true,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should apply all defaults', () => {
      const result = ConfigSchema.safeParse({
        cluster: {
          seeds: ['localhost:3306'],
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Cluster defaults
        expect(result.data.cluster.name).toBe('clawsql-cluster');
        // MySQL defaults
        expect(result.data.mysql.user).toBe('root');
        // ProxySQL defaults
        expect(result.data.proxysql.adminPort).toBe(6032);
        // Failover defaults
        expect(result.data.failover.enabled).toBe(true);
        // API defaults
        expect(result.data.api.port).toBe(8080);
        // Logging defaults
        expect(result.data.logging.level).toBe('info');
      }
    });

    it('should reject config without cluster.seeds', () => {
      const result = ConfigSchema.safeParse({
        cluster: {
          name: 'test',
        },
      });

      expect(result.success).toBe(false);
    });

    it('should deeply merge nested defaults', () => {
      const result = ConfigSchema.safeParse({
        cluster: { seeds: ['localhost:3306'] },
        ai: {
          features: {
            analysis: false, // Override only this
          },
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ai.features.analysis).toBe(false);
        expect(result.data.ai.features.recommendations).toBe(true); // Default
        expect(result.data.ai.features.naturalLanguage).toBe(true); // Default
      }
    });
  });
});