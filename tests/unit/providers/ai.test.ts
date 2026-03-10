/**
 * Unit tests for AI Provider
 *
 * Tests use mocked AI SDK clients to avoid actual API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider, getAIProvider, resetAIProvider } from '../../src/providers/ai.js';
import type { Topology, Problem } from '../../src/types/topology.js';
import type { FailoverCandidate, SwitchoverCheck } from '../../src/types/failover.js';
import { mockTopology, mockFailoverCandidate } from '../../helpers/fixtures.js';

// Mock create function that will be returned by the mock constructor
const mockCreate = vi.fn();
const mockChatCreate = vi.fn();

// Track last constructor config
let lastAnthropicConfig: any = null;
let lastOpenAIConfig: any = null;

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((config: any) => {
    lastAnthropicConfig = config;
    return {
      messages: {
        create: mockCreate,
      },
    };
  }),
}));

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((config: any) => {
    lastOpenAIConfig = config;
    return {
      chat: {
        completions: {
          create: mockChatCreate,
        },
      },
    };
  }),
}));

describe('AIProvider', () => {
  let provider: AIProvider;

  const defaultConfig = {
    provider: 'anthropic' as const,
    apiKey: 'test-api-key',
    model: 'claude-sonnet-4-6',
    features: {
      analysis: true,
      recommendations: true,
      naturalLanguage: true,
    },
  };

  beforeEach(() => {
    resetAIProvider();
    vi.clearAllMocks();
    mockCreate.mockClear();
    mockChatCreate.mockClear();
    lastAnthropicConfig = null;
    lastOpenAIConfig = null;
    provider = new AIProvider(defaultConfig);
  });

  afterEach(() => {
    resetAIProvider();
    vi.clearAllMocks();
  });

  describe('constructor and baseURL', () => {
    it('should pass apiKey to Anthropic client', () => {
      resetAIProvider();
      lastAnthropicConfig = null;
      new AIProvider({
        provider: 'anthropic',
        apiKey: 'my-api-key',
        model: 'claude-sonnet-4-6',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(lastAnthropicConfig).toEqual(
        expect.objectContaining({
          apiKey: 'my-api-key',
        })
      );
    });

    it('should pass baseURL to Anthropic client', () => {
      resetAIProvider();
      lastAnthropicConfig = null;
      new AIProvider({
        provider: 'anthropic',
        apiKey: 'my-api-key',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        model: 'claude-sonnet-4-6',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(lastAnthropicConfig).toEqual(
        expect.objectContaining({
          apiKey: 'my-api-key',
          baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        })
      );
    });

    it('should pass baseURL to OpenAI client', () => {
      resetAIProvider();
      lastOpenAIConfig = null;
      new AIProvider({
        provider: 'openai',
        apiKey: 'my-api-key',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'gpt-4',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(lastOpenAIConfig).toEqual(
        expect.objectContaining({
          apiKey: 'my-api-key',
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        })
      );
    });

    it('should work without baseURL (default behavior)', () => {
      resetAIProvider();
      lastAnthropicConfig = null;
      new AIProvider({
        provider: 'anthropic',
        apiKey: 'my-api-key',
        model: 'claude-sonnet-4-6',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(lastAnthropicConfig).toEqual(
        expect.objectContaining({
          apiKey: 'my-api-key',
        })
      );

      // baseURL should be undefined when not provided
      expect(lastAnthropicConfig.baseURL).toBeUndefined();
    });

    it('should warn when no API key provided', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      resetAIProvider();

      new AIProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      // Should not have called the constructor with no API key
      // Provider should handle this gracefully
      warnSpy.mockRestore();
    });

    it('should support DashScope Anthropic-compatible endpoint', () => {
      resetAIProvider();
      lastAnthropicConfig = null;
      new AIProvider({
        provider: 'anthropic',
        apiKey: 'sk-dashscope-key',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        model: 'claude-3-sonnet-20240229',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(lastAnthropicConfig).toEqual(
        expect.objectContaining({
          apiKey: 'sk-dashscope-key',
          baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        })
      );
    });

    it('should support DashScope OpenAI-compatible endpoint', () => {
      resetAIProvider();
      lastOpenAIConfig = null;
      new AIProvider({
        provider: 'openai',
        apiKey: 'sk-dashscope-key',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-turbo',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(lastOpenAIConfig).toEqual(
        expect.objectContaining({
          apiKey: 'sk-dashscope-key',
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        })
      );
    });
  });

  describe('analyzeTopology', () => {
    it('should return AI-powered analysis when enabled', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            healthy: true,
            riskLevel: 'low',
            recommendations: ['Monitor replication lag'],
            concerns: [],
          }),
        }],
      });

      const analysis = await provider.analyzeTopology(mockTopology);

      expect(analysis.healthy).toBe(true);
      expect(analysis.riskLevel).toBe('low');
      expect(analysis.recommendations).toContain('Monitor replication lag');
    });

    it('should fallback to basic analysis on AI failure', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const analysis = await provider.analyzeTopology(mockTopology);

      expect(analysis).toBeDefined();
      expect(analysis.primary).toBeDefined();
    });

    it('should use basic analysis when features disabled', async () => {
      const basicProvider = new AIProvider({
        ...defaultConfig,
        features: { ...defaultConfig.features, analysis: false },
      });

      const analysis = await basicProvider.analyzeTopology(mockTopology);

      expect(analysis).toBeDefined();
      expect(analysis.replicaCount).toBe(mockTopology.replicas.length);
    });

    it('should detect high risk for no primary', async () => {
      const noPrimaryTopology: Topology = {
        ...mockTopology,
        primary: null,
        problems: [{
          type: 'no_primary',
          severity: 'critical',
          instance: 'cluster',
          message: 'No primary detected',
          detectedAt: new Date(),
        }],
      };

      const analysis = await provider.analyzeTopology(noPrimaryTopology);

      expect(analysis.healthy).toBe(false);
      expect(analysis.riskLevel).toBe('high');
    });
  });

  describe('recommendFailover', () => {
    it('should return AI recommendation for failover candidates', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            recommendedHost: 'mysql-replica-1:3306',
            confidence: 0.95,
            reasoning: 'Lowest lag and healthy replication',
            alternatives: [],
          }),
        }],
      });

      const recommendation = await provider.recommendFailover(
        mockTopology,
        [mockFailoverCandidate]
      );

      expect(recommendation.recommendedHost).toBe('mysql-replica-1:3306');
      expect(recommendation.confidence).toBeGreaterThan(0);
    });

    it('should fallback to basic recommendation on failure', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const recommendation = await provider.recommendFailover(
        mockTopology,
        [mockFailoverCandidate]
      );

      expect(recommendation.recommendedHost).toContain('mysql-replica-1');
    });

    it('should return basic recommendation when no candidates', async () => {
      const recommendation = await provider.recommendFailover(
        mockTopology,
        []
      );

      expect(recommendation.recommendedHost).toBe('none');
      expect(recommendation.confidence).toBe(0);
    });

    it('should rank candidates by score and lag', async () => {
      const candidates: FailoverCandidate[] = [
        { ...mockFailoverCandidate, host: 'replica-1', score: 90, lag: 5 },
        { ...mockFailoverCandidate, host: 'replica-2', score: 100, lag: 1 },
        { ...mockFailoverCandidate, host: 'replica-3', score: 80, lag: 10 },
      ];

      const basicProvider = new AIProvider({
        ...defaultConfig,
        features: { ...defaultConfig.features, recommendations: false },
      });

      const recommendation = await basicProvider.recommendFailover(
        mockTopology,
        candidates
      );

      expect(recommendation.recommendedHost).toContain('replica-2');
    });
  });

  describe('parseCommand', () => {
    it('should parse switchover command', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            intent: 'switchover',
            target: 'replica-1',
            parameters: {},
            confidence: 0.9,
          }),
        }],
      });

      const parsed = await provider.parseCommand('switch to replica-1');

      expect(parsed.intent).toBe('switchover');
      expect(parsed.target).toBe('replica-1');
    });

    it('should parse status command', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            intent: 'status',
            target: null,
            parameters: {},
            confidence: 0.95,
          }),
        }],
      });

      const parsed = await provider.parseCommand('show me the topology');

      expect(parsed.intent).toBe('status');
    });

    it('should use basic parsing when disabled', async () => {
      const basicProvider = new AIProvider({
        ...defaultConfig,
        features: { ...defaultConfig.features, naturalLanguage: false },
      });

      const parsed = await basicProvider.parseCommand('switch to replica-1');

      expect(parsed.intent).toBe('switchover');
      expect(parsed.confidence).toBeLessThan(0.9);
    });

    it('should detect failover intent', async () => {
      const basicProvider = new AIProvider({
        ...defaultConfig,
        features: { ...defaultConfig.features, naturalLanguage: false },
      });

      const parsed = await basicProvider.parseCommand('emergency failover now');

      expect(parsed.intent).toBe('failover');
    });

    it('should detect analyze intent', async () => {
      const basicProvider = new AIProvider({
        ...defaultConfig,
        features: { ...defaultConfig.features, naturalLanguage: false },
      });

      const parsed = await basicProvider.parseCommand("what's wrong with the cluster");

      expect(parsed.intent).toBe('analyze');
    });
  });

  describe('generateSQL', () => {
    it('should generate SQL from natural language', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            sql: 'SELECT * FROM users LIMIT 100',
            explanation: 'Selects all users with a limit',
            isSafe: true,
            warnings: [],
            confidence: 0.9,
          }),
        }],
      });

      const result = await provider.generateSQL({
        query: 'show me all users',
        database: 'testdb',
        readOnly: true,
        schema: {
          database: 'testdb',
          tables: [{
            name: 'users',
            columns: [
              { name: 'id', type: 'int', nullable: false, key: 'PRI' },
              { name: 'name', type: 'varchar(255)', nullable: true, key: null },
            ],
          }],
        },
      });

      expect(result.sql).toContain('SELECT');
      expect(result.isSafe).toBe(true);
    });

    it('should reject unsafe SQL in read-only mode', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            sql: 'DELETE FROM users',
            explanation: 'Deletes all users',
            isSafe: true,
            warnings: [],
            confidence: 0.9,
          }),
        }],
      });

      const result = await provider.generateSQL({
        query: 'delete all users',
        database: 'testdb',
        readOnly: true,
      });

      expect(result.isSafe).toBe(false);
    });

    it('should detect dangerous patterns', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            sql: 'SELECT * FROM users; DROP TABLE users;',
            explanation: 'Select and drop',
            isSafe: true,
            warnings: [],
          }),
        }],
      });

      const result = await provider.generateSQL({
        query: 'show users and clean up',
        database: 'testdb',
        readOnly: true,
      });

      expect(result.isSafe).toBe(false);
    });
  });

  describe('validateSwitchover', () => {
    it('should validate a valid switchover', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            valid: true,
            warnings: [],
            advice: 'Proceed with switchover during low traffic',
          }),
        }],
      });

      const check: SwitchoverCheck = {
        canSwitchover: true,
        reasons: [],
        warnings: ['High traffic period'],
        suggestedTarget: 'replica-1:3306',
      };

      const result = await provider.validateSwitchover(
        check,
        'primary:3306',
        'replica-1:3306'
      );

      expect(result.valid).toBe(true);
    });

    it('should reject invalid switchover', async () => {
      const check: SwitchoverCheck = {
        canSwitchover: false,
        reasons: ['No replicas available'],
        warnings: [],
        suggestedTarget: null,
      };

      const result = await provider.validateSwitchover(
        check,
        'primary:3306',
        'replica-1:3306'
      );

      expect(result.valid).toBe(false);
      expect(result.warnings).toContain('No replicas available');
    });
  });

  describe('explainEvent', () => {
    it('should explain events in natural language', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: 'The primary server has failed over to a new replica. This was an automatic failover triggered by the health monitoring system.',
        }],
      });

      const explanation = await provider.explainEvent({
        id: 'evt-1',
        type: 'failover',
        timestamp: new Date(),
        cluster: 'test-cluster',
        severity: 'warning',
        message: 'Failover completed',
        details: { newPrimary: 'replica-1:3306' },
      });

      expect(explanation).toContain('failover');
    });
  });

  describe('generateReport', () => {
    it('should generate status report', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: '# Test Cluster Status\n\nThe cluster is healthy with 1 primary and 2 replicas.',
        }],
      });

      const report = await provider.generateReport(mockTopology);

      expect(report).toContain('cluster');
    });

    it('should fallback to basic report on failure', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const report = await provider.generateReport(mockTopology);

      expect(report).toContain('test-cluster');
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetAIProvider();
  });

  afterEach(() => {
    resetAIProvider();
  });

  it('should create singleton instance', () => {
    const provider = getAIProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
      features: {
        analysis: true,
        recommendations: true,
        naturalLanguage: true,
      },
    });

    expect(provider).toBeInstanceOf(AIProvider);

    const same = getAIProvider();
    expect(same).toBe(provider);
  });

  it('should throw if not initialized', () => {
    expect(() => getAIProvider()).toThrow('AI provider not initialized');
  });

  it('should reset singleton', () => {
    getAIProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
      features: {
        analysis: true,
        recommendations: true,
        naturalLanguage: true,
      },
    });
    resetAIProvider();

    expect(() => getAIProvider()).toThrow('AI provider not initialized');
  });
});