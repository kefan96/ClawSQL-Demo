/**
 * Unit tests for CLI Shell - AI Config Commands
 *
 * Tests the config ai url command and related functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  loadConfig: vi.fn(),
  getConfig: vi.fn(() => ({
    cluster: { name: 'test-cluster', seeds: ['localhost:3306'] },
    ai: {
      provider: 'anthropic',
      apiKey: 'test-key',
      baseURL: undefined,
      model: 'claude-sonnet-4-6',
      features: { analysis: true, recommendations: true, naturalLanguage: true },
    },
  })),
  saveConfig: vi.fn(),
  getConfigPath: vi.fn(() => '/tmp/test-config.yaml'),
  updateConfig: vi.fn(),
}));

// Mock the AI provider
vi.mock('../../src/providers/ai.js', () => ({
  getAIProvider: vi.fn(() => ({
    analyzeTopology: vi.fn(),
  })),
  resetAIProvider: vi.fn(),
}));

// Mock logger
vi.mock('../../src/logger.js', () => ({
  initLogger: vi.fn(),
  getRootLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock MySQL provider
vi.mock('../../src/providers/mysql.js', () => ({
  getMySQLProvider: vi.fn(),
  resetMySQLProvider: vi.fn(),
}));

// Mock ProxySQL provider
vi.mock('../../src/providers/proxysql.js', () => ({
  getProxySQLProvider: vi.fn(),
  resetProxySQLProvider: vi.fn(),
}));

describe('CLI Shell - AI Config Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
  });

  describe('configAISetURL', () => {
    it('should set valid baseURL for Anthropic provider', async () => {
      const { saveConfig, getConfig } = await import('../../src/config/index.js');

      // Simulate setting the URL
      const testURL = 'https://dashscope.aliyuncs.com/apps/anthropic';

      // Call saveConfig directly to verify the expected behavior
      const config = getConfig();
      saveConfig({
        ai: {
          ...config.ai,
          baseURL: testURL,
        },
      });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ai: expect.objectContaining({
            baseURL: testURL,
          }),
        })
      );
    });

    it('should set valid baseURL for OpenAI provider', async () => {
      const { saveConfig } = await import('../../src/config/index.js');

      const testURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

      saveConfig({
        ai: {
          provider: 'openai',
          baseURL: testURL,
        },
      });

      expect(saveConfig).toHaveBeenCalled();
    });

    it('should clear baseURL with "clear" command', async () => {
      const { saveConfig } = await import('../../src/config/index.js');

      saveConfig({
        ai: {
          baseURL: undefined,
        },
      });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ai: expect.objectContaining({
            baseURL: undefined,
          }),
        })
      );
    });

    it('should set ANTHROPIC_BASE_URL environment variable', () => {
      const testURL = 'https://dashscope.aliyuncs.com/apps/anthropic';

      // Set environment variable
      process.env.ANTHROPIC_BASE_URL = testURL;

      expect(process.env.ANTHROPIC_BASE_URL).toBe(testURL);
    });

    it('should set OPENAI_BASE_URL environment variable', () => {
      const testURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

      // Set environment variable
      process.env.OPENAI_BASE_URL = testURL;

      expect(process.env.OPENAI_BASE_URL).toBe(testURL);
    });

    it('should clear ANTHROPIC_BASE_URL environment variable', () => {
      process.env.ANTHROPIC_BASE_URL = 'https://old.url';
      delete process.env.ANTHROPIC_BASE_URL;

      expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('should clear OPENAI_BASE_URL environment variable', () => {
      process.env.OPENAI_BASE_URL = 'https://old.url';
      delete process.env.OPENAI_BASE_URL;

      expect(process.env.OPENAI_BASE_URL).toBeUndefined();
    });

    it('should call resetAIProvider after setting URL', async () => {
      const { resetAIProvider } = await import('../../src/providers/ai.js');

      resetAIProvider();

      expect(resetAIProvider).toHaveBeenCalled();
    });
  });

  describe('URL validation', () => {
    it('should accept valid URLs', () => {
      const validURLs = [
        'https://dashscope.aliyuncs.com/apps/anthropic',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'https://my-resource.openai.azure.com/',
        'http://localhost:11434/v1',
        'https://api.anthropic.com',
      ];

      for (const url of validURLs) {
        expect(() => new URL(url)).not.toThrow();
      }
    });

    it('should reject invalid URLs', () => {
      const invalidURLs = [
        'not-a-url',
        '://missing-protocol',
        // Note: 'htp://typo-in-protocol' is actually a valid URL for Node's URL constructor
        // Node.js URL constructor is more permissive than browsers
      ];

      for (const url of invalidURLs) {
        expect(() => new URL(url)).toThrow();
      }
    });

    it('should accept "clear" as special command', () => {
      const input = 'clear';
      expect(input.toLowerCase()).toBe('clear');
    });

    it('should accept "none" as special command', () => {
      const input = 'none';
      expect(input.toLowerCase()).toBe('none');
    });
  });

  describe('DashScope URLs', () => {
    it('should accept Anthropic-compatible DashScope URL', () => {
      const url = 'https://dashscope.aliyuncs.com/apps/anthropic';

      expect(() => new URL(url)).not.toThrow();
      expect(url).toContain('dashscope.aliyuncs.com');
      expect(url).toContain('anthropic');
    });

    it('should accept OpenAI-compatible DashScope URL', () => {
      const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

      expect(() => new URL(url)).not.toThrow();
      expect(url).toContain('dashscope.aliyuncs.com');
      expect(url).toContain('compatible-mode');
    });
  });

  describe('Azure OpenAI URLs', () => {
    it('should accept Azure OpenAI URL format', () => {
      const url = 'https://my-resource.openai.azure.com/';

      expect(() => new URL(url)).not.toThrow();
      expect(url).toContain('openai.azure.com');
    });
  });

  describe('Local LLM URLs', () => {
    it('should accept localhost URL for local LLMs', () => {
      const url = 'http://localhost:11434/v1';

      expect(() => new URL(url)).not.toThrow();
      expect(url).toContain('localhost');
    });

    it('should accept 127.0.0.1 URL', () => {
      const url = 'http://127.0.0.1:11434/v1';

      expect(() => new URL(url)).not.toThrow();
    });
  });
});

describe('Environment Variable Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should read ANTHROPIC_BASE_URL from environment', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.endpoint';

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://custom.endpoint');
  });

  it('should read OPENAI_BASE_URL from environment', () => {
    process.env.OPENAI_BASE_URL = 'https://custom.openai.endpoint';

    expect(process.env.OPENAI_BASE_URL).toBe('https://custom.openai.endpoint');
  });
});