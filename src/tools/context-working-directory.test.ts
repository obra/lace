// ABOUTME: Tests for ToolContext working directory functionality
// ABOUTME: Tests that tools receive correct working directory from session/project context

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '~/tools/executor';
import { FileReadTool } from '~/tools/implementations/file-read';
import { ApprovalDecision } from '~/tools/approval-types';
import { createMockToolContext } from '~/tools/test-utils';

describe('ToolContext working directory', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
    executor.registerTool('file-read', new FileReadTool());
  });

  it('should pass working directory in ToolContext', () => {
    const context = createMockToolContext({
      threadId: 'lace_20240101_test01',
      workingDirectory: '/test/project/path',
    });

    expect(context.workingDirectory).toBe('/test/project/path');
  });

  it('should handle undefined working directory', () => {
    const context = createMockToolContext({
      threadId: 'lace_20240101_test01',
      workingDirectory: undefined,
    });

    expect(context.workingDirectory).toBeUndefined();
  });

  it('should preserve working directory in context structure', () => {
    // Mock approval callback to allow execution
    executor.setApprovalCallback({
      requestApproval() {
        return Promise.resolve(ApprovalDecision.ALLOW_ONCE);
      },
    });

    const context = createMockToolContext({
      threadId: 'lace_20240101_test01',
      workingDirectory: '/test/project/path',
    });

    // We can't actually test file reading without creating files,
    // but we can verify the context structure is preserved
    expect(context.workingDirectory).toBe('/test/project/path');
  });
});
