// ABOUTME: Tests for agent command handling including /compact
// ABOUTME: Validates slash command detection and processing in agent sendMessage

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ApprovalDecision } from '~/tools/types';

// Mock provider for testing command handling
class MockProvider extends BaseMockProvider {
  providerName = 'mock-provider';

  constructor() {
    super({});
  }

  createResponse = vi.fn().mockResolvedValue({
    content: 'Mock response',
    toolCalls: [],
  });

  get supportsStreaming() {
    return false;
  }
}

describe('Agent command handling', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    toolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });

    const provider = new MockProvider();
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
  });

  it('should handle /compact command', async () => {
    // Add some events first to make compaction meaningful
    threadManager.addEvent({
      type: 'USER_MESSAGE',
      threadId: agent.threadId,
      data: 'Hello',
    });
    threadManager.addEvent({
      type: 'AGENT_MESSAGE',
      threadId: agent.threadId,
      data: {
        content: 'Hi there! How can I help you today?',
      },
    });

    // Spy on the compact method (we'll implement this)
    const compactSpy = vi.spyOn(agent, 'compact').mockResolvedValue();

    // Send compact command
    await agent.sendMessage('/compact');

    // Should trigger compaction
    expect(compactSpy).toHaveBeenCalledWith(agent.threadId);

    // Should not call provider for /compact commands
    expect(agent['_provider']?.createResponse).not.toHaveBeenCalled();
  });

  it('should handle normal messages when not a command', async () => {
    // Send normal message
    await agent.sendMessage('Hello world');

    // Should call provider for normal messages
    expect(agent['_provider']?.createResponse).toHaveBeenCalled();
  });

  it('should emit compaction events during compaction', async () => {
    const compactionStartSpy = vi.fn();
    const compactionCompleteSpy = vi.fn();

    agent.on('compaction_start', compactionStartSpy);
    agent.on('compaction_complete', compactionCompleteSpy);

    // Mock compact method to resolve successfully
    vi.spyOn(agent, 'compact').mockResolvedValue();

    await agent.sendMessage('/compact');

    expect(compactionStartSpy).toHaveBeenCalled();
    expect(compactionCompleteSpy).toHaveBeenCalled();
  });

  it('should handle compact command errors gracefully', async () => {
    const errorSpy = vi.fn();
    agent.on('error', errorSpy);

    // Mock compact method to throw an error
    const compactError = new Error('Compaction failed');
    vi.spyOn(agent, 'compact').mockRejectedValue(compactError);

    await agent.sendMessage('/compact');

    expect(errorSpy).toHaveBeenCalledWith({
      error: compactError,
      context: { operation: 'compact', threadId: agent.threadId },
    });
  });
});
