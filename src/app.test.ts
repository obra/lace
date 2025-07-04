// ABOUTME: Unit tests for src/app.ts
// ABOUTME: Tests the core application setup, provider creation, and session handling logic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { run } from './app.js';
import { CLIOptions } from './cli/args.js';
import { Agent } from './agents/agent.js';
import { ThreadManager } from './threads/thread-manager.js';
import { ToolExecutor } from './tools/executor.js';
import { getEnvVar } from './config/env-loader.js';
import { enableTrafficLogging } from './utils/traffic-logger.js';
import { logger } from './utils/logger.js';
import { NonInteractiveInterface } from './interfaces/non-interactive-interface.js';
import { TerminalInterface } from './interfaces/terminal/terminal-interface.js';
import { createGlobalPolicyCallback } from './tools/policy-wrapper.js';
import { OllamaProvider } from './providers/ollama-provider.js';

// Mock external dependencies at the module level
vi.mock('./agents/agent.js');
vi.mock('./threads/thread-manager.js');
vi.mock('./tools/executor.js');
vi.mock('./config/lace-dir.js', () => ({
  getLaceDbPath: vi.fn(() => '/mock/db/path'),
}));
vi.mock('./config/env-loader.js');
vi.mock('./utils/logger.js');
vi.mock('./utils/traffic-logger.js');
vi.mock('./interfaces/non-interactive-interface.js');
vi.mock('./interfaces/terminal/terminal-interface.js');
vi.mock('./tools/policy-wrapper.js');

// Mock providers - these need to be dynamic imports for the app.ts to work
vi.mock('./providers/anthropic-provider.js', () => ({
  AnthropicProvider: vi.fn(() => ({
    providerName: 'anthropic',
    cleanup: vi.fn(),
  })),
}));
vi.mock('./providers/openai-provider.js', () => ({
  OpenAIProvider: vi.fn(() => ({
    providerName: 'openai',
    cleanup: vi.fn(),
  })),
}));
vi.mock('./providers/lmstudio-provider.js', () => ({
  LMStudioProvider: vi.fn(() => ({
    providerName: 'lmstudio',
    cleanup: vi.fn(),
  })),
}));
vi.mock('./providers/ollama-provider.js', () => ({
  OllamaProvider: vi.fn(() => ({
    providerName: 'ollama',
    cleanup: vi.fn(),
  })),
}));

