// ABOUTME: Tests for context analyzer token counting
// ABOUTME: Validates category calculations and edge cases

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextAnalyzer } from './context-analyzer';
import { Agent, AgentConfig } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { Tool } from '~/tools/tool';
import { z } from 'zod';
import type { ToolResult, ToolContext } from '~/tools/types';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import type { ThreadId } from '~/threads/types';

// Mock tool for testing
class TestTool extends Tool {
  name = 'test_tool';
  description = 'A test tool';
  schema = z.object({
    input: z.string(),
  });

  async executeValidated(
    _args: z.infer<typeof this.schema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    return this.createResult('test result');
  }
}

describe('ContextAnalyzer', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let providerInstanceId: string;
  let agentThreadId: ThreadId;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Provider',
      apiKey: 'test-api-key',
    });

    // Create thread manager and tool executor - no session/project needed for token counting
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();

    // Generate thread ID and create simple thread (no session/project)
    agentThreadId = threadManager.generateThreadId();
    threadManager.createThread(agentThreadId);

    // Create agent configuration
    const agentConfig: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId: agentThreadId,
      tools: [new TestTool()],
      metadata: {
        name: 'Test Agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(agentConfig);
    // Initialize to create provider instance
    await agent.initialize();

    // Mock calibrateTokenCosts to avoid network calls
    if (agent.providerInstance && agent.providerInstance.calibrateTokenCosts) {
      vi.spyOn(agent.providerInstance, 'calibrateTokenCosts').mockResolvedValue(null);
    }
  });

  afterEach(async () => {
    if (agent) {
      agent.removeAllListeners();
      agent.stop();
    }
    if (threadManager) {
      threadManager.close();
    }
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    cleanupTestProviderDefaults();
  });

  describe('System Prompt Tokens', () => {
    it('should count tokens from SYSTEM_PROMPT events', async () => {
      // Add a system prompt event
      threadManager.addEvent({
        type: 'SYSTEM_PROMPT',
        data: 'You are a helpful assistant.',
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);
    });

    it('should count tokens from USER_SYSTEM_PROMPT events', async () => {
      threadManager.addEvent({
        type: 'USER_SYSTEM_PROMPT',
        data: 'Additional context from user.',
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);
    });

    it('should handle threads with no system prompts', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBe(0);
    });

    it('should sum tokens from multiple system prompts', async () => {
      threadManager.addEvent({
        type: 'SYSTEM_PROMPT',
        data: 'First prompt.',
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'USER_SYSTEM_PROMPT',
        data: 'Second prompt.',
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);
    });
  });

  describe('Tool Token Counting', () => {
    it('should count core tool tokens', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.coreTools.tokens).toBeGreaterThan(0);
      expect(breakdown.categories.coreTools.items).toBeDefined();
      expect(breakdown.categories.coreTools.items!.length).toBeGreaterThan(0);
    });

    it('should list individual core tools with token counts', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      // Look for a real tool that should be registered (e.g., file_read)
      const fileReadTool = breakdown.categories.coreTools.items?.find(
        (t) => t.name === 'file_read'
      );
      expect(fileReadTool).toBeDefined();
      expect(fileReadTool!.tokens).toBeGreaterThan(0);
    });

    it('should handle agents with no MCP tools', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.mcpTools.tokens).toBe(0);
      expect(breakdown.categories.mcpTools.items).toEqual([]);
    });

    it('should calculate total tool tokens correctly', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      const itemTotal = breakdown.categories.coreTools.items!.reduce(
        (sum, item) => sum + item.tokens,
        0
      );
      expect(breakdown.categories.coreTools.tokens).toBe(itemTotal);
    });
  });

  describe('Message Token Counting', () => {
    it('should count user message tokens', async () => {
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        data: 'Hello, world!',
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.messages.subcategories.userMessages.tokens).toBeGreaterThan(0);
    });

    it('should count agent message tokens', async () => {
      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        data: { content: 'I can help with that.' },
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.messages.subcategories.agentMessages.tokens).toBeGreaterThan(0);
    });

    it('should count tool call tokens', async () => {
      threadManager.addEvent({
        type: 'TOOL_CALL',
        data: {
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test input' },
        },
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.messages.subcategories.toolCalls.tokens).toBeGreaterThan(0);
    });

    it('should count tool result tokens', async () => {
      threadManager.addEvent({
        type: 'TOOL_RESULT',
        data: {
          id: 'call_1',
          content: [{ type: 'text' as const, text: 'Result text here' }],
          status: 'completed' as const,
        },
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.messages.subcategories.toolResults.tokens).toBeGreaterThan(0);
    });

    it('should calculate total message tokens correctly', async () => {
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        data: 'Test user message',
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        data: { content: 'Test agent response' },
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);
      const { subcategories } = breakdown.categories.messages;

      const expectedTotal =
        subcategories.userMessages.tokens +
        subcategories.agentMessages.tokens +
        subcategories.toolCalls.tokens +
        subcategories.toolResults.tokens;

      expect(breakdown.categories.messages.tokens).toBe(expectedTotal);
    });

    it('should handle empty messages', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.messages.tokens).toBe(0);
      expect(breakdown.categories.messages.subcategories.userMessages.tokens).toBe(0);
      expect(breakdown.categories.messages.subcategories.agentMessages.tokens).toBe(0);
      expect(breakdown.categories.messages.subcategories.toolCalls.tokens).toBe(0);
      expect(breakdown.categories.messages.subcategories.toolResults.tokens).toBe(0);
    });
  });

  describe('Reserved and Free Space Tokens', () => {
    it('should calculate reserved tokens for response', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.reservedForResponse.tokens).toBeGreaterThan(0);
      // Default should be 4096
      expect(breakdown.categories.reservedForResponse.tokens).toBe(4096);
    });

    it('should calculate free space correctly', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      const totalAccountedFor =
        breakdown.categories.systemPrompt.tokens +
        breakdown.categories.coreTools.tokens +
        breakdown.categories.mcpTools.tokens +
        breakdown.categories.messages.tokens +
        breakdown.categories.reservedForResponse.tokens +
        breakdown.categories.freeSpace.tokens;

      expect(totalAccountedFor).toBe(breakdown.contextLimit);
    });

    it('should not report negative free space', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.freeSpace.tokens).toBeGreaterThanOrEqual(0);
    });

    it('should calculate percentUsed correctly', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      const expectedPercent = breakdown.totalUsedTokens / breakdown.contextLimit;
      expect(breakdown.percentUsed).toBeCloseTo(expectedPercent, 10);
    });
  });

  describe('ContextAnalyzer Integration', () => {
    it('should analyze a complete conversation', async () => {
      // Set up a realistic conversation
      threadManager.addEvent({
        type: 'SYSTEM_PROMPT',
        data: 'You are a helpful coding assistant.',
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'USER_MESSAGE',
        data: 'Can you help me write a function?',
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        data: { content: 'Of course! What should the function do?' },
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'USER_MESSAGE',
        data: 'Calculate factorial of a number',
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'TOOL_CALL',
        data: {
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'factorial code' },
        },
        context: { threadId: agentThreadId },
      });

      threadManager.addEvent({
        type: 'TOOL_RESULT',
        data: {
          id: 'call_1',
          content: [{ type: 'text' as const, text: 'Function created successfully' }],
          status: 'completed' as const,
        },
        context: { threadId: agentThreadId },
      });

      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      // Verify all categories are populated
      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);
      expect(breakdown.categories.coreTools.tokens).toBeGreaterThan(0);
      expect(breakdown.categories.messages.tokens).toBeGreaterThan(0);
      expect(breakdown.categories.reservedForResponse.tokens).toBeGreaterThan(0);
      expect(breakdown.categories.freeSpace.tokens).toBeGreaterThan(0);

      // Verify metadata
      expect(breakdown.timestamp).toBeDefined();
      expect(breakdown.modelId).toBeDefined();
      expect(breakdown.contextLimit).toBeGreaterThan(0);
      expect(breakdown.totalUsedTokens).toBeGreaterThan(0);
      expect(breakdown.percentUsed).toBeGreaterThan(0);
      expect(breakdown.percentUsed).toBeLessThan(1);
    });

    it('should handle empty threads', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBe(0);
      expect(breakdown.categories.messages.tokens).toBe(0);
      expect(breakdown.totalUsedTokens).toBeGreaterThanOrEqual(0);
      expect(breakdown.categories.freeSpace.tokens).toBeGreaterThan(0);
    });

    it('should return valid ISO timestamp', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(() => new Date(breakdown.timestamp)).not.toThrow();
      const timestamp = new Date(breakdown.timestamp);
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should include tool items in breakdown', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.categories.coreTools.items).toBeDefined();
      expect(breakdown.categories.coreTools.items!.length).toBeGreaterThan(0);

      // Verify item structure
      const firstTool = breakdown.categories.coreTools.items![0];
      expect(firstTool!.name).toBeDefined();
      expect(firstTool!.tokens).toBeGreaterThan(0);
    });

    it('should report correct model ID', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      expect(breakdown.modelId).toBe('claude-3-5-haiku-20241022');
    });

    it('should report correct context limit for model', async () => {
      const breakdown = await ContextAnalyzer.analyze(agentThreadId, agent);

      // Claude 3.5 Haiku should have 200k context
      expect(breakdown.contextLimit).toBe(200000);
    });
  });
});
