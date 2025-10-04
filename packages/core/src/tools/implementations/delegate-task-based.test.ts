// ABOUTME: Integration tests for task-based delegate tool implementation
// ABOUTME: Tests real delegation flow using Session, Project, and TaskManager integration

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DelegateTool } from './delegate';
import { ToolContext } from '@lace/core/tools/types';
import { setupCoreTest, cleanupSession } from '@lace/core/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '@lace/core/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/core/test-utils/provider-instances';
import {
  createDelegationTestSetup,
  DelegationTestSetup,
} from '@lace/core/test-utils/delegation-test-helper';
import { join } from 'path';
import { mkdirSync } from 'fs';

// Using shared delegation test utilities

describe('Task-Based DelegateTool Integration', () => {
  const tempLaceDirContext = setupCoreTest();
  let tempProjectDir: string;
  let testSetup: DelegationTestSetup;
  let delegateTool: DelegateTool;
  let context: ToolContext;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create temp project directory
    tempProjectDir = join(tempLaceDirContext.tempDir, 'test-delegation');
    mkdirSync(tempProjectDir, { recursive: true });

    // Use shared delegation test setup with MSW
    testSetup = await createDelegationTestSetup({
      sessionName: 'Task-Based Delegate Test Session',
      projectName: 'Task-Based Test Project',
      projectPath: tempProjectDir,
      model: 'claude-3-5-haiku-20241022',
    });

    // Create delegate tool and inject TaskManager
    delegateTool = new DelegateTool();

    const agent = testSetup.session.getAgent(testSetup.session.getId())!;

    context = {
      signal: new AbortController().signal,
      agent, // Access to threadId and session via agent
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (testSetup?.session) {
      await cleanupSession(testSetup.session);
    }

    // Use the cleanup function from test setup
    if (testSetup?.cleanup) {
      await testSetup.cleanup();
    }

    // Test cleanup handled by setupCoreTest
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  describe('Integration Tests', () => {
    it('should create task and wait for completion via real delegation', async () => {
      // Set up mock to respond with task completion
      testSetup.setMockResponses(['Integration test completed successfully']);

      const result = await delegateTool.execute(
        {
          tasks: [
            {
              title: 'Integration Test Task',
              prompt: 'Complete this integration test',
              expected_response: 'Test completed successfully',
              assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
            },
          ],
        },
        context
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('completed');
      expect(result.content[0].text).toContain('Integration test completed successfully');
    }, 15000); // Increase timeout to 15 seconds

    it('should handle parallel delegations without conflicts', async () => {
      // Set up mock to cycle through different responses for parallel tasks
      testSetup.setMockResponses([
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
            tasks: [
              {
                title: 'Task 1',
                prompt: 'First parallel task',
                expected_response: 'Task result',
                assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
              },
            ],
          },
          context
        ),
        tool2.execute(
          {
            tasks: [
              {
                title: 'Task 2',
                prompt: 'Second parallel task',
                expected_response: 'Task result',
                assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
              },
            ],
          },
          context
        ),
        tool3.execute(
          {
            tasks: [
              {
                title: 'Task 3',
                prompt: 'Third parallel task',
                expected_response: 'Task result',
                assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
              },
            ],
          },
          context
        ),
      ]);

      // Assert all succeeded independently
      expect(result1.status).toBe('completed');
      expect(result2.status).toBe('completed');
      expect(result3.status).toBe('completed');

      // Verify each got a different response (showing proper cycling)
      const responses = [result1.content[0].text, result2.content[0].text, result3.content[0].text];

      // All should contain "parallel task" or similar pattern from responses
      responses.forEach((response) => {
        expect(response).toContain('parallel task');
      });

      // At least some should be different (not all identical)
      const uniqueResponses = new Set(responses);
      expect(uniqueResponses.size).toBeGreaterThan(1);
    });

    it('should handle task failures gracefully', async () => {
      // Use built-in blocked task response setup
      testSetup.setupBlockedTaskResponse();

      const result = await delegateTool.execute(
        {
          tasks: [
            {
              title: 'This will be blocked',
              prompt: 'This task will fail',
              expected_response: 'Error',
              assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
            },
          ],
        },
        context
      );

      expect(result.status).toBe('failed');
      expect(result.content[0].text).toContain('blocked');
    });

    it('should handle aborted signal during execution', async () => {
      const abortController = new AbortController();
      abortController.abort(); // Signal is already aborted

      const abortedContext: ToolContext = {
        signal: abortController.signal,
        agent: context.agent,
      };

      const result = await delegateTool.execute(
        {
          tasks: [
            {
              title: 'Aborted Task',
              prompt: 'This task should be aborted',
              expected_response: 'Should not complete',
              assignedTo: `new:lace;${providerInstanceId}:claude-3-5-haiku-20241022`,
            },
          ],
        },
        abortedContext
      );

      expect(result.status).toBe('aborted');
    });
  });
});
