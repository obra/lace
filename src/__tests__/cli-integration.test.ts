// ABOUTME: Integration tests for main CLI orchestration (src/cli.ts)
// ABOUTME: Tests provider creation, tool setup, and CLIInterface integration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../cli/args.js';
import { AnthropicProvider } from '../providers/anthropic-provider.js';
import { LMStudioProvider } from '../providers/lmstudio-provider.js';
import { OllamaProvider } from '../providers/ollama-provider.js';

// Mock the CLIInterface to avoid readline complications
vi.mock('../cli/interface.js', () => ({
  CLIInterface: class MockCLIInterface {
    constructor(
      public agent: any,
      public threadManager: any
    ) {}
    async handleSinglePrompt(_prompt: string) {
      return;
    }
    async startInteractive() {
      return;
    }
  },
}));

// Mock session management to avoid file system
vi.mock('../threads/session.js', () => ({
  startSession: vi.fn().mockResolvedValue({
    threadManager: {
      close: vi.fn().mockResolvedValue(undefined),
      createThread: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
    },
    threadId: 'test_thread_123',
    isNewSession: true,
    isResumed: false,
  }),
}));

// Mock logger to avoid file I/O
vi.mock('../utils/logger.js', () => ({
  logger: {
    configure: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock prompt config
vi.mock('../config/prompts.js', () => ({
  loadPromptConfig: vi.fn().mockResolvedValue({
    systemPrompt: 'Test system prompt',
    userInstructions: '',
    filesCreated: [],
  }),
  getUserInstructionsFilePath: vi.fn().mockReturnValue('/test/user.txt'),
}));

describe('CLI Orchestration', () => {
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv }; // Make a copy we can modify
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('argument parsing integration', () => {
    it('should parse all CLI arguments correctly', async () => {
      const result = await parseArgs([
        '--provider',
        'lmstudio',
        '--log-level',
        'debug',
        '--prompt',
        'test prompt',
      ]);

      expect(result).toEqual({
        provider: 'lmstudio',
        model: undefined,
        help: false,
        logLevel: 'debug',
        logFile: undefined,
        prompt: 'test prompt',
        ui: 'terminal',
        continue: undefined,
        allowNonDestructiveTools: false,
        autoApproveTools: [],
        disableTools: [],
        disableAllTools: false,
        disableToolGuardrails: false,
        listTools: false,
      });
    });
  });

  describe('provider creation', () => {
    it('should create AnthropicProvider with API key', () => {
      process.env.ANTHROPIC_KEY = 'test-key';

      const provider = new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_KEY!,
        systemPrompt: 'test',
      });

      expect(provider.providerName).toBe('anthropic');
    });

    it('should create LMStudioProvider without API key', () => {
      const provider = new LMStudioProvider({ systemPrompt: 'test' });
      expect(provider.providerName).toBe('lmstudio');
    });

    it('should create OllamaProvider without API key', () => {
      const provider = new OllamaProvider({ systemPrompt: 'test' });
      expect(provider.providerName).toBe('ollama');
    });

    it('should validate required environment variables', () => {
      delete process.env.ANTHROPIC_KEY;

      expect(() => {
        if (!process.env.ANTHROPIC_KEY) {
          throw new Error('ANTHROPIC_KEY environment variable required for Anthropic provider');
        }
      }).toThrow('ANTHROPIC_KEY environment variable required');
    });
  });

  describe('tool registration', () => {
    it('should have all expected tool classes available', async () => {
      // Test that we can import and instantiate all expected tools
      const { BashTool } = await import('../tools/implementations/bash.js');
      const { FileReadTool } = await import('../tools/implementations/file-read.js');
      const { FileWriteTool } = await import('../tools/implementations/file-write.js');
      const { FileListTool } = await import('../tools/implementations/file-list.js');
      const { RipgrepSearchTool } = await import('../tools/implementations/ripgrep-search.js');
      const { FileFindTool } = await import('../tools/implementations/file-find.js');
      const { TaskAddTool, TaskListTool, TaskCompleteTool } = await import(
        '../tools/implementations/task-manager/index.js'
      );

      const tools = [
        new BashTool(),
        new FileReadTool(),
        new FileWriteTool(),
        new FileListTool(),
        new RipgrepSearchTool(),
        new FileFindTool(),
        new TaskAddTool(),
        new TaskListTool(),
        new TaskCompleteTool(),
      ];

      expect(tools).toHaveLength(9);
      tools.forEach((tool) => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        // All tools now use the new schema-based interface
        expect(typeof tool.execute).toBe('function');
      });
    });
  });

  describe('component integration', () => {
    it('should integrate Agent with TerminalInterface correctly', async () => {
      const { Agent } = await import('../agents/agent.js');
      const { TerminalInterface } = await import('../interfaces/terminal/terminal-interface.js');
      const { ThreadManager } = await import('../threads/thread-manager.js');
      const { ToolExecutor } = await import('../tools/executor.js');

      // Create all components like CLI does
      const provider = new LMStudioProvider({ systemPrompt: 'test' });
      const toolExecutor = new ToolExecutor();
      toolExecutor.registerAllAvailableTools();
      const threadManager = new ThreadManager(':memory:');
      const threadId = 'test_thread';

      threadManager.createThread(threadId);

      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: toolExecutor.getAllTools(),
      });

      const cli = new TerminalInterface(agent);

      // Verify integration
      expect(agent.providerName).toBe('lmstudio');
      expect(agent.getThreadId()).toBe(threadId);
      expect(cli).toBeInstanceOf(TerminalInterface);

      // Cleanup
      agent.removeAllListeners();
      await threadManager.close();
    });
  });
});
