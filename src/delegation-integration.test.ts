// ABOUTME: Comprehensive integration test for delegation functionality
// ABOUTME: Tests end-to-end delegation workflow including UI component rendering

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { DelegateTool } from '~/tools/implementations/delegate';
import { logger } from '~/utils/logger';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ProviderRegistry } from '~/providers/registry';
import { ApprovalDecision } from '~/tools/approval-types';

// Mock provider that responds with task completion tool calls
class MockProvider extends BaseMockProvider {
  constructor() {
    super({});
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  get contextWindow(): number {
    return 200000; // Large context window for testing
  }

  get maxOutputTokens(): number {
    return 4096;
  }

  async createResponse(messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    // Look for task assignment message (same pattern as working tests)
    const taskMessage = messages.find(
      (m) =>
        m.content &&
        typeof m.content === 'string' &&
        m.content.includes('You have been assigned task')
    );

    if (taskMessage) {
      // Extract task ID from task assignment message
      const match = taskMessage.content.match(/assigned task '([^']+)'/);
      const taskId = match ? match[1] : 'unknown';

      const response = {
        content: 'I will analyze the project structure and provide findings.',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        toolCalls: [
          {
            id: 'complete_task_call',
            name: 'task_complete',
            input: {
              id: taskId,
              message:
                'Successfully analyzed the project structure and found key patterns: TypeScript configuration, modular architecture, and comprehensive testing setup.',
            },
          },
        ],
      };
      return Promise.resolve(response);
    }

    return Promise.resolve({
      content: 'Mock response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      toolCalls: [],
    });
  }
}

