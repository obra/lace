// ABOUTME: CLI integration tests for session management and argument parsing
// ABOUTME: Tests the main CLI functions without starting the interactive loop

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startSession, handleGracefulShutdown } from '../threads/session.js';
import { ThreadManager } from '../threads/thread-manager.js';
import * as laceDir from '../config/lace-dir.js';

describe('CLI Integration', () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `lace-cli-test-${Date.now()}.db`);
    vi.spyOn(laceDir, 'getLaceDbPath').mockReturnValue(tempDbPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('session management', () => {
    it('should start new session by default', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { threadManager, threadId } = await startSession([]);

      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(threadManager.getCurrentThreadId()).toBe(threadId);

      await threadManager.close();
      vi.restoreAllMocks();
    });

    it('should continue session with --continue flag', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create first session
      const { threadManager: manager1, threadId: id1 } = await startSession([]);
      manager1.addEvent(id1, 'USER_MESSAGE', 'Hello world');
      await manager1.saveCurrentThread();
      await manager1.close();

      // Continue session
      const { threadManager: manager2, threadId: id2 } = await startSession(['--continue']);

      expect(id2).toBe(id1);
      const events = manager2.getEvents(id2);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('Hello world');

      await manager2.close();
      vi.restoreAllMocks();
    });

    it('should continue latest session with --continue (no ID)', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create first session
      const { threadManager: manager1, threadId: id1 } = await startSession([]);
      manager1.addEvent(id1, 'USER_MESSAGE', 'First session');
      await manager1.saveCurrentThread();
      await manager1.close();

      // Create second session (this becomes the latest)
      const { threadManager: manager2, threadId: id2 } = await startSession([]);
      manager2.addEvent(id2, 'USER_MESSAGE', 'Latest session');
      await manager2.saveCurrentThread();
      await manager2.close();

      // Continue without specifying ID - should get the latest (id2)
      const { threadManager: manager3, threadId: continuedId } = await startSession(['--continue']);

      expect(continuedId).toBe(id2); // Should be the latest session
      expect(manager3.getEvents(continuedId)[0].data).toBe('Latest session');

      await manager3.close();
      vi.restoreAllMocks();
    });

    it('should continue specific session with --continue and ID', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create multiple sessions
      const { threadManager: manager1, threadId: id1 } = await startSession([]);
      manager1.addEvent(id1, 'USER_MESSAGE', 'Session 1');
      await manager1.saveCurrentThread();
      await manager1.close();

      const { threadManager: manager2, threadId: id2 } = await startSession([]);
      manager2.addEvent(id2, 'USER_MESSAGE', 'Session 2');
      await manager2.saveCurrentThread();
      await manager2.close();

      // Continue first session specifically
      const { threadManager: manager3, threadId: id3 } = await startSession(['--continue', id1]);

      expect(id3).toBe(id1);
      expect(manager3.getEvents(id3)[0].data).toBe('Session 1');

      await manager3.close();
      vi.restoreAllMocks();
    });

    it('should handle graceful shutdown', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { threadManager, threadId } = await startSession([]);
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');

      await handleGracefulShutdown(threadManager);

      // Verify session was saved
      const newManager = new ThreadManager(tempDbPath);
      const loadedThread = await newManager.loadThread(threadId);
      expect(loadedThread.events).toHaveLength(1);
      expect(loadedThread.events[0].data).toBe('Test message');

      await newManager.close();
      vi.restoreAllMocks();
    });
  });

  describe('argument parsing', () => {
    it('should handle empty arguments', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { threadManager, threadId } = await startSession([]);

      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(threadManager.getCurrentThreadId()).toBe(threadId);

      await threadManager.close();
      vi.restoreAllMocks();
    });

    it('should handle --prompt arguments without starting interactive mode', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Test that --prompt doesn't interfere with session creation
      const { threadManager, threadId } = await startSession(['--prompt', 'test message']);

      // Should still create a valid session
      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(threadManager.getCurrentThreadId()).toBe(threadId);

      await threadManager.close();
      vi.restoreAllMocks();
    });

    it('should support multi-turn conversations using --prompt with --continue', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Turn 1: Start new conversation with --prompt
      const { threadManager: manager1, threadId } = await startSession([]);
      // Simulate what --prompt would do: add user message
      manager1.addEvent(threadId, 'USER_MESSAGE', 'What is 2+2?');
      manager1.addEvent(threadId, 'AGENT_MESSAGE', '2+2 equals 4.');
      await manager1.saveCurrentThread();
      await manager1.close();

      // Turn 2: Continue conversation with --continue and --prompt that references the previous answer
      const { threadManager: manager2, threadId: continuedId } = await startSession([
        '--continue',
        threadId,
      ]);

      expect(continuedId).toBe(threadId);

      // Should have loaded previous conversation
      let events = manager2.getEvents(continuedId);
      expect(events).toHaveLength(2); // Original user message + agent response
      expect(events[0].data).toBe('What is 2+2?');
      expect(events[1].data).toBe('2+2 equals 4.');

      // Simulate what --prompt would do: add new user message that depends on previous context
      manager2.addEvent(continuedId, 'USER_MESSAGE', 'Now multiply that by 3');
      manager2.addEvent(continuedId, 'AGENT_MESSAGE', '4 * 3 = 12');
      await manager2.saveCurrentThread();
      await manager2.close();

      // Turn 3: Continue again with another contextual prompt
      const { threadManager: manager3, threadId: finalId } = await startSession([
        '--continue',
        threadId,
      ]);

      expect(finalId).toBe(threadId);

      // Should have full conversation history loaded
      let finalEvents = manager3.getEvents(finalId);
      expect(finalEvents).toHaveLength(4); // All previous messages from turns 1 & 2

      // Simulate what --prompt would do: add new user message that references the entire conversation
      manager3.addEvent(finalId, 'USER_MESSAGE', 'What was my original question?');

      // Should have full conversation history available for context
      finalEvents = manager3.getEvents(finalId);
      expect(finalEvents).toHaveLength(5); // All previous messages + new user message
      expect(finalEvents[0].data).toBe('What is 2+2?');
      expect(finalEvents[1].data).toBe('2+2 equals 4.');
      expect(finalEvents[2].data).toBe('Now multiply that by 3');
      expect(finalEvents[3].data).toBe('4 * 3 = 12');
      expect(finalEvents[4].data).toBe('What was my original question?');

      await manager3.close();
      vi.restoreAllMocks();
    });

    it('should handle unknown arguments gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { threadManager, threadId } = await startSession(['--unknown', 'arg']);

      // Should start new session when unknown args are passed
      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);

      await threadManager.close();
      vi.restoreAllMocks();
    });

    it('should handle malformed thread IDs', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { threadManager, threadId } = await startSession(['--continue', 'invalid_thread_id']);

      // Should start new session when invalid ID provided
      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(threadId).not.toBe('invalid_thread_id');

      await threadManager.close();
      vi.restoreAllMocks();
    });
  });

  describe('thread persistence', () => {
    it('should maintain thread state across sessions', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Session 1: Create conversation
      const { threadManager: manager1, threadId } = await startSession([]);
      manager1.addEvent(threadId, 'USER_MESSAGE', 'What files are here?');
      manager1.addEvent(threadId, 'AGENT_MESSAGE', 'Let me check the files');
      manager1.addEvent(threadId, 'TOOL_CALL', {
        toolName: 'bash',
        input: { command: 'ls' },
        callId: 'call_123',
      });
      manager1.addEvent(threadId, 'TOOL_RESULT', {
        callId: 'call_123',
        output: 'file1.txt\nfile2.txt',
        success: true,
      });
      await manager1.close();

      // Session 2: Resume and continue
      const { threadManager: manager2, threadId: resumedId } = await startSession([
        '--continue',
        threadId,
      ]);

      expect(resumedId).toBe(threadId);
      const events = manager2.getEvents(resumedId);
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe('USER_MESSAGE');
      expect(events[1].type).toBe('AGENT_MESSAGE');
      expect(events[2].type).toBe('TOOL_CALL');
      expect(events[3].type).toBe('TOOL_RESULT');

      // Add more to conversation
      manager2.addEvent(resumedId, 'USER_MESSAGE', 'What about hidden files?');

      const finalEvents = manager2.getEvents(resumedId);
      expect(finalEvents).toHaveLength(5);

      await manager2.close();
      vi.restoreAllMocks();
    });

    it('should handle database errors gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // Use an invalid database path to trigger errors
      const invalidPath = '/invalid/path/database.db';
      vi.spyOn(laceDir, 'getLaceDbPath').mockReturnValue(invalidPath);

      // Should still start (graceful degradation)
      const { threadManager, threadId } = await startSession([]);

      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);

      // Should handle events in memory even if persistence fails
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');
      const events = threadManager.getEvents(threadId);
      expect(events).toHaveLength(1);

      await threadManager.close();
      vi.restoreAllMocks();
    });
  });

  describe('auto-save functionality', () => {
    it('should enable auto-save on session start', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { threadManager, threadId } = await startSession([]);

      // Add an event
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Auto-save test');

      // Wait a moment for potential auto-save
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify data persists
      const newManager = new ThreadManager(tempDbPath);
      const loadedThread = await newManager.loadThread(threadId);
      expect(loadedThread.events).toHaveLength(1);
      expect(loadedThread.events[0].data).toBe('Auto-save test');

      await threadManager.close();
      await newManager.close();
      vi.restoreAllMocks();
    });
  });
});
