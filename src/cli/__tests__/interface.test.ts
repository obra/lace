// ABOUTME: Unit tests for CLIInterface class
// ABOUTME: Tests event handling, readline management, and agent integration

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIInterface } from '../interface.js';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { AIProvider, ProviderMessage, ProviderResponse } from '../../providers/types.js';
import { Tool } from '../../tools/types.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ToolRegistry } from '../../tools/registry.js';
import * as readline from 'readline';

// Mock readline module
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

// Mock session module
vi.mock('../../threads/session.js', () => ({
  handleGracefulShutdown: vi.fn().mockResolvedValue(undefined),
}));

// Mock provider for testing
class MockProvider extends AIProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock-provider';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return {
      content: 'Mock response',
      toolCalls: [],
    };
  }
}

describe('CLIInterface', () => {
  let provider: MockProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolRegistry: ToolRegistry;
  let toolExecutor: ToolExecutor;
  let cli: CLIInterface;
  let mockRl: any;
  let stdoutSpy: any;
  let consoleSpy: any;

  beforeEach(() => {
    provider = new MockProvider();
    toolRegistry = new ToolRegistry();
    toolExecutor = new ToolExecutor(toolRegistry);
    threadManager = new ThreadManager(':memory:');

    const threadId = 'test_thread';
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    // Mock readline interface
    mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    // Spy on stdout/stderr
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    cli = new CLIInterface(agent, threadManager);
  });

  afterEach(async () => {
    if (agent) {
      agent.removeAllListeners();
      agent.stop();
    }
    if (threadManager) {
      await threadManager.close();
    }
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create CLIInterface and setup event handlers', () => {
      expect(cli).toBeInstanceOf(CLIInterface);

      // Verify event handlers are set up by checking listener count
      expect(agent.listenerCount('agent_thinking_complete')).toBeGreaterThan(0);
      expect(agent.listenerCount('agent_response_complete')).toBeGreaterThan(0);
      expect(agent.listenerCount('tool_call_start')).toBeGreaterThan(0);
      expect(agent.listenerCount('tool_call_complete')).toBeGreaterThan(0);
      expect(agent.listenerCount('error')).toBeGreaterThan(0);
    });
  });

  describe('event handling', () => {
    beforeEach(() => {
      agent.start();
    });

    it('should handle agent_thinking_complete events with think blocks', () => {
      agent.emit('agent_thinking_complete', {
        content: '<think>I need to process this</think>Regular response content',
      });

      expect(stdoutSpy).toHaveBeenCalledWith('\n\x1b[3mI need to process this\x1b[0m\n\n');
    });

    it('should handle agent_thinking_complete without think blocks', () => {
      agent.emit('agent_thinking_complete', {
        content: 'Regular response without think blocks',
      });

      // Should not write anything for content without think blocks
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle agent_response_complete events', () => {
      agent.emit('agent_response_complete', {
        content: 'This is the final response',
      });

      expect(stdoutSpy).toHaveBeenCalledWith('This is the final response\n\n');
    });

    it('should handle empty agent responses', () => {
      agent.emit('agent_response_complete', { content: '' });
      agent.emit('agent_response_complete', { content: null as any });

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle tool_call_start events', () => {
      agent.emit('tool_call_start', {
        toolName: 'test_tool',
        input: { action: 'test' },
        callId: 'call_123',
      });

      expect(stdoutSpy).toHaveBeenCalledWith('\n🔧 Running: test_tool with {"action":"test"}\n');
    });

    it('should truncate large tool inputs', () => {
      const largeInput = { data: 'x'.repeat(200) };

      agent.emit('tool_call_start', {
        toolName: 'test_tool',
        input: largeInput,
        callId: 'call_123',
      });

      const expectedCall = stdoutSpy.mock.calls.find((call: any) =>
        call[0].includes('Running: test_tool')
      );
      expect(expectedCall[0]).toContain('...');
      expect(expectedCall[0].length).toBeLessThan(300);
    });

    it('should handle successful tool_call_complete events', () => {
      agent.emit('tool_call_complete', {
        toolName: 'test_tool',
        result: {
          isError: false,
          content: [{ type: 'text', text: 'Tool executed successfully' }],
        },
        callId: 'call_123',
      });

      expect(stdoutSpy).toHaveBeenCalledWith('✅ Tool completed:\nTool executed successfully\n\n');
    });

    it('should handle failed tool_call_complete events', () => {
      agent.emit('tool_call_complete', {
        toolName: 'test_tool',
        result: {
          isError: true,
          content: [{ type: 'text', text: 'Tool execution failed' }],
        },
        callId: 'call_123',
      });

      expect(stdoutSpy).toHaveBeenCalledWith('❌ Tool failed: Tool execution failed\n\n');
    });

    it('should truncate large tool outputs', () => {
      const largeOutput = 'x'.repeat(1000);

      agent.emit('tool_call_complete', {
        toolName: 'test_tool',
        result: {
          isError: false,
          content: [{ type: 'text', text: largeOutput }],
        },
        callId: 'call_123',
      });

      const outputCall = stdoutSpy.mock.calls.find((call: any) =>
        call[0].includes('Tool completed')
      );
      expect(outputCall[0]).toContain('(1000 chars)');
      expect(outputCall[0]).toContain('...');
    });

    it('should handle error events', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      agent.emit('error', {
        error: new Error('Test error'),
        context: { phase: 'test' },
      });

      expect(consoleSpy).toHaveBeenCalledWith('\n❌ Error: Test error\n');

      consoleSpy.mockRestore();
    });

    it('should show provider suggestions for lmstudio errors', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Create agent with lmstudio provider name
      const lmProvider = new MockProvider();
      vi.spyOn(lmProvider, 'providerName', 'get').mockReturnValue('lmstudio');

      const lmAgent = new Agent({
        provider: lmProvider,
        toolExecutor,
        threadManager,
        threadId: 'test',
        tools: [],
      });

      new CLIInterface(lmAgent, threadManager);

      lmAgent.emit('error', {
        error: new Error('Connection failed'),
        context: { phase: 'test' },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Try using Anthropic Claude instead')
      );

      lmAgent.removeAllListeners();
      consoleSpy.mockRestore();
    });
  });

  describe('handleSinglePrompt', () => {
    it('should process single prompt and exit', async () => {
      const agentSendSpy = vi.spyOn(agent, 'sendMessage').mockResolvedValue();
      const agentStartSpy = vi.spyOn(agent, 'start').mockImplementation(() => {});

      await cli.handleSinglePrompt('Test prompt');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('using mock-provider provider')
      );
      expect(agentStartSpy).toHaveBeenCalled();
      expect(agentSendSpy).toHaveBeenCalledWith('Test prompt');
    });

    it('should handle errors in single prompt mode', async () => {
      vi.spyOn(agent, 'sendMessage').mockRejectedValue(new Error('Test error'));
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      await expect(cli.handleSinglePrompt('Test prompt')).rejects.toThrow('Test error');
    });
  });

  describe('startInteractive', () => {
    it('should throw error if already running', async () => {
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      // Mock question to immediately return 'exit' for cleanup
      mockRl.question.mockImplementation((prompt: string, callback: (input: string) => void) => {
        setTimeout(() => callback('exit'), 1);
      });

      // Start first instance (will complete quickly due to mocked exit)
      const firstStart = cli.startInteractive();

      // Try to start second instance immediately
      await expect(cli.startInteractive()).rejects.toThrow('CLI interface is already running');

      // Clean up first instance
      await firstStart;
    }, 10000);

    it('should setup readline and start agent', async () => {
      const agentStartSpy = vi.spyOn(agent, 'start').mockImplementation(() => {});

      // Mock question to immediately return 'exit'
      mockRl.question.mockImplementation((prompt: string, callback: (input: string) => void) => {
        callback('exit');
      });

      await cli.startInteractive();

      expect(readline.createInterface).toHaveBeenCalledWith({
        input: process.stdin,
        output: process.stdout,
      });
      expect(agentStartSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Lace Agent started using mock-provider provider')
      );
    });

    it('should handle user input and send to agent', async () => {
      const agentSendSpy = vi.spyOn(agent, 'sendMessage').mockResolvedValue();
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      let callCount = 0;

      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callCount++;
        if (callCount === 1) {
          setTimeout(() => callback('test message'), 10);
        } else {
          setTimeout(() => callback('exit'), 10);
        }
      });

      await cli.startInteractive();

      expect(agentSendSpy).toHaveBeenCalledWith('test message');
    });

    it('should ignore empty input', async () => {
      const agentSendSpy = vi.spyOn(agent, 'sendMessage').mockResolvedValue();
      vi.spyOn(agent, 'start').mockImplementation(() => {});

      let callCount = 0;
      mockRl.question.mockImplementation((prompt: string, callback: (input: string) => void) => {
        callCount++;
        if (callCount === 1) {
          setTimeout(() => callback('   '), 10); // Whitespace only
        } else {
          setTimeout(() => callback('exit'), 10);
        }
      });

      await cli.startInteractive();

      expect(agentSendSpy).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop agent, close readline, and shutdown gracefully', async () => {
      const agentStopSpy = vi.spyOn(agent, 'stop').mockImplementation(() => {});

      // Set the interface as running first
      vi.spyOn(agent, 'start').mockImplementation(() => {});
      mockRl.question.mockImplementation((_prompt: string, _callback: (input: string) => void) => {
        // Don't call callback to keep it "running"
      });

      // Start the interface
      cli.startInteractive();

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now stop it
      await cli.stop();

      expect(agentStopSpy).toHaveBeenCalled();
      expect(mockRl.close).toHaveBeenCalled();
    });

    it('should handle multiple stop calls gracefully', async () => {
      await cli.stop();
      await cli.stop(); // Should not throw

      expect(true).toBe(true); // Test passes if no error thrown
    });
  });

  describe('streaming support', () => {
    beforeEach(() => {
      agent.start();
    });

    it('should handle agent_token events', () => {
      agent.emit('agent_token', { token: 'Hello ' });
      agent.emit('agent_token', { token: 'world!' });

      expect(stdoutSpy).toHaveBeenCalledWith('Hello ');
      expect(stdoutSpy).toHaveBeenCalledWith('world!');
    });

    it('should handle streaming vs non-streaming response_complete differently', () => {
      // Mock getCurrentState to return streaming
      vi.spyOn(agent, 'getCurrentState').mockReturnValue('streaming');

      agent.emit('agent_response_complete', { content: 'Streaming response' });

      // Should only add newlines for streaming (content already displayed via tokens)
      expect(stdoutSpy).toHaveBeenCalledWith('\n\n');
      expect(stdoutSpy).not.toHaveBeenCalledWith('Streaming response\n\n');
    });

    it('should display full content for non-streaming responses', () => {
      // Mock getCurrentState to return idle (non-streaming)
      vi.spyOn(agent, 'getCurrentState').mockReturnValue('idle');

      agent.emit('agent_response_complete', { content: 'Non-streaming response' });

      // Should display full content
      expect(stdoutSpy).toHaveBeenCalledWith('Non-streaming response\n\n');
    });

    it('should handle empty streaming responses gracefully', () => {
      vi.spyOn(agent, 'getCurrentState').mockReturnValue('streaming');

      agent.emit('agent_response_complete', { content: '' });

      // Should still add newlines even for empty streaming responses
      expect(stdoutSpy).toHaveBeenCalledWith('\n\n');
    });

    it('should handle token events with special characters', () => {
      agent.emit('agent_token', { token: '\n' });
      agent.emit('agent_token', { token: '\t' });
      agent.emit('agent_token', { token: '🔧' });

      expect(stdoutSpy).toHaveBeenCalledWith('\n');
      expect(stdoutSpy).toHaveBeenCalledWith('\t');
      expect(stdoutSpy).toHaveBeenCalledWith('🔧');
    });

    it('should handle rapid token sequences', () => {
      const tokens = ['The ', 'quick ', 'brown ', 'fox '];

      tokens.forEach((token) => {
        agent.emit('agent_token', { token });
      });

      tokens.forEach((token) => {
        expect(stdoutSpy).toHaveBeenCalledWith(token);
      });
      expect(stdoutSpy).toHaveBeenCalledTimes(tokens.length);
    });
  });

  describe('slash commands', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('should handle /compact command when thread exists', async () => {
      // Mock thread exists
      vi.spyOn(threadManager, 'getCurrentThreadId').mockReturnValue('test-thread');
      vi.spyOn(threadManager, 'compact').mockImplementation(() => {});
      vi.spyOn(threadManager, 'getEvents').mockReturnValue([
        {
          id: 'msg1',
          threadId: 'test-thread',
          type: 'LOCAL_SYSTEM_MESSAGE',
          timestamp: new Date(),
          data: '🗜️ Compacted 1 tool results to save about 50 tokens.',
        },
      ]);

      // Call handleSlashCommand through reflection since it's private
      await (cli as any).handleSlashCommand('/compact');

      expect(threadManager.compact).toHaveBeenCalledWith('test-thread');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '🗜️ Compacted 1 tool results to save about 50 tokens.'
      );
    });

    it('should handle /compact command when no thread exists', async () => {
      vi.spyOn(threadManager, 'getCurrentThreadId').mockReturnValue(null);
      vi.spyOn(threadManager, 'compact').mockImplementation(() => {});

      await (cli as any).handleSlashCommand('/compact');

      expect(threadManager.compact).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ No active thread to compact');
    });

    it('should handle /help command', async () => {
      await (cli as any).handleSlashCommand('/help');

      expect(consoleLogSpy).toHaveBeenCalledWith('Available commands:');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '  /compact  - Compress tool results to save tokens'
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('  /help     - Show this help message');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '  /exit     - Exit the application (or just "exit")'
      );
    });

    it('should handle unknown slash commands', async () => {
      await (cli as any).handleSlashCommand('/unknown');

      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Unknown command: /unknown');
      expect(consoleLogSpy).toHaveBeenCalledWith('Type /help for available commands');
    });
  });
});
