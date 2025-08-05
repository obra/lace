// ABOUTME: Integration tests for task-based delegate tool implementation
// ABOUTME: Tests real delegation flow using Session, Project, and TaskManager integration

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { ToolContext } from '~/tools/types';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import {
  createDelegationTestSetup,
  DelegationTestSetup,
} from '~/test-utils/delegation-test-helper';
import { DelegationMockProvider } from '~/test-utils/delegation-mock-provider';
import { ProviderRegistry } from '~/providers/registry';
import { ProviderMessage, ProviderResponse, ProviderToolCall } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';

// Using shared delegation test utilities

describe('Task-Based DelegateTool Integration', () => {
  const _tempDirContext = useTempLaceDir();
  let testSetup: DelegationTestSetup;
  let delegateTool: DelegateTool;
  let context: ToolContext;

  beforeEach(async () => {
    setupTestPersistence();
    setupTestProviderDefaults();

    // Use shared delegation test setup
    testSetup = await createDelegationTestSetup({
      sessionName: 'Task-Based Delegate Test Session',
      projectName: 'Task-Based Test Project',
      model: 'claude-sonnet-4-20250514',
    });

    // Create delegate tool and inject TaskManager
    delegateTool = new DelegateTool();

    context = {
      threadId: testSetup.session.getId(),
      session: testSetup.session, // TaskManager accessed via session.getTaskManager()
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    testSetup?.session?.destroy();
    await cleanupTestProviderInstances(['test-anthropic', 'test-openai']);
    teardownTestPersistence();
    cleanupTestProviderDefaults();
  });

  describe('Integration Tests', () => {
    it('should create task and wait for completion via real delegation', async () => {
      // Set up mock provider to respond with task completion
      testSetup.mockProvider.setMockResponses(['Integration test completed successfully']);

      const result = await delegateTool.execute(
        {
          title: 'Integration Test Task',
          prompt: 'Complete this integration test',
          expected_response: 'Test completed successfully',
          model: 'anthropic:claude-3-5-haiku-20241022',
        },
        context
      );

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Integration test completed successfully');
    }, 15000); // Increase timeout to 15 seconds

    it('should handle parallel delegations without conflicts', async () => {
      // Use the existing mock provider from testSetup and configure responses
      testSetup.mockProvider.setMockResponses([
        'First parallel task completed',
        'Second parallel task completed',
        'Third parallel task completed',
      ]);

      // Create three separate delegate tool instances with same TaskManager
      const tool1 = new DelegateTool();
      const tool2 = new DelegateTool();
      const tool3 = new DelegateTool();

      // Execute all three delegations in parallel
      const [result1, result2, result3] = await Promise.all([
        tool1.execute(
          {
            title: 'Task 1',
            prompt: 'First task',
            expected_response: 'Task result',
            model: 'anthropic:claude-sonnet-4-20250514',
          },
          context
        ),
        tool2.execute(
          {
            title: 'Task 2',
            prompt: 'Second task',
            expected_response: 'Task result',
            model: 'anthropic:claude-sonnet-4-20250514',
          },
          context
        ),
        tool3.execute(
          {
            title: 'Task 3',
            prompt: 'Third task',
            expected_response: 'Task result',
            model: 'anthropic:claude-sonnet-4-20250514',
          },
          context
        ),
      ]);

      // Assert all succeeded independently
      expect(result1.isError).toBe(false);
      expect(result2.isError).toBe(false);
      expect(result3.isError).toBe(false);

      // Verify each got a different response (showing proper cycling)
      const responses = [result1.content[0].text, result2.content[0].text, result3.content[0].text];

      // All should contain "parallel task" but be different
      responses.forEach((response) => {
        expect(response).toContain('parallel task');
      });

      // At least some should be different (not all identical)
      const uniqueResponses = new Set(responses);
      expect(uniqueResponses.size).toBeGreaterThan(1);
    });

    it('should handle task failures gracefully', async () => {
      // Override the mock provider to trigger a task update to "blocked" status
      const originalCreateResponse = testSetup.mockProvider.createResponse.bind(
        testSetup.mockProvider
      );

      testSetup.mockProvider.createResponse = async (
        messages: ProviderMessage[],
        tools: Tool[]
      ): Promise<ProviderResponse> => {
        // Look for task assignment message to extract task ID
        const taskAssignmentMessage = messages.find(
          (m) =>
            m.content &&
            typeof m.content === 'string' &&
            m.content.includes('You have been assigned task')
        );

        if (taskAssignmentMessage && typeof taskAssignmentMessage.content === 'string') {
          const match = taskAssignmentMessage.content.match(/assigned task '([^']+)'/);
          const taskId = match ? match[1] : 'unknown';

          // Create a tool call to update task to blocked status instead of completing it
          const toolCall: ProviderToolCall = {
            id: 'task_update_call',
            name: 'task_update',
            input: {
              taskId: taskId,
              status: 'blocked',
            },
          };

          return Promise.resolve({
            content: `I encountered an issue and cannot complete this task.`,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            toolCalls: [toolCall],
          });
        }

        // Fall back to original behavior for non-task messages
        return originalCreateResponse(messages, tools);
      };

      const result = await delegateTool.execute(
        {
          title: 'This will be blocked',
          prompt: 'This task will fail',
          expected_response: 'Error',
          model: 'anthropic:claude-3-5-haiku-20241022',
        },
        context
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('blocked');
    });
  });
});
