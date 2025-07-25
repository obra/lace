// ABOUTME: Unit tests for CLI flow and argument processing without network dependencies
// ABOUTME: Tests provider creation, session management, and application orchestration using mocks

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from '~/app';
import { CLIOptions } from '~/cli/args';
// Real Agent class is used in tests but not directly imported
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

// Console capture for suppressing CLI output during tests
let originalConsole: {
  log: typeof console.log;
  error: typeof console.error;
  warn: typeof console.warn;
};

// Mock external dependencies only - use real business logic instances
// Agent, ThreadManager, ToolExecutor use real instances for proper behavior testing
// Use real temporary directory instead of mocking lace-dir - tests real file system behavior
// Mock env-loader to control environment variables in tests without affecting actual environment
vi.mock('~/config/env-loader');
// Mock logger to prevent test output noise and control log verification
vi.mock('~/utils/logger');
vi.mock('~/utils/traffic-logger');
vi.mock('~/interfaces/non-interactive-interface');
// Terminal interface removed - no longer needed
vi.mock('~/tools/policy-wrapper');

// Mock providers with realistic behavior
vi.mock('~/providers/anthropic-provider', () => ({
  AnthropicProvider: vi.fn(() => ({
    providerName: 'anthropic',
    cleanup: vi.fn(),
    isConfigured: vi.fn(() => true),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from Anthropic',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

vi.mock('~/providers/openai-provider', () => ({
  OpenAIProvider: vi.fn(() => ({
    providerName: 'openai',
    cleanup: vi.fn(),
    isConfigured: vi.fn(() => true),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from OpenAI',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

vi.mock('~/providers/lmstudio-provider', () => ({
  LMStudioProvider: vi.fn(() => ({
    providerName: 'lmstudio',
    cleanup: vi.fn(),
    isConfigured: vi.fn(() => true),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from LMStudio',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

vi.mock('~/providers/ollama-provider', () => ({
  OllamaProvider: vi.fn(() => ({
    providerName: 'ollama',
    cleanup: vi.fn(),
    isConfigured: vi.fn(() => true),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from Ollama',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

describe('CLI Flow Tests', () => {
  const _tempLaceDir = useTempLaceDir();
  const mockCliOptions: CLIOptions = {
    provider: 'anthropic',
    model: 'claude-3-opus',
    help: false,
    logLevel: 'info',
    logFile: undefined,
    prompt: undefined,
    ui: 'terminal',
    continue: undefined,
    harFile: undefined,
    allowNonDestructiveTools: false,
    autoApproveTools: [],
    disableTools: [],
    disableAllTools: false,
    disableToolGuardrails: false,
    listTools: false,
  };

  beforeEach(async () => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Capture console output to suppress CLI messages during tests
    originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();

    // Setup mocks for external dependencies only
    const { getEnvVar } = vi.mocked(await import('~/config/env-loader'));
    const { logger } = vi.mocked(await import('~/utils/logger'));
    const { enableTrafficLogging } = vi.mocked(await import('~/utils/traffic-logger'));
    const { NonInteractiveInterface } = vi.mocked(
      await import('~/interfaces/non-interactive-interface')
    );
    // TerminalInterface removed - app now defaults to non-interactive
    const { createGlobalPolicyCallback } = vi.mocked(await import('~/tools/policy-wrapper'));

    // Mock environment variables
    getEnvVar.mockImplementation((key) => {
      if (key === 'ANTHROPIC_KEY') return 'mock-anthropic-key';
      if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return 'mock-openai-key';
      return undefined;
    });

    // Business logic classes (ThreadManager, ToolExecutor, Agent) use real instances

    // Mock interfaces
    NonInteractiveInterface.prototype.executePrompt = vi.fn().mockResolvedValue(undefined);
    // TerminalInterface removed - app now defaults to non-interactive

    // Mock logger
    logger.configure = vi.fn();
    logger.info = vi.fn();
    logger.debug = vi.fn();
    logger.error = vi.fn();

    // Mock other utilities
    enableTrafficLogging.mockResolvedValue(undefined);
    createGlobalPolicyCallback.mockReturnValue({
      requestApproval: vi.fn(),
    });

    // Console output is automatically suppressed by global setup
    vi.spyOn(process, 'exit').mockImplementation((() => {
      // Mock implementation - prevent actual process exit during tests
    }) as never);
  });

  afterEach(() => {
    // Restore console
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;

    vi.restoreAllMocks();
    teardownTestPersistence();
  });

  describe('provider initialization', () => {
    it('should initialize Anthropic provider with API key', async () => {
      const { AnthropicProvider } = await import('~/providers/anthropic-provider');

      await run(mockCliOptions);

      expect(AnthropicProvider).toHaveBeenCalledWith({
        apiKey: 'mock-anthropic-key',
        model: 'claude-3-opus',
      });
    });

    it('should initialize OpenAI provider with API key', async () => {
      const { OpenAIProvider } = await import('~/providers/openai-provider');
      const options = { ...mockCliOptions, provider: 'openai', model: 'gpt-4' };

      await run(options);

      expect(OpenAIProvider).toHaveBeenCalledWith({
        apiKey: 'mock-openai-key',
        model: 'gpt-4',
      });
    });

    it('should initialize LMStudio provider without API key', async () => {
      const { LMStudioProvider } = await import('~/providers/lmstudio-provider');
      const options = { ...mockCliOptions, provider: 'lmstudio', model: 'local-model' };

      await run(options);

      expect(LMStudioProvider).toHaveBeenCalledWith({
        model: 'local-model',
      });
    });

    it('should initialize Ollama provider without API key', async () => {
      const { OllamaProvider } = await import('~/providers/ollama-provider');
      const options = { ...mockCliOptions, provider: 'ollama', model: 'llama2' };

      await run(options);

      expect(OllamaProvider).toHaveBeenCalledWith({
        model: 'llama2',
      });
    });

    it('should throw error for missing Anthropic API key', async () => {
      const { getEnvVar } = vi.mocked(await import('~/config/env-loader'));
      getEnvVar.mockImplementation((key) => {
        if (key === 'ANTHROPIC_KEY') return undefined;
        return undefined;
      });

      // Mock provider as not configured
      const { AnthropicProvider } = vi.mocked(await import('~/providers/anthropic-provider'));
      vi.mocked(AnthropicProvider).mockImplementation(
        () =>
          ({
            providerName: 'anthropic',
            cleanup: vi.fn(),
            isConfigured: vi.fn(() => false),
            createResponse: vi.fn().mockResolvedValue({
              content: 'Mock response from Anthropic',
              toolCalls: [],
              stopReason: 'stop',
            }),
          }) as unknown as InstanceType<typeof AnthropicProvider>
      );

      await expect(run(mockCliOptions)).rejects.toThrow(
        'Missing required environment variable: ANTHROPIC_KEY'
      );
    });

    it('should throw error for missing OpenAI API key', async () => {
      const { getEnvVar } = vi.mocked(await import('~/config/env-loader'));
      getEnvVar.mockImplementation((key) => {
        if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return undefined;
        return undefined;
      });

      // Mock provider as not configured
      const { OpenAIProvider } = vi.mocked(await import('~/providers/openai-provider'));
      vi.mocked(OpenAIProvider).mockImplementation(
        () =>
          ({
            providerName: 'openai',
            cleanup: vi.fn(),
            isConfigured: vi.fn(() => false),
            createResponse: vi.fn().mockResolvedValue({
              content: 'Mock response from OpenAI',
              toolCalls: [],
              stopReason: 'stop',
            }),
          }) as unknown as InstanceType<typeof OpenAIProvider>
      );

      const options = { ...mockCliOptions, provider: 'openai' };

      await expect(run(options)).rejects.toThrow(
        'Missing required environment variable: OPENAI_API_KEY or OPENAI_KEY'
      );
    });

    it('should throw error for unknown provider', async () => {
      const options = { ...mockCliOptions, provider: 'unknown-provider' };

      await expect(run(options)).rejects.toThrow('Unknown provider: unknown-provider');
    });
  });

  describe('interface selection', () => {
    it('should use NonInteractiveInterface for prompt execution', async () => {
      const { NonInteractiveInterface } = vi.mocked(
        await import('~/interfaces/non-interactive-interface')
      );
      const options = { ...mockCliOptions, prompt: 'test prompt' };

      await run(options);

      expect(NonInteractiveInterface).toHaveBeenCalledWith(expect.any(Object));
      const executePromptSpy = vi.mocked(NonInteractiveInterface.prototype.executePrompt);
      expect(executePromptSpy).toHaveBeenCalledWith('test prompt');
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should exit with help message in non-interactive mode', async () => {
      // App now defaults to non-interactive mode and shows help
      await run(mockCliOptions);
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('logging and configuration', () => {
    it('should configure logger with provided options', async () => {
      const { logger } = vi.mocked(await import('~/utils/logger'));
      const options = { ...mockCliOptions, logLevel: 'debug' as const, logFile: 'test.log' };

      await run(options);

      const configureSpy = vi.mocked(logger.configure);
      expect(configureSpy).toHaveBeenCalledWith('debug', 'test.log');
    });

    it('should enable traffic logging when harFile specified', async () => {
      const { enableTrafficLogging } = vi.mocked(await import('~/utils/traffic-logger'));
      const options = { ...mockCliOptions, harFile: 'test.har' };

      await run(options);

      expect(enableTrafficLogging).toHaveBeenCalledWith('test.har');
    });

    it('should exit with help message in non-interactive mode by default', async () => {
      // App now defaults to non-interactive mode and shows help
      await run(mockCliOptions);
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });
});
