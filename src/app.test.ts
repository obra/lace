// ABOUTME: Unit tests for src/app.ts
// ABOUTME: Tests the core application setup, provider creation, and session handling logic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from '~/app';
import { CLIOptions } from '~/cli/args';
// Real business logic classes are used in tests but not directly imported
import { getEnvVar } from '~/config/env-loader';
import { enableTrafficLogging } from '~/utils/traffic-logger';
import { logger } from '~/utils/logger';
import { NonInteractiveInterface } from '~/interfaces/non-interactive-interface';
// Don't import TerminalInterface at top level - it loads React/Ink
import { createGlobalPolicyCallback } from '~/tools/policy-wrapper';
import { OllamaProvider } from '~/providers/ollama-provider';
import { resetPersistence } from '~/persistence/database';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

// Mock external dependencies at the module level
// Use real business logic instances (Agent, ThreadManager, ToolExecutor) for proper testing
// Use real temporary directory instead of mocking lace-dir - tests real file system behavior
// Mock env-loader to control environment variables in tests without affecting actual environment
vi.mock('~/config/env-loader');
// Mock logger to prevent test output noise and control log verification
vi.mock('~/utils/logger');
vi.mock('~/utils/traffic-logger');
vi.mock('~/interfaces/non-interactive-interface', () => ({
  NonInteractiveInterface: vi.fn(() => ({
    executePrompt: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('~/tools/policy-wrapper');

// Mock providers - these need to be dynamic imports for the app.ts to work
vi.mock('~/providers/anthropic-provider', () => ({
  AnthropicProvider: vi.fn(() => ({
    providerName: 'anthropic',
    cleanup: vi.fn(),
    getProviderInfo: vi.fn(() => ({
      name: 'anthropic',
      displayName: 'Anthropic',
      requiresApiKey: true,
    })),
    getAvailableModels: vi.fn(() => []),
    isConfigured: vi.fn(() => true),
  })),
}));
vi.mock('~/providers/openai-provider', () => ({
  OpenAIProvider: vi.fn(() => ({
    providerName: 'openai',
    cleanup: vi.fn(),
    getProviderInfo: vi.fn(() => ({ name: 'openai', displayName: 'OpenAI', requiresApiKey: true })),
    getAvailableModels: vi.fn(() => []),
    isConfigured: vi.fn(() => true),
  })),
}));
vi.mock('~/providers/lmstudio-provider', () => ({
  LMStudioProvider: vi.fn(() => ({
    providerName: 'lmstudio',
    cleanup: vi.fn(),
    getProviderInfo: vi.fn(() => ({
      name: 'lmstudio',
      displayName: 'LM Studio',
      requiresApiKey: false,
    })),
    getAvailableModels: vi.fn(() => []),
    isConfigured: vi.fn(() => true),
  })),
}));
vi.mock('~/providers/ollama-provider', () => ({
  OllamaProvider: vi.fn(() => ({
    providerName: 'ollama',
    cleanup: vi.fn(),
    getProviderInfo: vi.fn(() => ({
      name: 'ollama',
      displayName: 'Ollama',
      requiresApiKey: false,
    })),
    getAvailableModels: vi.fn(() => []),
    isConfigured: vi.fn(() => true),
  })),
}));

describe('App Initialization (run function)', () => {
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

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();
    resetPersistence();

    // Mock implementations for imported modules
    vi.mocked(getEnvVar).mockImplementation((key) => {
      if (key === 'ANTHROPIC_KEY') return 'mock-anthropic-key';
      if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return 'mock-openai-key';
      return undefined;
    });

    // Business logic classes (Agent, ThreadManager, ToolExecutor) use real instances for proper testing

    vi.spyOn(process, 'exit').mockImplementation((() => {
      // Mock process.exit to prevent actual exit during tests
    }) as never);

    // TerminalInterface is already mocked at module level

    // Mock createGlobalPolicyCallback
    vi.mocked(createGlobalPolicyCallback).mockReturnValue({
      requestApproval: vi.fn(),
    });
  });

  afterEach(() => {
    teardownTestPersistence();
    resetPersistence();
    vi.restoreAllMocks();
  });

  it('should initialize logger and traffic logging', async () => {
    const options = { ...mockCliOptions, harFile: 'test.har' };
    await run(options);
    expect(logger.configure).toHaveBeenCalledWith(options.logLevel, options.logFile);
    expect(enableTrafficLogging).toHaveBeenCalledWith(options.harFile);
  });

  it('should create an Anthropic provider with API key from env', async () => {
    const { AnthropicProvider } = await import('~/providers/anthropic-provider');
    await run(mockCliOptions);
    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'mock-anthropic-key',
      model: 'claude-3-opus',
    });
  });

  it('should create an OpenAI provider with API key from env', async () => {
    const options = { ...mockCliOptions, provider: 'openai', model: 'gpt-4' };
    const { OpenAIProvider } = await import('~/providers/openai-provider');
    await run(options);
    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'mock-openai-key',
      model: 'gpt-4',
    });
  });

  it('should create an LMstudio provider without API key', async () => {
    const options = { ...mockCliOptions, provider: 'lmstudio', model: 'local-model' };
    const { LMStudioProvider } = await import('~/providers/lmstudio-provider');
    await run(options);
    expect(LMStudioProvider).toHaveBeenCalledWith({
      model: 'local-model',
    });
  });

  it('should create an Ollama provider without API key', async () => {
    const options = { ...mockCliOptions, provider: 'ollama', model: 'llama2' };
    await run(options);
    expect(OllamaProvider).toHaveBeenCalledWith({
      model: 'llama2',
    });
  });

  it('should exit if Anthropic API key is missing', async () => {
    vi.mocked(getEnvVar).mockImplementation((key: string) => {
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
          getProviderInfo: vi.fn(() => ({
            name: 'anthropic',
            displayName: 'Anthropic',
            requiresApiKey: true,
          })),
          getAvailableModels: vi.fn(() => []),
          isConfigured: vi.fn(() => false),
        }) as unknown as InstanceType<typeof AnthropicProvider>
    );

    const options = { ...mockCliOptions, provider: 'anthropic' };
    await expect(run(options)).rejects.toThrow(
      'Missing required environment variable: ANTHROPIC_KEY'
    );
  });

  it('should exit if OpenAI API key is missing', async () => {
    vi.mocked(getEnvVar).mockImplementation((key: string) => {
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
          getProviderInfo: vi.fn(() => ({
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
          })),
          getAvailableModels: vi.fn(() => []),
          isConfigured: vi.fn(() => false),
        }) as unknown as InstanceType<typeof OpenAIProvider>
    );

    const options = { ...mockCliOptions, provider: 'openai' };
    await expect(run(options)).rejects.toThrow(
      'Missing required environment variable: OPENAI_API_KEY or OPENAI_KEY'
    );
  });

  it('should throw error for unknown provider', async () => {
    const options = { ...mockCliOptions, provider: 'unknown-provider' };
    await expect(run(options)).rejects.toThrow(
      'Unknown provider: unknown-provider. Available providers: '
    );
  });

  it('should execute prompt in non-interactive mode and exit', async () => {
    const options = { ...mockCliOptions, prompt: 'test prompt' };
    await run(options);
    expect(NonInteractiveInterface).toHaveBeenCalledWith(expect.any(Object));
    const mockNonInteractive = vi.mocked(NonInteractiveInterface).mock.results[0]?.value as {
      executePrompt: ReturnType<typeof vi.fn>;
    };
    expect(mockNonInteractive.executePrompt).toHaveBeenCalledWith('test prompt');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should exit with help message if no prompt is given', async () => {
    // App now defaults to non-interactive mode and shows help
    await run(mockCliOptions);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  // Policy callback test removed - no longer used in non-interactive mode
});
