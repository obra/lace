// ABOUTME: Tests for queue command functionality
// ABOUTME: Tests queue display, clearing, and error handling

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { queueCommand } from '~/commands/system/queue.js';
import type { UserInterface } from '~/commands/types.js';

type MockAgent = {
  getQueueStats: MockedFunction<
    () => { queueLength: number; highPriorityCount: number; oldestMessageAge?: number }
  >;
  getQueueContents: MockedFunction<() => unknown[]>;
  clearQueue: MockedFunction<(filter?: (item: any) => boolean) => number>;
  // Add minimal properties to satisfy Agent interface
  providerName: string;
  state: string;
  threadId: string;
  sendMessage: MockedFunction<(message: string) => Promise<void>>;
  abort: MockedFunction<() => void>;
  stop: MockedFunction<() => void>;
  resumeOrCreateThread: MockedFunction<() => string>;
  replaySessionEvents: MockedFunction<() => void>;
  on: MockedFunction<(event: string, listener: Function) => void>;
  off: MockedFunction<(event: string, listener: Function) => void>;
  emit: MockedFunction<(event: string, ...args: any[]) => boolean>;
};

type MockUI = {
  agent: MockAgent;
  displayMessage: MockedFunction<(message: string) => void>;
  clearSession: MockedFunction<() => void>;
  exit: MockedFunction<() => void>;
};

