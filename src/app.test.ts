// ABOUTME: Unit tests for src/app.ts
// ABOUTME: Tests the core application setup, provider creation, and session handling logic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from '~/app';
import { CLIOptions } from '~/cli/args';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { getEnvVar } from '~/config/env-loader';
import { enableTrafficLogging } from '~/utils/traffic-logger';
import { logger } from '~/utils/logger';
import { NonInteractiveInterface } from '~/interfaces/non-interactive-interface';
// Don't import TerminalInterface at top level - it loads React/Ink
import { createGlobalPolicyCallback } from '~/tools/policy-wrapper';
import { OllamaProvider } from '~/providers/ollama-provider';
import { withConsoleCapture } from '~/__tests__/setup/console-capture';
import { resetPersistence } from '~/persistence/database';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';

// Mock external dependencies at the module level
vi.mock('~/agents/agent');
vi.mock('~/threads/thread-manager');
vi.mock('~/tools/executor');
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
vi.mock('~/interfaces/terminal/terminal-interface', () => ({
  TerminalInterface: vi.fn(() => ({
    startInteractive: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn(),
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

    vi.mocked(ThreadManager.prototype.resumeOrCreate).mockResolvedValue({
      threadId: 'new-thread-123',
      isResumed: false,
      resumeError: undefined,
    });
    vi.mocked(ThreadManager.prototype.generateThreadId).mockReturnValue('temp-thread-456');
    vi.mocked(ThreadManager.prototype.createThread).mockReturnValue('temp-thread-456');

    // Mock ToolExecutor methods
    vi.mocked(ToolExecutor.prototype.registerAllAvailableTools).mockReturnValue(undefined);
    vi.mocked(ToolExecutor.prototype.getAllTools).mockReturnValue([]);
    vi.mocked(ToolExecutor.prototype.getTool).mockReturnValue(undefined);
    vi.mocked(ToolExecutor.prototype.setApprovalCallback).mockReturnValue(undefined); // Add this mock

    // Mock Agent constructor and its methods
    vi.mocked(Agent).mockImplementation(() => {
      const mockAgentInstance = {
        start: vi.fn(),
        toolExecutor: vi.mocked(new ToolExecutor()),
        // Add all required Agent properties/methods
        _provider: {},
        _toolExecutor: {},
        _threadManager: {},
        _threadId: 'test-thread',
        sendMessage: vi.fn(),
        abort: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        removeAllListeners: vi.fn(),
        setMaxListeners: vi.fn(),
        getMaxListeners: vi.fn(),
        listeners: vi.fn(),
        rawListeners: vi.fn(),
        listenerCount: vi.fn(),
        prependListener: vi.fn(),
        prependOnceListener: vi.fn(),
        eventNames: vi.fn(),
        once: vi.fn(),
        // Agent API methods
        resumeOrCreateThread: vi.fn().mockReturnValue({
          threadId: 'new-thread-123',
          isResumed: false,
          resumeError: undefined,
        }),
        getLatestThreadId: vi.fn().mockResolvedValue('latest-thread-123'),
        getCurrentThreadId: vi.fn().mockReturnValue('current-thread-123'),
        generateThreadId: vi.fn().mockReturnValue('generated-thread-123'),
        createThread: vi.fn(),
        compact: vi.fn(),
        getThreadEvents: vi.fn().mockReturnValue([]),
      };
      // Mock the prototype methods that are accessed
      Object.setPrototypeOf(mockAgentInstance, Agent.prototype);
      return mockAgentInstance as unknown as Agent;
    });

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
    const options = { ...mockCliOptions, provider: 'anthropic' };
    await expect(run(options)).rejects.toThrow(
      'ANTHROPIC_KEY environment variable required for Anthropic provider'
    );
  });

  it('should exit if OpenAI API key is missing', async () => {
    vi.mocked(getEnvVar).mockImplementation((key: string) => {
      if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return undefined;
      return undefined;
    });
    const options = { ...mockCliOptions, provider: 'openai' };
    await expect(run(options)).rejects.toThrow(
      'OPENAI_API_KEY or OPENAI_KEY environment variable required for OpenAI provider'
    );
  });

  it('should throw error for unknown provider', async () => {
    const options = { ...mockCliOptions, provider: 'unknown-provider' };
    await expect(run(options)).rejects.toThrow(
      'Unknown provider: unknown-provider. Available providers: '
    );
  });

  it('should initialize ThreadManager and handle new session', async () => {
    const { log } = withConsoleCapture();
    await run(mockCliOptions);
    expect(ThreadManager).toHaveBeenCalledWith();
    // Session handling now goes through Agent.resumeOrCreateThread
    expect(log).toHaveBeenCalledWith('🆕 Starting conversation new-thread-123');
  });

  it('should initialize ThreadManager and handle resumed session', async () => {
    const options = { ...mockCliOptions, continue: true };
    await run(options);
    // The main goal is that the app runs successfully with continue mode
    expect(ThreadManager).toHaveBeenCalled();
    expect(Agent).toHaveBeenCalled();
  });

  it('should initialize ThreadManager and handle resumed session with ID', async () => {
    const { log } = withConsoleCapture();
    // Update the base Agent mock to return resumed session
    vi.mocked(Agent).mockImplementation(() => {
      const mockAgentInstance = {
        start: vi.fn(),
        toolExecutor: vi.mocked(new ToolExecutor()),
        // Add all required Agent properties/methods
        _provider: {},
        _toolExecutor: {},
        _threadManager: {},
        _threadId: 'test-thread',
        sendMessage: vi.fn(),
        abort: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        removeAllListeners: vi.fn(),
        setMaxListeners: vi.fn(),
        getMaxListeners: vi.fn(),
        listeners: vi.fn(),
        rawListeners: vi.fn(),
        listenerCount: vi.fn(),
        prependListener: vi.fn(),
        prependOnceListener: vi.fn(),
        eventNames: vi.fn(),
        once: vi.fn(),
        // Agent API methods - override for this test
        resumeOrCreateThread: vi.fn().mockReturnValue({
          threadId: 'specific-thread-789',
          isResumed: true,
          resumeError: undefined,
        }),
        getLatestThreadId: vi.fn().mockResolvedValue('latest-thread-123'),
        getCurrentThreadId: vi.fn().mockReturnValue('current-thread-123'),
        generateThreadId: vi.fn().mockReturnValue('generated-thread-123'),
        createThread: vi.fn(),
        compact: vi.fn(),
        getThreadEvents: vi.fn().mockReturnValue([]),
      };
      Object.setPrototypeOf(mockAgentInstance, Agent.prototype);
      return mockAgentInstance as unknown as Agent;
    });

    const options = { ...mockCliOptions, continue: 'specific-thread-789' };
    await run(options);
    // Session handling now goes through Agent.resumeOrCreateThread
    expect(log).toHaveBeenCalledWith('📖 Continuing conversation specific-thread-789');
  });

  it('should initialize ThreadManager and handle resume error', async () => {
    const { log } = withConsoleCapture();

    // Mock Agent constructor to return an instance with resume error
    vi.mocked(Agent).mockImplementation(() => {
      const mockAgentInstance = {
        start: vi.fn(),
        toolExecutor: vi.mocked(new ToolExecutor()),
        // Add all required Agent properties/methods
        _provider: {},
        _toolExecutor: {},
        _threadManager: {},
        _threadId: 'test-thread',
        sendMessage: vi.fn(),
        abort: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        removeAllListeners: vi.fn(),
        setMaxListeners: vi.fn(),
        getMaxListeners: vi.fn(),
        listeners: vi.fn(),
        rawListeners: vi.fn(),
        listenerCount: vi.fn(),
        prependListener: vi.fn(),
        prependOnceListener: vi.fn(),
        eventNames: vi.fn(),
        once: vi.fn(),
        // Agent API methods - with resume error
        resumeOrCreateThread: vi.fn().mockReturnValue({
          threadId: 'new-thread-123',
          isResumed: false,
          resumeError: 'Mock resume error',
        }),
        getLatestThreadId: vi.fn().mockResolvedValue('latest-thread-123'),
        getCurrentThreadId: vi.fn().mockReturnValue('current-thread-123'),
        generateThreadId: vi.fn().mockReturnValue('generated-thread-123'),
        createThread: vi.fn(),
        stop: vi.fn(),
        replaySessionEvents: vi.fn(),
        providerName: 'mock-provider',
        state: 'idle',
        threadId: 'test-thread',
      };
      return mockAgentInstance as unknown as Agent;
    });

    await run(mockCliOptions);
    expect(log).toHaveBeenCalledWith('🆕 Starting new conversation new-thread-123');
  });

  it('should set up ToolExecutor and Agent', async () => {
    await run(mockCliOptions);
    expect(ToolExecutor).toHaveBeenCalledTimes(2); // Once for setupAgent, once for agent.toolExecutor
    expect(vi.mocked(ToolExecutor.prototype.registerAllAvailableTools)).toHaveBeenCalledTimes(1);
    expect(Agent).toHaveBeenCalledTimes(1);
    // Just verify the Agent constructor gets called with the right structure
    const agentCallArgs = vi.mocked(Agent).mock.calls[0][0] as unknown as {
      provider: object;
      toolExecutor: object;
      threadManager: object;
      threadId: string;
      tools: unknown[];
    };
    expect(agentCallArgs).toMatchObject({
      provider: expect.any(Object) as unknown,
      toolExecutor: expect.any(Object) as unknown,
      threadManager: expect.any(Object) as unknown,
      threadId: expect.any(String) as unknown,
      tools: expect.any(Array) as unknown,
    });
  });

  it('should set delegate tool dependencies if delegate tool exists', async () => {
    const mockDelegateTool = {
      name: 'delegate',
      description: 'Mock delegate tool',
      schema: {},
      inputSchema: {},
      execute: vi.fn(),
      executeValidated: vi.fn(),
      createResult: vi.fn(),
      createErrorResult: vi.fn(),
      createError: vi.fn(),
      _makeResult: vi.fn(),
      formatValidationError: vi.fn(),
      setDependencies: vi.fn(),
    };
    vi.mocked(ToolExecutor.prototype.getTool).mockReturnValue(mockDelegateTool as unknown as Tool);
    await run(mockCliOptions);
    expect(mockDelegateTool.setDependencies).toHaveBeenCalledWith(
      expect.any(Agent),
      expect.any(ToolExecutor)
    );
  });

  it('should execute prompt in non-interactive mode and exit', async () => {
    const options = { ...mockCliOptions, prompt: 'test prompt' };
    await run(options);
    expect(NonInteractiveInterface).toHaveBeenCalledWith(expect.any(Agent));
    const mockNonInteractive = vi.mocked(NonInteractiveInterface).mock.results[0]?.value as {
      executePrompt: ReturnType<typeof vi.fn>;
    };
    expect(mockNonInteractive.executePrompt).toHaveBeenCalledWith('test prompt');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should start interactive mode if no prompt is given', async () => {
    const { TerminalInterface } = await import('~/interfaces/terminal/terminal-interface');
    await run(mockCliOptions);
    expect(TerminalInterface).toHaveBeenCalledWith(expect.any(Agent));
    const mockInstance = vi.mocked(TerminalInterface).mock.results[0]?.value as {
      startInteractive: ReturnType<typeof vi.fn>;
    };
    expect(mockInstance.startInteractive).toHaveBeenCalledTimes(1);
  });

  it('should set global policy callback on tool executor', async () => {
    const mockPolicyCallback = { requestApproval: vi.fn() };
    vi.mocked(createGlobalPolicyCallback).mockReturnValue(mockPolicyCallback);
    await run(mockCliOptions);
    expect(vi.mocked(createGlobalPolicyCallback)).toHaveBeenCalledWith(
      expect.any(Object), // Mocked TerminalInterface instance
      mockCliOptions,
      expect.any(ToolExecutor) // Agent's toolExecutor
    );
    const agentInstance = vi.mocked(Agent).mock.results[0].value as Agent;
    expect(agentInstance.toolExecutor.setApprovalCallback).toHaveBeenCalledWith(mockPolicyCallback);
  });
});