describe('Delegation Integration Tests', () => {
  const _tempLaceDir = setupCoreTest();
  let threadManager: ThreadManager;
  let session: Session;
  let project: Project;
  let mockProvider: MockProvider;
  let providerInstanceId: string;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Delegation Instance',
      apiKey: 'test-anthropic-key',
    });

    // Use simpler provider defaults approach instead of setupTestProviderInstances
    mockProvider = new MockProvider();

    // TODO: Update this test to use real provider instances with mocked responses
    // instead of mocking the internal createProvider method. This would involve:
    // 1. Creating a test provider instance using createTestProviderInstance
    // 2. Mocking the HTTP responses at the network level
    // 3. Or creating a custom test provider type that can be registered
    // For now, we're using the @internal createProvider method
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(
      (_name: string, _config?: unknown) => {
        return mockProvider;
      }
    );

    // Mock the ProviderRegistry constructor to return our mock registry
    vi.spyOn(ProviderRegistry.prototype, 'createProvider').mockImplementation(() => mockProvider);

    // Set up test environment using Session/Project pattern for proper tool injection
    threadManager = new ThreadManager();
    project = Project.create(
      'Test Project',
      '/tmp/test-delegation',
      'Test project for delegation integration',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    session = Session.create({
      name: 'Delegation Integration Test Session',
      projectId: project.getId(),
      approvalCallback: {
        requestApproval: async () => Promise.resolve(ApprovalDecision.ALLOW_ONCE), // Auto-approve all tool calls for testing
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    session?.destroy();
    threadManager.close();
    // Test cleanup handled by setupCoreTest
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  it('should create hierarchical delegate thread IDs', () => {
    const mainThreadId = threadManager.generateThreadId();
    threadManager.createThread(mainThreadId);

    // Generate first delegate
    const delegate1 = threadManager.generateDelegateThreadId(mainThreadId);
    expect(delegate1).toBe(`${mainThreadId}.1`);

    // Create the delegate thread so it appears in queries
    threadManager.createThread(delegate1);
    threadManager.addEvent(delegate1, 'AGENT_MESSAGE', 'test');

    // Generate second delegate
    const delegate2 = threadManager.generateDelegateThreadId(mainThreadId);
    expect(delegate2).toBe(`${mainThreadId}.2`);

    // Create and add event to delegate1 so it can have sub-delegates
    threadManager.createThread(delegate2);
    threadManager.addEvent(delegate2, 'AGENT_MESSAGE', 'test');

    // Generate sub-delegate from first delegate
    const subDelegate1 = threadManager.generateDelegateThreadId(delegate1);
    expect(subDelegate1).toBe(`${mainThreadId}.1.1`);
  });

  it('should query delegate threads correctly', () => {
    const mainThreadId = threadManager.generateThreadId();
    threadManager.createThread(mainThreadId);

    // Create delegate threads
    const delegate1 = threadManager.generateDelegateThreadId(mainThreadId);
    const delegate2 = threadManager.generateDelegateThreadId(mainThreadId);

    threadManager.createThread(delegate1);
    threadManager.createThread(delegate2);

    // Add events to each thread
    threadManager.addEvent(mainThreadId, 'USER_MESSAGE', 'Main thread message');
    threadManager.addEvent(delegate1, 'AGENT_MESSAGE', 'Delegate 1 message');
    threadManager.addEvent(delegate2, 'AGENT_MESSAGE', 'Delegate 2 message');

    // Test multi-thread querying
    const allEvents = threadManager.getMainAndDelegateEvents(mainThreadId);
    expect(allEvents).toHaveLength(3);

    // Events should be sorted chronologically
    expect(allEvents[0].data).toBe('Main thread message');
    expect(allEvents[1].data).toBe('Delegate 1 message');
    expect(allEvents[2].data).toBe('Delegate 2 message');
  });

  it('should handle nested delegations', () => {
    const mainThread = 'lace_20250101_abc123';
    const delegate1 = threadManager.generateDelegateThreadId(mainThread);
    const delegate2 = threadManager.generateDelegateThreadId(delegate1);
    const delegate3 = threadManager.generateDelegateThreadId(delegate2);

    expect(delegate1).toBe('lace_20250101_abc123.1');
    expect(delegate2).toBe('lace_20250101_abc123.1.1');
    expect(delegate3).toBe('lace_20250101_abc123.1.1.1');

    // All should be detected as delegate threads
    expect(delegate1.includes('.')).toBe(true);
    expect(delegate2.includes('.')).toBe(true);
    expect(delegate3.includes('.')).toBe(true);
    expect(mainThread.includes('.')).toBe(false);
  });

  it('should handle concurrent delegations', () => {
    const mainThread = threadManager.generateThreadId();
    threadManager.createThread(mainThread);

    // Create first delegate
    const delegate1 = threadManager.generateDelegateThreadId(mainThread);
    threadManager.createThread(delegate1);
    threadManager.addEvent(delegate1, 'AGENT_MESSAGE', 'test1');

    // Create second delegate
    const delegate2 = threadManager.generateDelegateThreadId(mainThread);
    threadManager.createThread(delegate2);
    threadManager.addEvent(delegate2, 'AGENT_MESSAGE', 'test2');

    // Create third delegate
    const delegate3 = threadManager.generateDelegateThreadId(mainThread);

    expect(delegate1).toBe(`${mainThread}.1`);
    expect(delegate2).toBe(`${mainThread}.2`);
    expect(delegate3).toBe(`${mainThread}.3`);

    // All should be unique
    const delegates = [delegate1, delegate2, delegate3];
    const uniqueDelegates = new Set(delegates);
    expect(uniqueDelegates.size).toBe(3);
  });

  it('should integrate delegation with DelegateTool', async () => {
    // Get delegate tool from session (it will have proper TaskManager injection)
    const agent = session.getAgent(session.getId());
    if (!agent) {
      throw new Error('Failed to get agent from session');
    }

    const toolExecutor = agent.toolExecutor;
    const delegateToolInstance = toolExecutor.getTool('delegate') as DelegateTool;

    // Test delegation using the real DelegateTool with provider mocking
    const delegateInput = {
      title: 'Code Analysis',
      prompt: 'Analyze the project structure and identify key patterns',
      expected_response: 'Brief summary of project structure',
      model: 'anthropic:claude-3-5-haiku-20241022',
    };

    const result = await delegateToolInstance.execute(delegateInput, {
      agent, // Access to threadId via agent.threadId and session via agent.getFullSession()
    });

    if (result.isError) {
      logger.error('Delegation failed', { content: result.content });
    }

    // The delegation should succeed with our mock provider handling task completion
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Successfully analyzed the project structure');
    expect(result.metadata?.taskTitle).toBe('Code Analysis');
  });
});