describe('queueCommand', () => {
  let mockUI: MockUI;
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = {
      getQueueStats: vi.fn(),
      getQueueContents: vi.fn(),
      clearQueue: vi.fn(),
      providerName: 'mock',
      state: 'idle',
      threadId: 'test-thread',
      sendMessage: vi.fn(),
      abort: vi.fn(),
      stop: vi.fn(),
      resumeOrCreateThread: vi.fn(),
      replaySessionEvents: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    mockUI = {
      agent: mockAgent,
      displayMessage: vi.fn(),
      clearSession: vi.fn(),
      exit: vi.fn(),
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(queueCommand.name).toBe('queue');
      expect(queueCommand.description).toBe('View message queue or clear queued messages');
      expect(typeof queueCommand.execute).toBe('function');
    });
  });

  describe('queue display', () => {
    it('should show empty queue message when queue is empty', async () => {
      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 0,
        highPriorityCount: 0,
      });

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Message queue is empty');
    });

    it('should display queue contents with basic info', async () => {
      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 2,
        highPriorityCount: 0,
        oldestMessageAge: 5000,
      });

      mockAgent.getQueueContents.mockReturnValue([
        {
          id: 'msg1',
          type: 'user',
          content: 'First message',
          timestamp: new Date(),
          metadata: {},
        },
        {
          id: 'msg2',
          type: 'system',
          content: 'System notification about something important',
          timestamp: new Date(),
          metadata: { source: 'task_system' },
        },
      ]);

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      const call = mockUI.displayMessage.mock.calls[0][0];
      expect(call).toContain('📬 Message Queue (2 messages)');
      expect(call).toContain('Oldest: 5s ago');
      expect(call).toContain('1. [USER] First message');
      expect(call).toContain(
        '2. [SYSTEM] System notification about something important (task_system)'
      );
      expect(call).toContain('Use /queue clear to remove user messages from queue');
    });

    it('should display high priority count when present', async () => {
      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 3,
        highPriorityCount: 1,
      });

      mockAgent.getQueueContents.mockReturnValue([
        {
          id: 'msg1',
          type: 'user',
          content: 'Normal message',
          timestamp: new Date(),
          metadata: { priority: 'normal' },
        },
        {
          id: 'msg2',
          type: 'user',
          content: 'Urgent message',
          timestamp: new Date(),
          metadata: { priority: 'high' },
        },
        {
          id: 'msg3',
          type: 'task_notification',
          content: 'Task assigned',
          timestamp: new Date(),
        },
      ]);

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      const call = mockUI.displayMessage.mock.calls[0][0];
      expect(call).toContain('High priority: 1');
      expect(call).toContain('[HIGH] Urgent message');
    });

    it('should truncate long messages in preview', async () => {
      const longMessage = 'A'.repeat(60);

      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 1,
        highPriorityCount: 0,
      });

      mockAgent.getQueueContents.mockReturnValue([
        {
          id: 'msg1',
          type: 'user',
          content: longMessage,
          timestamp: new Date(),
        },
      ]);

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      const call = mockUI.displayMessage.mock.calls[0][0];
      expect(call).toContain('1. [USER] ' + 'A'.repeat(47) + '...');
    });

    it('should handle singular message count correctly', async () => {
      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 1,
        highPriorityCount: 0,
      });

      mockAgent.getQueueContents.mockReturnValue([
        {
          id: 'msg1',
          type: 'user',
          content: 'Single message',
          timestamp: new Date(),
        },
      ]);

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      const call = mockUI.displayMessage.mock.calls[0][0];
      expect(call).toContain('📬 Message Queue (1 message)'); // singular
    });
  });

  describe('queue clearing', () => {
    it('should clear user messages when clear argument provided', async () => {
      mockAgent.clearQueue.mockReturnValue(3);

      await queueCommand.execute('clear', mockUI as unknown as UserInterface);

      expect(mockAgent.clearQueue).toHaveBeenCalledWith(expect.any(Function));
      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Cleared 3 user messages from queue');

      // Test the filter function
      const calls = mockAgent.clearQueue.mock.calls;
      expect(calls).toHaveLength(1);
      const filterFn = calls[0]![0];
      expect(filterFn!({ type: 'user' })).toBe(true);
      expect(filterFn!({ type: 'system' })).toBe(false);
      expect(filterFn!({ type: 'task_notification' })).toBe(false);
    });

    it('should handle clearing zero messages', async () => {
      mockAgent.clearQueue.mockReturnValue(0);

      await queueCommand.execute('clear', mockUI as unknown as UserInterface);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Cleared 0 user messages from queue');
    });

    it('should handle singular message count in clear message', async () => {
      mockAgent.clearQueue.mockReturnValue(1);

      await queueCommand.execute('clear', mockUI as unknown as UserInterface);

      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Cleared 1 user message from queue'); // singular
    });

    it('should handle whitespace in clear argument', async () => {
      mockAgent.clearQueue.mockReturnValue(2);

      await queueCommand.execute('  clear  ', mockUI as unknown as UserInterface);

      expect(mockAgent.clearQueue).toHaveBeenCalled();
      expect(mockUI.displayMessage).toHaveBeenCalledWith('📬 Cleared 2 user messages from queue');
    });
  });

  describe('usage help', () => {
    it('should show usage help for invalid arguments', async () => {
      await queueCommand.execute('invalid', mockUI as unknown as UserInterface);

      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        'Usage: /queue [clear]\n  /queue      - Show queue contents\n  /queue clear - Clear user messages from queue'
      );
    });

    it('should show usage help for partial arguments', async () => {
      await queueCommand.execute('cle', mockUI as unknown as UserInterface);

      expect(mockUI.displayMessage).toHaveBeenCalledWith(
        'Usage: /queue [clear]\n  /queue      - Show queue contents\n  /queue clear - Clear user messages from queue'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle missing oldestMessageAge', async () => {
      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 1,
        highPriorityCount: 0,
        // oldestMessageAge is undefined
      });

      mockAgent.getQueueContents.mockReturnValue([
        {
          id: 'msg1',
          type: 'user',
          content: 'Message',
          timestamp: new Date(),
        },
      ]);

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      const call = mockUI.displayMessage.mock.calls[0][0];
      expect(call).toContain('📬 Message Queue (1 message)');
      expect(call).not.toContain('Oldest:');
    });

    it('should handle messages without metadata', async () => {
      mockAgent.getQueueStats.mockReturnValue({
        queueLength: 1,
        highPriorityCount: 0,
      });

      mockAgent.getQueueContents.mockReturnValue([
        {
          id: 'msg1',
          type: 'user',
          content: 'Message without metadata',
          timestamp: new Date(),
          // no metadata field
        },
      ]);

      await queueCommand.execute('', mockUI as unknown as UserInterface);

      const call = mockUI.displayMessage.mock.calls[0][0];
      expect(call).toContain('1. [USER] Message without metadata');
      expect(call).not.toContain('[HIGH]');
      // Should not contain source parentheses for this specific message
      expect(call).not.toContain('Message without metadata (');
    });
  });
});
