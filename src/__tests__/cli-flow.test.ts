// ABOUTME: Unit tests for CLI flow and argument processing without network dependencies
// ABOUTME: Tests provider creation, session management, and application orchestration using mocks

/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withConsoleCapture } from '~/__tests__/setup/console-capture.js';
import { run } from '~/app.js';
import { CLIOptions } from '~/cli/args.js';
import { Agent } from '~/agents/agent.js';

// Mock all external dependencies
vi.mock('../agents/agent.js');
vi.mock('../threads/thread-manager.js');
vi.mock('../tools/executor.js');
vi.mock('../config/lace-dir.js', () => ({
  getLaceDbPath: vi.fn(() => '/mock/db/path'),
}));
vi.mock('../config/env-loader.js');
vi.mock('../utils/logger.js');
vi.mock('../utils/traffic-logger.js');
vi.mock('../interfaces/non-interactive-interface.js');
vi.mock('../interfaces/terminal/terminal-interface.js');
vi.mock('../tools/policy-wrapper.js');

// Mock providers with realistic behavior
vi.mock('../providers/anthropic-provider.js', () => ({
  AnthropicProvider: vi.fn(() => ({
    providerName: 'anthropic',
    cleanup: vi.fn(),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from Anthropic',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

vi.mock('../providers/openai-provider.js', () => ({
  OpenAIProvider: vi.fn(() => ({
    providerName: 'openai',
    cleanup: vi.fn(),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from OpenAI',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

vi.mock('../providers/lmstudio-provider.js', () => ({
  LMStudioProvider: vi.fn(() => ({
    providerName: 'lmstudio',
    cleanup: vi.fn(),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from LMStudio',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

vi.mock('../providers/ollama-provider.js', () => ({
  OllamaProvider: vi.fn(() => ({
    providerName: 'ollama',
    cleanup: vi.fn(),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Mock response from Ollama',
      toolCalls: [],
      stopReason: 'stop',
    }),
  })),
}));

describe('CLI Flow Tests', () => {
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
    vi.clearAllMocks();

    // Setup common mocks
    const { getEnvVar } = vi.mocked(await import('../config/env-loader.js'));
    const { ThreadManager } = vi.mocked(await import('../threads/thread-manager.js'));
    const { ToolExecutor } = vi.mocked(await import('../tools/executor.js'));
    const { Agent } = vi.mocked(await import('../agents/agent.js'));
    const { logger } = vi.mocked(await import('../utils/logger.js'));
    const { enableTrafficLogging } = vi.mocked(await import('../utils/traffic-logger.js'));
    const { NonInteractiveInterface } = vi.mocked(
      await import('../interfaces/non-interactive-interface.js')
    );
    const { TerminalInterface } = vi.mocked(
      await import('../interfaces/terminal/terminal-interface.js')
    );
    const { createGlobalPolicyCallback } = vi.mocked(await import('../tools/policy-wrapper.js'));

    // Mock environment variables
    getEnvVar.mockImplementation((key) => {
      if (key === 'ANTHROPIC_KEY') return 'mock-anthropic-key';
      if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return 'mock-openai-key';
      return undefined;
    });

    // Mock ThreadManager
    ThreadManager.prototype.resumeOrCreate = vi.fn().mockResolvedValue({
      threadId: 'test-thread-123',
      isResumed: false,
      resumeError: undefined,
    });
    ThreadManager.prototype.generateThreadId = vi.fn().mockReturnValue('temp-thread-456');
    ThreadManager.prototype.createThread = vi.fn().mockReturnValue({
      id: 'temp-thread-456',
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    });

    // Mock ToolExecutor
    ToolExecutor.prototype.registerAllAvailableTools = vi.fn();
    ToolExecutor.prototype.getAllTools = vi.fn().mockReturnValue([]);
    ToolExecutor.prototype.getTool = vi.fn().mockReturnValue(undefined);
    ToolExecutor.prototype.setApprovalCallback = vi.fn();

    // Mock Agent
    const mockAgentInstance = {
      start: vi.fn(),
      toolExecutor: vi.mocked(new ToolExecutor()),
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
      resumeOrCreateThread: vi.fn().mockResolvedValue({
        threadId: 'test-thread-123',
        isResumed: false,
        resumeError: undefined,
      }),
      getLatestThreadId: vi.fn().mockReturnValue('latest-thread-123'),
      getCurrentThreadId: vi.fn().mockReturnValue('test-thread-123'),
      generateThreadId: vi.fn().mockReturnValue('generated-thread-123'),
      createThread: vi.fn(),
      compact: vi.fn(),
      getThreadEvents: vi.fn().mockReturnValue([]),
      getMainAndDelegateEvents: vi.fn().mockReturnValue([]),
      providerName: 'anthropic',
    } as Partial<Agent>;
    vi.mocked(Agent).mockImplementation(() => mockAgentInstance as Agent);

    // Mock interfaces
    NonInteractiveInterface.prototype.executePrompt = vi.fn().mockResolvedValue(undefined);
    TerminalInterface.prototype.startInteractive = vi.fn().mockResolvedValue(undefined);

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
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider initialization', () => {
    it('should initialize Anthropic provider with API key', async () => {
      const { AnthropicProvider } = await import('../providers/anthropic-provider.js');

      await run(mockCliOptions);

      expect(AnthropicProvider).toHaveBeenCalledWith({
        apiKey: 'mock-anthropic-key',
        model: 'claude-3-opus',
      });
    });

    it('should initialize OpenAI provider with API key', async () => {
      const { OpenAIProvider } = await import('../providers/openai-provider.js');
      const options = { ...mockCliOptions, provider: 'openai', model: 'gpt-4' };

      await run(options);

      expect(OpenAIProvider).toHaveBeenCalledWith({
        apiKey: 'mock-openai-key',
        model: 'gpt-4',
      });
    });

    it('should initialize LMStudio provider without API key', async () => {
      const { LMStudioProvider } = await import('../providers/lmstudio-provider.js');
      const options = { ...mockCliOptions, provider: 'lmstudio', model: 'local-model' };

      await run(options);

      expect(LMStudioProvider).toHaveBeenCalledWith({
        model: 'local-model',
      });
    });

    it('should initialize Ollama provider without API key', async () => {
      const { OllamaProvider } = await import('../providers/ollama-provider.js');
      const options = { ...mockCliOptions, provider: 'ollama', model: 'llama2' };

      await run(options);

      expect(OllamaProvider).toHaveBeenCalledWith({
        model: 'llama2',
      });
    });

    it('should throw error for missing Anthropic API key', async () => {
      const { getEnvVar } = vi.mocked(await import('../config/env-loader.js'));
      getEnvVar.mockImplementation((key) => {
        if (key === 'ANTHROPIC_KEY') return undefined;
        return undefined;
      });

      await expect(run(mockCliOptions)).rejects.toThrow('Anthropic API key is required');
    });

    it('should throw error for missing OpenAI API key', async () => {
      const { getEnvVar } = vi.mocked(await import('../config/env-loader.js'));
      getEnvVar.mockImplementation((key) => {
        if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return undefined;
        return undefined;
      });
      const options = { ...mockCliOptions, provider: 'openai' };

      await expect(run(options)).rejects.toThrow('OpenAI API key is required');
    });

    it('should throw error for unknown provider', async () => {
      const options = { ...mockCliOptions, provider: 'unknown-provider' };

      await expect(run(options)).rejects.toThrow('Unknown provider: unknown-provider');
    });
  });

  describe('session management', () => {
    it('should create new session when no continue specified', async () => {
      const { log } = withConsoleCapture();
      const { Agent } = vi.mocked(await import('../agents/agent.js'));

      await run(mockCliOptions);

      // Session handling now goes through Agent.resumeOrCreateThread
      const mockAgentInstance = vi.mocked(Agent).mock.results[0]?.value as Partial<Agent>;
      expect(mockAgentInstance?.resumeOrCreateThread).toHaveBeenCalledWith(undefined);
      expect(log).toHaveBeenCalledWith('🆕 Starting conversation test-thread-123');
    });

    it('should resume session when continue is true', async () => {
      const { log } = withConsoleCapture();
      const { Agent } = vi.mocked(await import('../agents/agent.js'));
      const { ToolExecutor } = vi.mocked(await import('../tools/executor.js'));

      // Override the mock to return resumed session
      const mockAgentInstance = {
        ...vi.mocked(Agent).mock.results[0]?.value,
        toolExecutor: vi.mocked(new ToolExecutor()),
        resumeOrCreateThread: vi.fn().mockResolvedValue({
          threadId: 'resumed-thread-456',
          isResumed: true,
          resumeError: undefined,
        }),
        getLatestThreadId: vi.fn().mockReturnValue('resumed-thread-456'),
      } as Partial<Agent>;
      vi.mocked(Agent).mockImplementation(() => mockAgentInstance as Agent);

      const options = { ...mockCliOptions, continue: true };

      await run(options);

      // Session handling now goes through Agent.resumeOrCreateThread
      expect(mockAgentInstance?.resumeOrCreateThread).toHaveBeenCalledWith('resumed-thread-456');
      expect(log).toHaveBeenCalledWith('📖 Continuing conversation resumed-thread-456');
    });

    it('should resume specific session when thread ID provided', async () => {
      const { log } = withConsoleCapture();
      const { Agent } = vi.mocked(await import('../agents/agent.js'));
      const { ToolExecutor } = vi.mocked(await import('../tools/executor.js'));

      // Override the mock to return specific session
      const mockAgentInstance = {
        ...vi.mocked(Agent).mock.results[0]?.value,
        toolExecutor: vi.mocked(new ToolExecutor()),
        resumeOrCreateThread: vi.fn().mockResolvedValue({
          threadId: 'specific-thread-789',
          isResumed: true,
          resumeError: undefined,
        }),
      } as Partial<Agent>;
      vi.mocked(Agent).mockImplementation(() => mockAgentInstance as Agent);

      const options = { ...mockCliOptions, continue: 'specific-thread-789' };

      await run(options);

      // Session handling now goes through Agent.resumeOrCreateThread
      expect(mockAgentInstance?.resumeOrCreateThread).toHaveBeenCalledWith('specific-thread-789');
      expect(log).toHaveBeenCalledWith('📖 Continuing conversation specific-thread-789');
    });

    it('should handle resume error gracefully', async () => {
      const { log, warn } = withConsoleCapture();
      const { Agent } = vi.mocked(await import('../agents/agent.js'));
      const { ToolExecutor } = vi.mocked(await import('../tools/executor.js'));

      // Override the mock to return error case
      const mockAgentInstance = {
        ...vi.mocked(Agent).mock.results[0]?.value,
        toolExecutor: vi.mocked(new ToolExecutor()),
        resumeOrCreateThread: vi.fn().mockResolvedValue({
          threadId: 'new-thread-123',
          isResumed: false,
          resumeError: 'Mock resume error',
        }),
      } as Partial<Agent>;
      vi.mocked(Agent).mockImplementation(() => mockAgentInstance as Agent);

      await run(mockCliOptions);

      expect(warn).toHaveBeenCalledWith('⚠️  Mock resume error');
      expect(log).toHaveBeenCalledWith('🆕 Starting new conversation new-thread-123');
    });
  });

  describe('interface selection', () => {
    it('should use NonInteractiveInterface for prompt execution', async () => {
      const { NonInteractiveInterface } = vi.mocked(
        await import('../interfaces/non-interactive-interface.js')
      );
      const options = { ...mockCliOptions, prompt: 'test prompt' };

      await run(options);

      expect(NonInteractiveInterface).toHaveBeenCalledWith(expect.any(Object));
      const executePromptSpy = vi.mocked(NonInteractiveInterface.prototype.executePrompt);
      expect(executePromptSpy).toHaveBeenCalledWith('test prompt');
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should use TerminalInterface for interactive mode', async () => {
      const { TerminalInterface } = vi.mocked(
        await import('../interfaces/terminal/terminal-interface.js')
      );

      await run(mockCliOptions);

      expect(TerminalInterface).toHaveBeenCalledWith(expect.any(Object));
      const startInteractiveSpy = vi.mocked(TerminalInterface.prototype.startInteractive);
      expect(startInteractiveSpy).toHaveBeenCalled();
    });
  });

  describe('logging and configuration', () => {
    it('should configure logger with provided options', async () => {
      const { logger } = vi.mocked(await import('../utils/logger.js'));
      const options = { ...mockCliOptions, logLevel: 'debug' as const, logFile: 'test.log' };

      await run(options);

      const configureSpy = vi.mocked(logger.configure);
      expect(configureSpy).toHaveBeenCalledWith('debug', 'test.log');
    });

    it('should enable traffic logging when harFile specified', async () => {
      const { enableTrafficLogging } = vi.mocked(await import('../utils/traffic-logger.js'));
      const options = { ...mockCliOptions, harFile: 'test.har' };

      await run(options);

      expect(enableTrafficLogging).toHaveBeenCalledWith('test.har');
    });

    it('should set up global policy callback', async () => {
      const { createGlobalPolicyCallback } = vi.mocked(await import('../tools/policy-wrapper.js'));
      const { Agent } = vi.mocked(await import('../agents/agent.js'));

      await run(mockCliOptions);

      expect(createGlobalPolicyCallback).toHaveBeenCalled();
      const agentInstance = vi.mocked(Agent).mock.results[0]?.value as Partial<Agent>;
      expect(agentInstance?.toolExecutor?.setApprovalCallback).toHaveBeenCalled();
    });
  });

  describe('agent and tool setup', () => {
    it('should create Agent with correct configuration', async () => {
      const { Agent } = vi.mocked(await import('../agents/agent.js'));

      await run(mockCliOptions);

      expect(Agent).toHaveBeenCalledWith({
        provider: expect.anything(), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        toolExecutor: expect.anything(), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        threadManager: expect.anything(), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        threadId: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        tools: expect.anything(), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      });
    });

    it('should register all available tools', async () => {
      const { ToolExecutor } = vi.mocked(await import('../tools/executor.js'));

      await run(mockCliOptions);

      const registerToolsSpy = vi.mocked(ToolExecutor.prototype.registerAllAvailableTools);
      expect(registerToolsSpy).toHaveBeenCalled();
    });

    it('should set delegate tool dependencies if delegate tool exists', async () => {
      const { ToolExecutor } = vi.mocked(await import('../tools/executor.js'));
      const mockDelegateTool = {
        name: 'delegate',
        description: 'Mock delegate tool',
        schema: {},
        inputSchema: {},
        execute: vi.fn(),
        executeValidated: vi.fn(),
        createResult: vi.fn(),
        createErrorResult: vi.fn(),
        setDependencies: vi.fn(),
      };
      ToolExecutor.prototype.getTool = vi.fn().mockReturnValue(mockDelegateTool);

      await run(mockCliOptions);

      expect(mockDelegateTool.setDependencies).toHaveBeenCalledWith(
        expect.any(Object), // Agent
        expect.any(Object) // ToolExecutor
      );
    });
  });
});