describe('App Initialization (run function)', () => {
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
    vi.clearAllMocks();

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

    // Mock ToolExecutor methods
    vi.mocked(ToolExecutor.prototype.registerAllAvailableTools).mockReturnValue(undefined);
    vi.mocked(ToolExecutor.prototype.getAllTools).mockReturnValue([]);
    vi.mocked(ToolExecutor.prototype.getTool).mockReturnValue(undefined);
    vi.mocked(ToolExecutor.prototype.setApprovalCallback).mockReturnValue(undefined); // Add this mock

    // Mock Agent constructor and its methods
    vi.mocked(Agent).mockImplementation(() => {
      const mockAgentInstance = {
        start: vi.fn(),
        toolExecutor: vi.mocked(new ToolExecutor()), // Ensure this is a mocked instance
      };
      // Mock the prototype methods that are accessed
      Object.setPrototypeOf(mockAgentInstance, Agent.prototype);
      return mockAgentInstance;
    });

    // Mock console.log and console.warn to prevent test output pollution
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never); // Mock process.exit

    // Mock TerminalInterface.prototype.startInteractive
    vi.mocked(TerminalInterface.prototype.startInteractive).mockResolvedValue(undefined);

    // Mock createGlobalPolicyCallback
    vi.mocked(createGlobalPolicyCallback).mockReturnValue(vi.fn()); // Mock the function itself
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize logger and traffic logging', async () => {
    const options = { ...mockCliOptions, harFile: 'test.har' };
    await run(options);
    expect(logger.configure).toHaveBeenCalledWith(options.logLevel, options.logFile);
    expect(enableTrafficLogging).toHaveBeenCalledWith(options.harFile);
  });

  it('should create an Anthropic provider with API key from env', async () => {
    const { AnthropicProvider } = await import('./providers/anthropic-provider.js');
    await run(mockCliOptions);
    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'mock-anthropic-key',
      model: 'claude-3-opus',
    });
  });

  it('should create an OpenAI provider with API key from env', async () => {
    const options = { ...mockCliOptions, provider: 'openai', model: 'gpt-4' };
    const { OpenAIProvider } = await import('./providers/openai-provider.js');
    await run(options);
    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'mock-openai-key',
      model: 'gpt-4',
    });
  });

  it('should create an LMstudio provider without API key', async () => {
    const options = { ...mockCliOptions, provider: 'lmstudio', model: 'local-model' };
    const { LMStudioProvider } = await import('./providers/lmstudio-provider.js');
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
    (getEnvVar as vi.Mock).mockImplementation((key) => {
      if (key === 'ANTHROPIC_KEY') return undefined;
      return undefined;
    });
    const options = { ...mockCliOptions, provider: 'anthropic' };
    await expect(run(options)).rejects.toThrow('Anthropic API key is required');
  });

  it('should exit if OpenAI API key is missing', async () => {
    (getEnvVar as vi.Mock).mockImplementation((key) => {
      if (key === 'OPENAI_API_KEY' || key === 'OPENAI_KEY') return undefined;
      return undefined;
    });
    const options = { ...mockCliOptions, provider: 'openai' };
    await expect(run(options)).rejects.toThrow('OpenAI API key is required');
  });

  it('should throw error for unknown provider', async () => {
    const options = { ...mockCliOptions, provider: 'unknown-provider' };
    await expect(run(options)).rejects.toThrow(
      'Unknown provider: unknown-provider. Available providers are: anthropic, openai, lmstudio, ollama'
    );
  });

  it('should initialize ThreadManager and handle new session', async () => {
    await run(mockCliOptions);
    expect(ThreadManager).toHaveBeenCalledWith('/mock/db/path');
    expect(vi.mocked(ThreadManager.prototype.resumeOrCreate)).toHaveBeenCalledWith(undefined);
    expect(console.log).toHaveBeenCalledWith('🆕 Starting conversation new-thread-123');
  });

  it('should initialize ThreadManager and handle resumed session', async () => {
    vi.mocked(ThreadManager.prototype.resumeOrCreate).mockResolvedValue({
      threadId: 'resumed-thread-456',
      isResumed: true,
      resumeError: undefined,
    });
    const options = { ...mockCliOptions, continue: true };
    await run(options);
    expect(vi.mocked(ThreadManager.prototype.resumeOrCreate)).toHaveBeenCalledWith(undefined); // continue: true means latest
    expect(console.log).toHaveBeenCalledWith('📖 Continuing conversation resumed-thread-456');
  });

  it('should initialize ThreadManager and handle resumed session with ID', async () => {
    vi.mocked(ThreadManager.prototype.resumeOrCreate).mockResolvedValue({
      threadId: 'specific-thread-789',
      isResumed: true,
      resumeError: undefined,
    });
    const options = { ...mockCliOptions, continue: 'specific-thread-789' };
    await run(options);
    expect(vi.mocked(ThreadManager.prototype.resumeOrCreate)).toHaveBeenCalledWith(
      'specific-thread-789'
    );
    expect(console.log).toHaveBeenCalledWith('📖 Continuing conversation specific-thread-789');
  });

  it('should initialize ThreadManager and handle resume error', async () => {
    vi.mocked(ThreadManager.prototype.resumeOrCreate).mockResolvedValue({
      threadId: 'new-thread-123',
      isResumed: false,
      resumeError: 'Mock resume error',
    });
    await run(mockCliOptions);
    expect(console.warn).toHaveBeenCalledWith('⚠️  Mock resume error');
    expect(console.log).toHaveBeenCalledWith('🆕 Starting new conversation new-thread-123');
  });

  it('should set up ToolExecutor and Agent', async () => {
    await run(mockCliOptions);
    expect(ToolExecutor).toHaveBeenCalledTimes(2); // Once for setupAgent, once for agent.toolExecutor
    expect(vi.mocked(ToolExecutor.prototype.registerAllAvailableTools)).toHaveBeenCalledTimes(1);
    expect(Agent).toHaveBeenCalledTimes(1);
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.any(Object),
        toolExecutor: expect.any(ToolExecutor),
        threadManager: expect.any(ThreadManager),
        threadId: 'new-thread-123',
        tools: [],
      })
    );
  });

  it('should set delegate tool dependencies if delegate tool exists', async () => {
    const mockDelegateTool = {
      setDependencies: vi.fn(),
    };
    vi.mocked(ToolExecutor.prototype.getTool).mockReturnValue(mockDelegateTool);
    await run(mockCliOptions);
    expect(mockDelegateTool.setDependencies).toHaveBeenCalledWith(
      expect.any(ThreadManager),
      expect.any(ToolExecutor)
    );
  });

  it('should execute prompt in non-interactive mode and exit', async () => {
    const options = { ...mockCliOptions, prompt: 'test prompt' };
    await run(options);
    expect(NonInteractiveInterface).toHaveBeenCalledWith(expect.any(Agent));
    expect(vi.mocked(NonInteractiveInterface.prototype.executePrompt)).toHaveBeenCalledWith(
      'test prompt'
    );
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should start interactive mode if no prompt is given', async () => {
    const { TerminalInterface } = await import('./interfaces/terminal/terminal-interface.js');
    await run(mockCliOptions);
    expect(TerminalInterface).toHaveBeenCalledWith(expect.any(Agent));
    expect(vi.mocked(TerminalInterface.prototype.startInteractive)).toHaveBeenCalledTimes(1);
  });

  it('should set global policy callback on tool executor', async () => {
    const mockPolicyCallback = vi.fn();
    vi.mocked(createGlobalPolicyCallback).mockReturnValue(mockPolicyCallback);
    await run(mockCliOptions);
    expect(vi.mocked(createGlobalPolicyCallback)).toHaveBeenCalledWith(
      expect.any(Object), // Mocked TerminalInterface instance
      mockCliOptions,
      expect.any(ToolExecutor) // Agent's toolExecutor
    );
    const agentInstance = vi.mocked(Agent).mock.results[0].value;
    expect(agentInstance.toolExecutor.setApprovalCallback).toHaveBeenCalledWith(mockPolicyCallback);
  });
});
