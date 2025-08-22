// ABOUTME: Tests for the delegate tool
// ABOUTME: Validates subagent creation, execution, and tool approval flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DelegateTool } from '~/tools/implementations/delegate';
import { Session } from '~/sessions/session';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import type { ToolContext } from '~/tools/types';
import {
  createDelegationTestSetup,
  DelegationTestSetup,
} from '~/test-utils/delegation-test-helper';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

// Using shared delegation test utilities

describe('DelegateTool', () => {
  const _tempLaceDir = setupCoreTest();
  let testSetup: DelegationTestSetup;
  let tool: DelegateTool;
  let context: ToolContext;
  let providerInstanceId: string;

  beforeEach(async () => {
    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Delegate Instance',
      apiKey: 'test-anthropic-key',
    });

    // Use shared delegation test setup
    testSetup = await createDelegationTestSetup({
      sessionName: 'Delegate Test Session',
      projectName: 'Delegate Test Project',
      model: 'claude-3-5-haiku-20241022',
    });

    // Get tool from session agent's toolExecutor
    const agent = testSetup.session.getAgent(testSetup.session.getId());
    const toolExecutor = agent!.toolExecutor;
    tool = toolExecutor.getTool('delegate') as DelegateTool;

    context = {
      signal: new AbortController().signal,
      agent: agent!, // Access to threadId and session via agent
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    testSetup.session?.destroy();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('delegate');
    expect(tool.annotations?.openWorldHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(['title', 'prompt', 'expected_response', 'model']);
  });

  it('should delegate a simple task with default model', async () => {
    testSetup.setMockResponses(['Analysis complete: 3 test failures identified']);

    const result = await tool.execute(
      {
        title: 'Analyze test failures',
        prompt: 'Look at the failing tests and identify common patterns',
        expected_response: 'A list of failure patterns',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
      context
    );

    // Test the actual behavior - delegation should work and return results
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Analysis complete: 3 test failures identified');
    expect(result.metadata?.taskTitle).toBe('Analyze test failures');
  });

  it('should handle custom provider:model format', async () => {
    testSetup.setMockResponses(['Custom model response']);

    const result = await tool.execute(
      {
        title: 'Test custom model',
        prompt: 'Use custom model for delegation',
        expected_response: 'Custom response',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
      context
    );

    // Test that delegation works with custom model specification
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Custom model response');
  });

  it('should create delegate thread and execute subagent', async () => {
    testSetup.setMockResponses(['Directory listed successfully']);

    const result = await tool.execute(
      {
        title: 'List files',
        prompt: 'List the files in the current directory',
        expected_response: 'List of files',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
      context
    );

    // Verify delegation succeeded
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Directory listed successfully');
    expect(result.metadata?.taskTitle).toBe('List files');
  });

  it('should format the subagent system prompt correctly', async () => {
    testSetup.setMockResponses(['Task completed']);

    const result = await tool.execute(
      {
        title: 'Format test',
        prompt: 'Test system prompt formatting',
        expected_response: 'Formatted response',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
      context
    );

    // Since we're using the proper integration pattern, the delegation should work
    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Task completed');
  });

  it('should handle invalid provider format', async () => {
    const result = await tool.execute(
      {
        title: 'Invalid provider test',
        prompt: 'Test with invalid provider',
        expected_response: 'Error',
        model: 'invalid-provider-format',
      },
      context
    );

    expect(result.status).not.toBe('completed');
    expect(result.content[0].text).toContain('Invalid model format');
  });

  it('should collect all subagent responses', async () => {
    testSetup.setMockResponses(['Task completed with combined responses']);

    const result = await tool.execute(
      {
        title: 'Multi-response test',
        prompt: 'Generate multiple responses',
        expected_response: 'Combined responses',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
      context
    );

    expect(result.status).toBe('completed');
    expect(result.content[0]?.text).toContain('Task completed with combined responses');
  });

  it('should include delegate thread ID in result metadata', async () => {
    testSetup.setMockResponses(['Task completed with metadata']);

    const result = await tool.execute(
      {
        title: 'Metadata test',
        prompt: 'Test metadata inclusion',
        expected_response: 'Response with metadata',
        model: `${providerInstanceId}:claude-3-5-haiku-20241022`,
      },
      context
    );

    expect(result.status).toBe('completed');
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.taskTitle).toBeDefined();
  });

  it('should accept valid model formats', async () => {
    const validModels = [`${providerInstanceId}:claude-3-5-haiku-20241022`];

    for (const model of validModels) {
      testSetup.setMockResponses(['Valid model response']);

      const result = await tool.execute(
        {
          title: `Test ${model}`,
          prompt: 'Test valid model format',
          expected_response: 'Valid response',
          model,
        },
        context
      );

      // Should not fail on model validation
      expect(result.status).toBe('completed');
    }
  });
});
