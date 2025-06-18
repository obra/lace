// ABOUTME: Unit tests for CLI Interface approval callback implementation with TDD approach
// ABOUTME: Tests interactive approval prompts, user input handling, and approval decision formatting

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIInterface } from '../interface.js';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { AIProvider, ProviderMessage, ProviderResponse } from '../../providers/types.js';
import { Tool } from '../../tools/types.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ApprovalDecision } from '../../tools/approval-types.js';
import { BashTool } from '../../tools/implementations/bash.js';
import { FileReadTool } from '../../tools/implementations/file-read.js';
import { FileWriteTool } from '../../tools/implementations/file-write.js';
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

describe('CLIInterface Approval Callback', () => {
  let provider: MockProvider;
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let cli: CLIInterface;
  let mockRl: any;
  let stdoutSpy: any;
  beforeEach(() => {
    provider = new MockProvider();
    threadManager = new ThreadManager(':memory:');

    const threadId = 'test_thread';
    threadManager.createThread(threadId);

    // Mock readline interface
    mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    // Spy on stdout/stderr
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create simplified ToolExecutor and register tools
    toolExecutor = new ToolExecutor();
    toolExecutor.registerTool('bash', new BashTool());
    toolExecutor.registerTool('file_read', new FileReadTool());
    toolExecutor.registerTool('file_write', new FileWriteTool());

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    // Create CLI interface with tool executor
    cli = new CLIInterface(agent, threadManager, toolExecutor);
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

  describe('approval callback implementation', () => {
    it('should implement ApprovalCallback interface', () => {
      expect(typeof cli.requestApproval).toBe('function');
    });

    it('should display tool information and prompt for approval', async () => {
      // Mock user response
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      const toolName = 'bash';
      const input = { command: 'ls -la' };

      const result = await cli.requestApproval(toolName, input);

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);

      // Should display tool information
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Tool approval request'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Tool: bash'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('ls -la'));
    });

    it('should handle "y" response for ALLOW_ONCE', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });
      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
    });

    it('should handle "a" response for ALLOW_SESSION', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('a');
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });
      expect(result).toBe(ApprovalDecision.ALLOW_SESSION);
    });

    it('should handle "n" response for DENY', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('n');
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });
      expect(result).toBe(ApprovalDecision.DENY);
    });

    it('should handle case-insensitive responses', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('Y'); // uppercase
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });
      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
    });

    it('should reprompt for invalid responses', async () => {
      let callCount = 0;
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback('invalid'); // First response is invalid
        } else {
          callback('y'); // Second response is valid
        }
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });

      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
      expect(mockRl.question).toHaveBeenCalledTimes(2);

      // Should show error message for invalid input
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid response'));
    });
  });

  describe('tool input formatting', () => {
    it('should format simple input parameters nicely', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      const input = { command: 'echo hello', verbose: true };
      await cli.requestApproval('bash', input);

      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('command: "echo hello"');
      expect(output).toContain('verbose: true');
    });

    it('should truncate large input parameters', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      const largeContent = 'x'.repeat(1000);
      const input = { content: largeContent, path: 'test.txt' };

      await cli.requestApproval('file_write', input);

      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('...[truncated]');
      expect(output).not.toContain(largeContent); // Should not show full content
    });

    it('should handle nested object parameters', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      const input = {
        config: {
          host: 'localhost',
          port: 3000,
        },
        options: ['verbose', 'debug'],
      };

      await cli.requestApproval('complex_tool', input);

      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('config:');
      expect(output).toContain('localhost');
      expect(output).toContain('options:');
    });

    it('should handle empty or null input gracefully', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      await cli.requestApproval('simple_tool', {});
      await cli.requestApproval('null_tool', null as any);

      // Should not crash and should show some indication
      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('Tool: simple_tool');
      expect(output).toContain('Tool: null_tool');
    });
  });

  describe('approval prompt formatting', () => {
    it('should show clear approval options', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      await cli.requestApproval('test_tool', { param: 'value' });

      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('y) Allow this time');
      expect(output).toContain('a) Allow for this session');
      expect(output).toContain('n) Deny');
    });

    it('should show safety warning for destructive tools', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      await cli.requestApproval('bash', { command: 'rm -rf /' });

      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('⚠️'); // Warning emoji
      expect(output).toContain('destructive');
    });

    it('should show safety indicator for read-only tools', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('y');
      });

      await cli.requestApproval('file_read', { path: 'test.txt' });

      const output = stdoutSpy.mock.calls.map((call: string[]) => call[0]).join('');
      expect(output).toContain('✅'); // Safe emoji
      expect(output).toContain('read-only');
    });
  });

  describe('readline integration', () => {
    it('should handle readline interface creation and cleanup', async () => {
      const mockInterface = {
        question: vi.fn(),
        close: vi.fn(),
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockInterface as any);

      mockInterface.question.mockImplementation(
        (_prompt: string, callback: (input: string) => void) => {
          callback('y');
        }
      );

      await cli.requestApproval('test_tool', { param: 'value' });

      expect(readline.createInterface).toHaveBeenCalledWith({
        input: process.stdin,
        output: process.stdout,
      });
      expect(mockInterface.close).toHaveBeenCalled();
    });

    it('should handle readline errors gracefully', async () => {
      const mockInterface = {
        question: vi.fn(),
        close: vi.fn(),
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockInterface as any);

      mockInterface.question.mockImplementation(() => {
        throw new Error('Readline error');
      });

      await expect(cli.requestApproval('test_tool', { param: 'value' })).rejects.toThrow(
        'Readline error'
      );
    });
  });

  describe('approval callback error scenarios', () => {
    it('should handle user interruption (Ctrl+C) gracefully', async () => {
      mockRl.question.mockImplementation((_prompt: string, _callback: (input: string) => void) => {
        // Simulate Ctrl+C interrupt
        throw new Error('SIGINT');
      });

      await expect(cli.requestApproval('test_tool', { param: 'value' })).rejects.toThrow('SIGINT');
    });

    it('should clean up readline interface even on errors', async () => {
      const mockInterface = {
        question: vi.fn(),
        close: vi.fn(),
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockInterface as any);

      mockInterface.question.mockImplementation(() => {
        throw new Error('Test error');
      });

      try {
        await cli.requestApproval('test_tool', { param: 'value' });
      } catch {
        // Expected to throw
      }

      expect(mockInterface.close).toHaveBeenCalled();
    });
  });

  describe('whitespace and edge cases', () => {
    it('should handle responses with whitespace', async () => {
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callback('  y  '); // Response with whitespace
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });
      expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
    });

    it('should handle empty responses by reprompting', async () => {
      let callCount = 0;
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback(''); // Empty response
        } else {
          callback('n'); // Valid response
        }
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });

      expect(result).toBe(ApprovalDecision.DENY);
      expect(mockRl.question).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple invalid responses before valid one', async () => {
      let callCount = 0;
      mockRl.question.mockImplementation((_prompt: string, callback: (input: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback('invalid1');
        } else if (callCount === 2) {
          callback('invalid2');
        } else {
          callback('a'); // Finally valid
        }
      });

      const result = await cli.requestApproval('test_tool', { param: 'value' });

      expect(result).toBe(ApprovalDecision.ALLOW_SESSION);
      expect(mockRl.question).toHaveBeenCalledTimes(3);
    });
  });
});
