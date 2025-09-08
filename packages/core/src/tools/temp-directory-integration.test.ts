// ABOUTME: Integration tests for temp directory functionality across all layers
// ABOUTME: Tests the complete flow from process temp to tool-call directories

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getProcessTempDir, clearProcessTempDirCache } from '~/config/lace-dir';
import { Project } from '~/projects/project';
import { Session } from '~/sessions/session';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { z } from 'zod';
import { existsSync } from 'fs';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ToolContext, ToolResult } from '~/tools/types';
import { ApprovalDecision } from '~/tools/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';

// Test tool for integration testing
class IntegrationTestTool extends Tool {
  name = 'integration_test_tool';
  description = 'Tool for testing full temp directory integration';
  schema = z.object({
    content: z.string(),
  });

  private capturedContext?: ToolContext;

  protected async executeValidated(
    args: z.infer<typeof this.schema>,
    context: ToolContext
  ): Promise<ToolResult> {
    this.capturedContext = context;
    return Promise.resolve(this.createResult(`Integration test: ${args.content}`));
  }

  public getCapturedContext(): ToolContext | undefined {
    return this.capturedContext;
  }
}

describe('Temp Directory Integration', () => {
  const tempLaceDirContext = setupCoreTest();
  let toolExecutor: ToolExecutor;
  let integrationTool: IntegrationTestTool;
  let session: Session;
  let project: Project;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Integration Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create real project and session
    project = Project.create(
      'Integration Test Project',
      tempLaceDirContext.tempDir,
      'Project for integration testing',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    session = Session.create({
      name: 'Integration Test Session',
      projectId: project.getId(),
    });

    toolExecutor = new ToolExecutor();
    integrationTool = new IntegrationTestTool();
    toolExecutor.registerTool(integrationTool.name, integrationTool);
    toolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });
    clearProcessTempDirCache();
  });

  afterEach(async () => {
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
  });

  it('should create proper directory hierarchy through ToolExecutor', async () => {
    const agent = session.getAgent(session.getId())!;

    const context: ToolContext = {
      signal: new AbortController().signal,
      agent,
    };

    await toolExecutor.executeTool(
      {
        id: 'test-hierarchy',
        name: integrationTool.name,
        arguments: { content: 'test' },
      },
      context
    );

    // Tool should have received proper temp directory context
    const receivedContext = integrationTool.getCapturedContext();
    expect(receivedContext).toBeDefined();

    // Verify the hierarchy exists - we can verify the paths contain the expected structure
    const toolTempDir = receivedContext!.toolTempDir!;
    const projectTempDir = Project.getProjectTempDir(project.getId());
    const processTempDir = getProcessTempDir();

    // Verify directory hierarchy
    expect(toolTempDir).toContain(`session-${session.getId()}`);
    expect(toolTempDir).toContain(`project-${project.getId()}`);
    expect(toolTempDir).toContain(projectTempDir);
    expect(toolTempDir).toContain(processTempDir);

    // Verify all directories exist
    expect(existsSync(toolTempDir)).toBe(true);
    expect(existsSync(projectTempDir)).toBe(true);
    expect(existsSync(processTempDir)).toBe(true);
  });

  it('should handle file operations through ToolExecutor', async () => {
    const agent = session.getAgent(session.getId())!;

    const context: ToolContext = {
      signal: new AbortController().signal,
      agent,
    };

    await toolExecutor.executeTool(
      {
        id: 'test-file-ops',
        name: integrationTool.name,
        arguments: { content: 'test content' },
      },
      context
    );

    const receivedContext = integrationTool.getCapturedContext();
    const toolTempDir = receivedContext!.toolTempDir!;

    // Write test content to files in the temp directory
    const stdoutFile = join(toolTempDir, 'stdout.txt');
    const stderrFile = join(toolTempDir, 'stderr.txt');
    const combinedFile = join(toolTempDir, 'combined.txt');

    writeFileSync(stdoutFile, 'stdout content');
    writeFileSync(stderrFile, 'stderr content');
    writeFileSync(combinedFile, 'combined content');

    // Verify files exist and have correct content
    expect(readFileSync(stdoutFile, 'utf-8')).toBe('stdout content');
    expect(readFileSync(stderrFile, 'utf-8')).toBe('stderr content');
    expect(readFileSync(combinedFile, 'utf-8')).toBe('combined content');
  });

  it('should maintain stability across ToolExecutor instances', async () => {
    const agent = session.getAgent(session.getId())!;

    const context: ToolContext = {
      signal: new AbortController().signal,
      agent,
    };

    // Execute with first ToolExecutor instance
    await toolExecutor.executeTool(
      {
        id: 'test-stability-1',
        name: integrationTool.name,
        arguments: { content: 'test1' },
      },
      context
    );
    const paths1 = integrationTool.getCapturedContext()!.toolTempDir!;

    // Create new ToolExecutor instance and execute again
    const newToolExecutor = new ToolExecutor();
    const newIntegrationTool = new IntegrationTestTool();
    newToolExecutor.registerTool(newIntegrationTool.name, newIntegrationTool);
    newToolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });

    await newToolExecutor.executeTool(
      {
        id: 'test-stability-2',
        name: newIntegrationTool.name,
        arguments: { content: 'test2' },
      },
      context
    );
    const paths2 = newIntegrationTool.getCapturedContext()!.toolTempDir!;

    // Session directories should be the same, but tool call directories should be different
    const sessionDir1 = paths1.substring(0, paths1.lastIndexOf('/tool-call-'));
    const sessionDir2 = paths2.substring(0, paths2.lastIndexOf('/tool-call-'));
    expect(sessionDir1).toBe(sessionDir2);

    // Tool call directories should be different (unique tool call IDs)
    expect(paths1).not.toBe(paths2);
  });
});
