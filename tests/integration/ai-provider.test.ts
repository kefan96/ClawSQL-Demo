/**
 * Integration Tests for AI Provider with baseURL
 *
 * Tests the full flow of AI provider configuration and initialization
 * with custom base URLs (DashScope, Azure, etc.)
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider, resetAIProvider } from '../../src/providers/ai.js';
import { AIConfigSchema } from '../../src/types/config.js';

// Skip integration tests unless explicitly enabled
const shouldRunIntegrationTests =
  process.env.RUN_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

// Mock the SDK clients to avoid actual API calls
const mockAnthropicConstructor = vi.fn();
const mockOpenAIConstructor = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((config) => {
    mockAnthropicConstructor(config);
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              healthy: true,
              riskLevel: 'low',
              recommendations: ['Test recommendation'],
              concerns: [],
            }),
          }],
        }),
      },
    };
  }),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((config) => {
    mockOpenAIConstructor(config);
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  healthy: true,
                  riskLevel: 'low',
                  recommendations: ['Test recommendation'],
                }),
              },
            }],
          }),
        },
      },
    };
  }),
}));

describeIntegration('AI Provider Integration - baseURL', () => {
  beforeEach(() => {
    resetAIProvider();
    vi.clearAllMocks();
    mockAnthropicConstructor.mockClear();
    mockOpenAIConstructor.mockClear();
  });

  afterEach(() => {
    resetAIProvider();
    vi.clearAllMocks();
  });

  describe('Config validation with baseURL', () => {
    it('should validate and parse AI config with baseURL', () => {
      const config = {
        provider: 'anthropic' as const,
        apiKey: 'sk-test-key',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        model: 'claude-sonnet-4-6',
        features: {
          analysis: true,
          recommendations: true,
          naturalLanguage: true,
        },
      };

      const result = AIConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.baseURL).toBe('https://dashscope.aliyuncs.com/apps/anthropic');
      }
    });

    it('should reject invalid baseURL in config', () => {
      const config = {
        baseURL: 'not-a-valid-url',
      };

      const result = AIConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });
  });

  describe('AIProvider initialization with baseURL', () => {
    it('should initialize Anthropic client with DashScope baseURL', () => {
      resetAIProvider();

      new AIProvider({
        provider: 'anthropic',
        apiKey: 'sk-dashscope-key',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        model: 'claude-3-sonnet-20240229',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(mockAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-dashscope-key',
          baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        })
      );
    });

    it('should initialize OpenAI client with DashScope baseURL', () => {
      resetAIProvider();

      new AIProvider({
        provider: 'openai',
        apiKey: 'sk-dashscope-key',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-turbo',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(mockOpenAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-dashscope-key',
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        })
      );
    });

    it('should initialize without baseURL (default endpoint)', () => {
      resetAIProvider();

      new AIProvider({
        provider: 'anthropic',
        apiKey: 'sk-test-key',
        model: 'claude-sonnet-4-6',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(mockAnthropicConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-test-key',
        })
      );

      // baseURL should be undefined
      const callArgs = mockAnthropicConstructor.mock.calls[0][0];
      expect(callArgs.baseURL).toBeUndefined();
    });
  });

  describe('Multiple provider switching', () => {
    it('should reinitialize with different provider and baseURL', () => {
      // First with Anthropic
      resetAIProvider();
      new AIProvider({
        provider: 'anthropic',
        apiKey: 'sk-anthropic-key',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        model: 'claude-3-sonnet-20240229',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(mockAnthropicConstructor).toHaveBeenCalledTimes(1);

      // Then with OpenAI
      resetAIProvider();
      new AIProvider({
        provider: 'openai',
        apiKey: 'sk-openai-key',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-turbo',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1);
    });
  });

  describe('Topology analysis with custom baseURL', () => {
    it('should analyze topology using DashScope endpoint', async () => {
      resetAIProvider();

      const provider = new AIProvider({
        provider: 'anthropic',
        apiKey: 'sk-dashscope-key',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        model: 'claude-3-sonnet-20240229',
        features: { analysis: true, recommendations: true, naturalLanguage: true },
      });

      const topology = {
        clusterName: 'test-cluster',
        primary: {
          host: 'mysql-primary',
          port: 3306,
          serverId: 1,
          version: '8.0',
          readOnly: false,
          isPrimary: true,
          isReplica: false,
          lastSeen: new Date(),
        },
        replicas: [],
        problems: [],
        lastUpdated: new Date(),
      };

      const analysis = await provider.analyzeTopology(topology as any);

      expect(analysis).toBeDefined();
      expect(analysis.healthy).toBe(true);
    });
  });
});

describeIntegration('Environment Variable Integration', () => {
  beforeEach(() => {
    resetAIProvider();
    vi.clearAllMocks();
    // Clean up environment
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  it('should use ANTHROPIC_BASE_URL from environment', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';
    process.env.ANTHROPIC_BASE_URL = 'https://env.endpoint';

    resetAIProvider();

    new AIProvider({
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
      model: 'claude-sonnet-4-6',
      features: { analysis: true, recommendations: true, naturalLanguage: true },
    });

    expect(mockAnthropicConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-env-key',
        baseURL: 'https://env.endpoint',
      })
    );
  });

  it('should use OPENAI_BASE_URL from environment', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-env-key';
    process.env.OPENAI_BASE_URL = 'https://openai-env.endpoint';

    resetAIProvider();

    new AIProvider({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: 'gpt-4',
      features: { analysis: true, recommendations: true, naturalLanguage: true },
    });

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-openai-env-key',
        baseURL: 'https://openai-env.endpoint',
      })
    );
  });
});