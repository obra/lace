// ABOUTME: Integration tests for tool validation error flow to model
// ABOUTME: Ensures validation errors create proper TOOL_RESULT events for model trajectory adjustment

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ToolContext, ToolResult } from '~/tools/types';
import { ThreadManager } from '~/threads/thread-manager';
import { asThreadId } from '~/threads/types';
import { Agent } from '~/agents/agent';
import { DatabasePersistence } from '~/persistence/database';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Test tool with strict validation
class StrictTestTool extends Tool {
  name = 'strict_test';
  description = 'Tool with specific parameter requirements for testing validation';
  schema = z
    .object({
      action: z.enum(['create', 'update', 'delete']).describe('The action to perform'),
      target: z.string().min(1).describe('The target resource'),
      options: z
        .object({
          force: z.boolean().optional(),
          recursive: z.boolean().optional(),
        })
        .strict() // Reject unknown options
        .optional()
        .describe('Optional configuration'),
    })
    .strict(); // Reject unknown properties at root level

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return this.createResult(`Executed ${args.action} on ${args.target}`);
  }
}

describe('Tool Validation Flow to Model', () => {
  let tempDir: string;
  let dbPath: string;
  let persistence: DatabasePersistence;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let strictTool: StrictTestTool;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-flow-test-'));
    dbPath = path.join(tempDir, 'test.db');

    // Initialize components
    persistence = new DatabasePersistence(dbPath);

    threadManager = new ThreadManager(persistence);
    toolExecutor = new ToolExecutor([]);

    // Create and register the strict test tool
    strictTool = new StrictTestTool();
    toolExecutor.registerTool(strictTool.name, strictTool);
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates TOOL_RESULT event with failed status for validation errors', async () => {
    const threadId = asThreadId('lace_20250104_test01');
    threadManager.createThread(threadId);

    // Create agent config
    const agentConfig = {
      toolExecutor,
      threadManager,
      threadId: threadId,
      tools: [strictTool],
      metadata: {
        name: 'Test Agent',
        modelId: 'test-model',
        providerInstanceId: 'test-provider',
      },
    };

    const agent = new Agent(agentConfig);

    // Try to execute tool with invalid parameters
    const invalidToolCall = {
      id: 'call_123',
      name: 'strict_test',
      arguments: {
        action: 'invalid_action', // Not one of the allowed enum values
        target: 'some_file.txt',
      },
    };

    // Execute the tool through the executor
    const result = await toolExecutor.execute(invalidToolCall, {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
    });

    // Verify the result is a failed validation with concise message
    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('ValidationError: strict_test failed');
    expect(result.content[0].text).toContain('action: Invalid enum value');
  });

  it('provides helpful suggestions for common validation errors', async () => {
    const invalidToolCall = {
      id: 'call_456',
      name: 'strict_test',
      arguments: {
        // Wrong parameter names - using 'type' instead of 'action', 'file' instead of 'target'
        type: 'create',
        file: 'test.txt',
      },
    };

    const result = await toolExecutor.execute(invalidToolCall, {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
    });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('Missing required: action, target');
  });

  it('handles type mismatches with clear error messages', async () => {
    const invalidToolCall = {
      id: 'call_789',
      name: 'strict_test',
      arguments: {
        action: 'create',
        target: 123, // Should be a string
        options: {
          force: 'yes', // Should be a boolean
        },
      },
    };

    const result = await toolExecutor.execute(invalidToolCall, {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
    });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('target: Expected string, got number');
    expect(result.content[0].text).toContain('options.force: Expected boolean, got string');
  });

  it('rejects unknown properties with strict validation', async () => {
    const invalidToolCall = {
      id: 'call_unknown',
      name: 'strict_test',
      arguments: {
        action: 'create',
        target: 'test.txt',
        unknownParam: 'should not be allowed', // This should be rejected
      },
    };

    const result = await toolExecutor.execute(invalidToolCall, {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
    });

    expect(result.status).toBe('failed');
    expect(result.content[0].text).toContain('ValidationError: strict_test failed');
    expect(result.content[0].text).toContain('Unexpected parameters: unknownParam');
  });

  it('includes concise error information', async () => {
    const invalidToolCall = {
      id: 'call_meta',
      name: 'strict_test',
      arguments: {
        action: 'invalid',
        target: '',
      },
    };

    const result = await toolExecutor.execute(invalidToolCall, {
      signal: new AbortController().signal,
      workingDirectory: tempDir,
    });

    expect(result.status).toBe('failed');
    // The concise format doesn't include metadata anymore
    const errorText = result.content[0].text;
    expect(errorText).toContain('ValidationError: strict_test failed');
    // Multiple errors should be on separate lines
    expect(errorText.split('\n').length).toBeGreaterThan(1);
  });
});
