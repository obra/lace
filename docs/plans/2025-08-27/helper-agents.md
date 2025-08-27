# Helper Agents Implementation Plan

## Overview

We're building a system to execute lightweight LLM (Large Language Model - AI) tasks outside the normal agent/conversation workflow. Think of it as "calling an AI like a function" - you give it a task, it completes it (possibly using tools), and returns a result.

**Key Concepts:**
- **Helper**: A lightweight wrapper around an LLM that executes a single task
- **Tool**: A function the LLM can call (read files, search code, fetch URLs, etc.)
- **Provider**: The AI service (Anthropic, OpenAI, etc.) that runs the LLM

## Architecture Summary

Two types of helpers:
1. **InfrastructureHelper**: For Lace's internal code to call (bypasses user approval)
2. **SessionHelper**: For agents to spawn during conversations (respects user approval)

Both types can make multiple LLM calls internally but return a single result to their caller.

## Development Principles

**IMPORTANT**: Follow these principles for EVERY task:

1. **TDD (Test-Driven Development)**: Write the test FIRST, verify it fails, then write code to make it pass
2. **DRY (Don't Repeat Yourself)**: If you write something twice, extract it into a function
3. **YAGNI (You Aren't Gonna Need It)**: Don't add features that aren't explicitly required
4. **Frequent Commits**: Commit after EVERY test that passes, with clear messages
5. **No Mocking What We Test**: Never mock the thing you're testing. Use real implementations. Only mock external dependencies when absolutely necessary.

## Implementation Tasks

### Phase 1: Prerequisites and Cleanup

#### Task 1.1: Refactor ProviderToolCall to ToolCall

**Context**: We have two types representing the same thing - `ProviderToolCall` (with `input` property) and `ToolCall` (with `arguments` property). We're standardizing on `ToolCall`.

**Files to modify:**
- `packages/core/src/providers/base-provider.ts` - Remove `ProviderToolCall` interface
- `packages/core/src/providers/anthropic-provider.ts` - Update to return `ToolCall`
- `packages/core/src/providers/openai-provider.ts` - Update to return `ToolCall`
- `packages/core/src/providers/lmstudio-provider.ts` - Update to return `ToolCall`
- `packages/core/src/providers/ollama-provider.ts` - Update to return `ToolCall`
- `packages/core/src/agents/agent.ts` - Update `AgentMessageResult` to use `ToolCall[]`
- `packages/core/src/providers/format-converters.ts` - Update conversion logic

**Testing approach:**
```bash
# First, run existing tests to ensure they pass
npm run test:run

# After changes, all existing tests should still pass
npm run test:run
```

**Detailed steps:**

1. Start by running all tests to ensure they pass:
```bash
npm run test:run
```

2. Update the base provider interface in `packages/core/src/providers/base-provider.ts`:
```typescript
// DELETE this interface:
export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// UPDATE ProviderResponse to use ToolCall:
import { ToolCall } from '~/tools/types';

export interface ProviderResponse {
  content: string;
  toolCalls: ToolCall[];  // Changed from ProviderToolCall[]
  // ... rest unchanged
}

// UPDATE ProviderMessage:
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  name?: string;
  toolCalls?: ToolCall[];  // Changed from ProviderToolCall[]
  toolResultId?: string;
}
```

3. Update each provider to convert to `ToolCall` format:

In `packages/core/src/providers/anthropic-provider.ts`:
```typescript
// Find where tool calls are created (around line 263)
// Change from:
let toolCalls: ProviderToolCall[] = [];

// To:
import { ToolCall } from '~/tools/types';
let toolCalls: ToolCall[] = [];

// When creating tool calls, change from:
toolCalls.push({
  id: toolUse.id,
  name: toolUse.name,
  input: toolUse.input  // Note: was 'input'
});

// To:
toolCalls.push({
  id: toolUse.id,
  name: toolUse.name,
  arguments: toolUse.input  // Now 'arguments' to match ToolCall
});
```

In `packages/core/src/providers/openai-provider.ts`:
```typescript
// Around line 220, change from:
const toolCalls: ProviderToolCall[] =
  choice.message.tool_calls?.map((toolCall: OpenAI.Chat.ChatCompletionMessageToolCall) => {
    try {
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
      };
    // ...

// To:
import { ToolCall } from '~/tools/types';
const toolCalls: ToolCall[] =
  choice.message.tool_calls?.map((toolCall: OpenAI.Chat.ChatCompletionMessageToolCall) => {
    try {
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
      };
    // ...
```

4. Update format converters in `packages/core/src/providers/format-converters.ts`:
```typescript
// Change any references from input to arguments:
// From:
msg.toolCalls.forEach((toolCall: ProviderToolCall) => {
  // ... toolCall.input

// To:
msg.toolCalls.forEach((toolCall: ToolCall) => {
  // ... toolCall.arguments
```

5. Run tests after each file change to catch issues early:
```bash
npm run test:run packages/core/src/providers/anthropic-provider.test.ts
npm run test:run packages/core/src/providers/openai-provider.test.ts
```

6. Commit your changes:
```bash
git add -A
git commit -m "refactor: replace ProviderToolCall with ToolCall throughout codebase"
```

#### Task 1.2: Extract Provider Model Parsing Utility

**Context**: The pattern `const [instanceId, modelId] = value.split(':')` appears in multiple places. Extract it to a utility.

**Files to create:**
- `packages/core/src/utils/provider-utils.ts` - New utility file
- `packages/core/src/utils/provider-utils.test.ts` - Tests for the utility

**Files to update:**
- `packages/core/src/tools/implementations/delegate.ts` - Use new utility
- `packages/core/src/tasks/task-manager.ts` - Use new utility

**Test first (TDD):**

Create `packages/core/src/utils/provider-utils.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseProviderModel } from './provider-utils';

describe('parseProviderModel', () => {
  it('should parse valid provider:model format', () => {
    const result = parseProviderModel('anthropic-default:claude-3-opus-20240229');
    expect(result).toEqual({
      instanceId: 'anthropic-default',
      modelId: 'claude-3-opus-20240229'
    });
  });

  it('should handle model names with colons', () => {
    const result = parseProviderModel('my-provider:gpt-4:latest:v2');
    expect(result).toEqual({
      instanceId: 'my-provider',
      modelId: 'gpt-4:latest:v2'
    });
  });

  it('should throw on missing model', () => {
    expect(() => parseProviderModel('anthropic-default')).toThrow(
      "Invalid provider model format: 'anthropic-default'. Expected format: 'instanceId:modelId'"
    );
  });

  it('should throw on empty string', () => {
    expect(() => parseProviderModel('')).toThrow(
      "Invalid provider model format: ''. Expected format: 'instanceId:modelId'"
    );
  });

  it('should throw on missing instance', () => {
    expect(() => parseProviderModel(':model-name')).toThrow(
      "Invalid provider model format: ':model-name'. Expected format: 'instanceId:modelId'"
    );
  });
});
```

Run the test to verify it fails:
```bash
npm run test:run packages/core/src/utils/provider-utils.test.ts
```

Now implement `packages/core/src/utils/provider-utils.ts`:
```typescript
// ABOUTME: Utility functions for working with provider configurations
// ABOUTME: Includes parsing provider:model strings and other provider-related helpers

/**
 * Parse a provider model string in the format "instanceId:modelId"
 * @param providerModel - String like "anthropic-default:claude-3-opus-20240229"
 * @returns Object with instanceId and modelId
 * @throws Error if format is invalid
 */
export function parseProviderModel(providerModel: string): {
  instanceId: string;
  modelId: string;
} {
  if (!providerModel) {
    throw new Error(
      `Invalid provider model format: '${providerModel}'. Expected format: 'instanceId:modelId'`
    );
  }

  const colonIndex = providerModel.indexOf(':');
  
  if (colonIndex === -1) {
    throw new Error(
      `Invalid provider model format: '${providerModel}'. Expected format: 'instanceId:modelId'`
    );
  }

  const instanceId = providerModel.substring(0, colonIndex);
  const modelId = providerModel.substring(colonIndex + 1);

  if (!instanceId || !modelId) {
    throw new Error(
      `Invalid provider model format: '${providerModel}'. Expected format: 'instanceId:modelId'`
    );
  }

  return { instanceId, modelId };
}
```

Run tests to verify they pass:
```bash
npm run test:run packages/core/src/utils/provider-utils.test.ts
```

Update existing code to use the utility:

In `packages/core/src/tools/implementations/delegate.ts`:
```typescript
import { parseProviderModel } from '~/utils/provider-utils';

// Replace:
const [providerInstanceId, modelName] = value.split(':');

// With:
const { instanceId: providerInstanceId, modelId: modelName } = parseProviderModel(value);
```

Commit:
```bash
git add -A
git commit -m "refactor: extract parseProviderModel utility function"
```

### Phase 2: Global Configuration System

#### Task 2.1: Create Global Config Manager

**Context**: We need a system to manage global configuration stored in `~/.lace/config.json`.

**Files to create:**
- `packages/core/src/config/global-config.ts` - Config manager
- `packages/core/src/config/global-config.test.ts` - Tests

**Test first (TDD):**

Create `packages/core/src/config/global-config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GlobalConfigManager } from './global-config';
import * as fs from 'fs';
import { getLaceFilePath } from '~/config/lace-dir';

// Mock fs module
vi.mock('fs');

describe('GlobalConfigManager', () => {
  beforeEach(() => {
    // Clear any cached config between tests
    GlobalConfigManager['cachedConfig'] = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefaultModel', () => {
    it('should return fast model when configured', () => {
      const mockConfig = {
        defaultModels: {
          fast: 'anthropic-default:claude-3-haiku-20240307',
          smart: 'anthropic-default:claude-3-opus-20240229'
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const model = GlobalConfigManager.getDefaultModel('fast');
      expect(model).toBe('anthropic-default:claude-3-haiku-20240307');
    });

    it('should return smart model when configured', () => {
      const mockConfig = {
        defaultModels: {
          fast: 'anthropic-default:claude-3-haiku-20240307',
          smart: 'anthropic-default:claude-3-opus-20240229'
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const model = GlobalConfigManager.getDefaultModel('smart');
      expect(model).toBe('anthropic-default:claude-3-opus-20240229');
    });

    it('should throw when config file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        /Global config not found at/
      );
    });

    it('should throw when model tier is not configured', () => {
      const mockConfig = {
        defaultModels: {
          smart: 'anthropic-default:claude-3-opus-20240229'
          // 'fast' is missing
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        "No default model configured for 'fast'"
      );
    });

    it('should throw on invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json {');

      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        /Failed to parse global config/
      );
    });

    it('should cache config after first load', () => {
      const mockConfig = {
        defaultModels: {
          fast: 'anthropic-default:claude-3-haiku-20240307',
          smart: 'anthropic-default:claude-3-opus-20240229'
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      // First call
      GlobalConfigManager.getDefaultModel('fast');
      
      // Second call should use cache
      GlobalConfigManager.getDefaultModel('smart');

      // Should only read file once
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
```

Run test to verify it fails:
```bash
npm run test:run packages/core/src/config/global-config.test.ts
```

Now implement `packages/core/src/config/global-config.ts`:
```typescript
// ABOUTME: Global configuration manager for system-wide settings
// ABOUTME: Manages ~/.lace/config.json including default model configurations

import * as fs from 'fs';
import { getLaceFilePath } from '~/config/lace-dir';

interface GlobalConfig {
  defaultModels: {
    fast?: string;
    smart?: string;
  };
  // Room for future global settings
}

export class GlobalConfigManager {
  private static cachedConfig: GlobalConfig | null = null;

  /**
   * Load the global configuration from ~/.lace/config.json
   * Caches the result for subsequent calls
   */
  private static loadConfig(): GlobalConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const configPath = getLaceFilePath('config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Global config not found at ${configPath}. ` +
        `Please create this file with a 'defaultModels' section containing 'fast' and 'smart' model configurations.`
      );
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      this.cachedConfig = JSON.parse(configContent) as GlobalConfig;
      return this.cachedConfig;
    } catch (error) {
      throw new Error(
        `Failed to parse global config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the default model configuration for a given tier
   * @param tier - Either 'fast' or 'smart'
   * @returns The provider:model string for the requested tier
   * @throws Error if config is missing or tier is not configured
   */
  static getDefaultModel(tier: 'fast' | 'smart'): string {
    const config = this.loadConfig();
    
    if (!config.defaultModels) {
      throw new Error(
        `Global config is missing 'defaultModels' section. ` +
        `Please add a 'defaultModels' object with 'fast' and 'smart' model configurations.`
      );
    }

    const model = config.defaultModels[tier];
    
    if (!model) {
      throw new Error(
        `No default model configured for '${tier}'. ` +
        `Please add a '${tier}' entry to the 'defaultModels' section of your global config.`
      );
    }

    return model;
  }

  /**
   * Clear the cached config (mainly for testing)
   */
  static clearCache(): void {
    this.cachedConfig = null;
  }
}
```

Run tests to verify they pass:
```bash
npm run test:run packages/core/src/config/global-config.test.ts
```

Commit:
```bash
git add -A
git commit -m "feat: add GlobalConfigManager for system-wide configuration"
```

#### Task 2.2: Create Example Config File

Create `docs/examples/config.json`:
```json
{
  "defaultModels": {
    "fast": "anthropic-default:claude-3-haiku-20240307",
    "smart": "anthropic-default:claude-3-opus-20240229"
  }
}
```

Add documentation in `README.md` or appropriate docs file about setting up `~/.lace/config.json`.

Commit:
```bash
git add -A
git commit -m "docs: add example global config file"
```

### Phase 3: Base Helper Implementation

#### Task 3.1: Create HelperResult Type

**Files to create:**
- `packages/core/src/helpers/types.ts` - Type definitions

Create `packages/core/src/helpers/types.ts`:
```typescript
// ABOUTME: Type definitions for the helper system
// ABOUTME: Includes result types and options for different helper modes

import { ToolCall, ToolResult } from '~/tools/types';
import { CombinedTokenUsage } from '~/token-management/types';

/**
 * Result returned from a helper execution
 * Contains the final LLM response and details about any tool usage
 */
export interface HelperResult {
  /** The final text response from the LLM */
  content: string;
  
  /** All tool calls made during execution */
  toolCalls: ToolCall[];
  
  /** Results from those tool calls */
  toolResults: ToolResult[];
  
  /** Total token usage across all LLM calls */
  tokenUsage?: CombinedTokenUsage;
}
```

Commit:
```bash
git add -A
git commit -m "feat: add HelperResult type definition"
```

#### Task 3.2: Create Base Helper Class

**Context**: We'll create a base class with the common multi-turn execution logic, then extend it for Infrastructure and Session variants.

**Files to create:**
- `packages/core/src/helpers/base-helper.ts` - Base class
- `packages/core/src/helpers/base-helper.test.ts` - Tests

**Test first (TDD):**

Create `packages/core/src/helpers/base-helper.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseHelper } from './base-helper';
import { HelperResult } from './types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider } from '~/providers/base-provider';
import { TestProvider } from '~/test-utils/test-provider';
import { z } from 'zod';

// Create a simple test tool
class TestTool extends Tool {
  name = 'test_tool';
  description = 'A tool for testing';
  schema = z.object({
    input: z.string(),
  });

  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Processed: ${args.input}`);
  }
}

// Create a concrete implementation for testing
class TestHelper extends BaseHelper {
  constructor(
    private provider: AIProvider,
    private toolExecutor: ToolExecutor,
    private tools: Tool[]
  ) {
    super();
  }

  protected async getProvider(): Promise<AIProvider> {
    return this.provider;
  }

  protected async getTools(): Promise<Tool[]> {
    return this.tools;
  }

  protected async getToolExecutor(): Promise<ToolExecutor> {
    return this.toolExecutor;
  }

  protected async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // Simple implementation for testing
    const results = [];
    for (const call of toolCalls) {
      const tool = this.tools.find(t => t.name === call.name);
      if (tool) {
        const result = await tool.execute(call.arguments);
        results.push(result);
      }
    }
    return results;
  }
}

describe('BaseHelper', () => {
  let helper: TestHelper;
  let provider: TestProvider;
  let toolExecutor: ToolExecutor;
  let testTool: TestTool;

  beforeEach(() => {
    provider = new TestProvider({
      modelId: 'test-model',
      config: {}
    });
    toolExecutor = new ToolExecutor();
    testTool = new TestTool();
    toolExecutor.registerTool(testTool.name, testTool);
    
    helper = new TestHelper(provider, toolExecutor, [testTool]);
  });

  describe('execute', () => {
    it('should handle simple prompt without tools', async () => {
      provider.addMockResponse({
        content: 'Hello! How can I help?',
        toolCalls: []
      });

      const result = await helper.execute('Say hello');

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.toolResults).toHaveLength(0);
    });

    it('should handle single tool call', async () => {
      // First response: LLM wants to use a tool
      provider.addMockResponse({
        content: 'I will use the test tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test data' }
        }]
      });

      // Second response: LLM processes tool result
      provider.addMockResponse({
        content: 'The tool processed: test data',
        toolCalls: []
      });

      const result = await helper.execute('Use the test tool');

      expect(result.content).toBe('The tool processed: test data');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('test_tool');
      expect(result.toolResults).toHaveLength(1);
    });

    it('should handle multiple tool calls in sequence', async () => {
      // First response: LLM wants to use a tool
      provider.addMockResponse({
        content: 'Using first tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'first' }
        }]
      });

      // Second response: LLM wants another tool
      provider.addMockResponse({
        content: 'Using second tool',
        toolCalls: [{
          id: 'call_2',
          name: 'test_tool',
          arguments: { input: 'second' }
        }]
      });

      // Final response: Done with tools
      provider.addMockResponse({
        content: 'Processed both: first and second',
        toolCalls: []
      });

      const result = await helper.execute('Use tools twice');

      expect(result.content).toBe('Processed both: first and second');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolResults).toHaveLength(2);
    });

    it('should throw on infinite loop', async () => {
      // Keep returning tool calls forever
      for (let i = 0; i < 15; i++) {
        provider.addMockResponse({
          content: `Tool call ${i}`,
          toolCalls: [{
            id: `call_${i}`,
            name: 'test_tool',
            arguments: { input: `data_${i}` }
          }]
        });
      }

      await expect(helper.execute('Infinite loop')).rejects.toThrow(
        'Helper exceeded maximum turns'
      );
    });

    it('should handle abort signal', async () => {
      const controller = new AbortController();
      
      provider.addMockResponse({
        content: 'Starting',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      // Abort during execution
      setTimeout(() => controller.abort(), 10);

      await expect(
        helper.execute('Test abort', controller.signal)
      ).rejects.toThrow();
    });
  });
});
```

Run test to verify it fails:
```bash
npm run test:run packages/core/src/helpers/base-helper.test.ts
```

Now implement `packages/core/src/helpers/base-helper.ts`:
```typescript
// ABOUTME: Base class for helper agents providing common multi-turn execution logic
// ABOUTME: Extended by InfrastructureHelper and SessionHelper for specific use cases

import { HelperResult } from './types';
import { ToolCall, ToolResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider, ProviderMessage } from '~/providers/base-provider';
import { CombinedTokenUsage } from '~/token-management/types';
import { logger } from '~/utils/logger';

/**
 * Base class for helper agents
 * Provides the core multi-turn execution loop
 * Subclasses implement specific tool execution and provider access patterns
 */
export abstract class BaseHelper {
  private static readonly MAX_TURNS = 10;

  /**
   * Get the AI provider instance for this helper
   */
  protected abstract getProvider(): Promise<AIProvider>;

  /**
   * Get the tools available to this helper
   */
  protected abstract getTools(): Promise<Tool[]>;

  /**
   * Get the tool executor for this helper
   */
  protected abstract getToolExecutor(): Promise<ToolExecutor>;

  /**
   * Execute tool calls according to the helper's security model
   * Infrastructure helpers bypass approval, Session helpers respect policies
   */
  protected abstract executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]>;

  /**
   * Execute a prompt and return the complete result
   * May involve multiple LLM calls and tool executions internally
   */
  async execute(prompt: string, signal?: AbortSignal): Promise<HelperResult> {
    const provider = await this.getProvider();
    const tools = await this.getTools();
    
    // Build initial conversation
    const conversation: ProviderMessage[] = [
      { role: 'user', content: prompt }
    ];

    // Track all tool usage
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];
    let totalUsage: CombinedTokenUsage | undefined;

    // Multi-turn execution loop
    let turnCount = 0;
    
    while (true) {
      // Check abort signal
      if (signal?.aborted) {
        throw new Error('Helper execution aborted');
      }

      // Prevent infinite loops
      if (++turnCount > BaseHelper.MAX_TURNS) {
        throw new Error(`Helper exceeded maximum turns (${BaseHelper.MAX_TURNS})`);
      }

      logger.debug('Helper executing turn', {
        turnCount,
        conversationLength: conversation.length
      });

      // Get LLM response
      const response = await provider.createMessage(conversation, tools, signal);

      // Add assistant response to conversation
      conversation.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      });

      // Aggregate token usage
      if (response.usage) {
        if (!totalUsage) {
          totalUsage = {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens
          };
        } else {
          totalUsage.promptTokens += response.usage.promptTokens;
          totalUsage.completionTokens += response.usage.completionTokens;
          totalUsage.totalTokens += response.usage.totalTokens;
        }
      }

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.debug('Helper completed', {
          turnCount,
          toolCallsTotal: allToolCalls.length
        });

        return {
          content: response.content,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          tokenUsage: totalUsage
        };
      }

      // Execute tool calls
      logger.debug('Helper executing tool calls', {
        turnCount,
        toolCount: response.toolCalls.length
      });

      const toolResults = await this.executeToolCalls(response.toolCalls, signal);
      
      // Track tool usage
      allToolCalls.push(...response.toolCalls);
      allToolResults.push(...toolResults);

      // Add tool results to conversation
      for (let i = 0; i < response.toolCalls.length; i++) {
        const toolCall = response.toolCalls[i];
        const toolResult = toolResults[i];
        
        if (toolResult) {
          // Convert tool result to conversation message
          conversation.push({
            role: 'tool',
            content: toolResult.content.map(block => block.text || '').join('\n'),
            toolResultId: toolCall.id
          });
        }
      }
    }
  }
}
```

Run tests to verify they pass:
```bash
npm run test:run packages/core/src/helpers/base-helper.test.ts
```

Commit:
```bash
git add -A
git commit -m "feat: implement BaseHelper with multi-turn execution logic"
```

### Phase 4: Infrastructure Helper

#### Task 4.1: Implement InfrastructureHelper

**Files to create:**
- `packages/core/src/helpers/infrastructure-helper.ts` - Implementation
- `packages/core/src/helpers/infrastructure-helper.test.ts` - Tests

**Test first (TDD):**

Create `packages/core/src/helpers/infrastructure-helper.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InfrastructureHelper } from './infrastructure-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { Tool } from '~/tools/tool';
import { z } from 'zod';
import * as fs from 'fs';

// Mock modules
vi.mock('fs');
vi.mock('~/config/global-config');
vi.mock('~/providers/instance/manager');

class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Result: ${args.input}`);
  }
}

class UnapprovedTool extends Tool {
  name = 'unapproved_tool';
  description = 'Tool not in whitelist';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Should not execute`);
  }
}

describe('InfrastructureHelper', () => {
  let toolExecutor: ToolExecutor;
  let testTool: TestTool;
  let unapprovedTool: UnapprovedTool;
  let mockProvider: TestProvider;

  beforeEach(() => {
    // Setup tool executor with test tools
    toolExecutor = new ToolExecutor();
    testTool = new TestTool();
    unapprovedTool = new UnapprovedTool();
    toolExecutor.registerTool(testTool.name, testTool);
    toolExecutor.registerTool(unapprovedTool.name, unapprovedTool);

    // Mock global config
    vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('test-instance:test-model');

    // Setup mock provider
    mockProvider = new TestProvider({
      modelId: 'test-model',
      config: {}
    });

    // Mock provider instance manager
    const mockInstanceManager = {
      getInstance: vi.fn().mockResolvedValue(mockProvider)
    };
    vi.mocked(ProviderInstanceManager).mockImplementation(() => mockInstanceManager as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with required options', () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });

      expect(helper).toBeDefined();
    });

    it('should create with optional context', () => {
      const helper = new InfrastructureHelper({
        model: 'smart',
        tools: ['test_tool'],
        workingDirectory: '/test/dir',
        processEnv: { TEST: 'value' }
      });

      expect(helper).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute with whitelisted tools only', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool'] // Only test_tool is allowed
      });

      // Set tool executor on helper (normally done in constructor)
      helper['toolExecutor'] = toolExecutor;

      // Mock provider responses
      mockProvider.addMockResponse({
        content: 'I will use both tools',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            arguments: { input: 'allowed' }
          },
          {
            id: 'call_2',
            name: 'unapproved_tool',
            arguments: { input: 'not allowed' }
          }
        ]
      });

      mockProvider.addMockResponse({
        content: 'Done with tools',
        toolCalls: []
      });

      const result = await helper.execute('Test tool whitelist');

      // Should execute allowed tool
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolResults).toHaveLength(2);
      
      // First tool should succeed
      expect(result.toolResults[0].status).toBe('completed');
      
      // Second tool should be denied
      expect(result.toolResults[1].status).toBe('failed');
      expect(result.toolResults[1].content[0].text).toContain('not in whitelist');
    });

    it('should bypass approval for whitelisted tools', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool']
      });

      helper['toolExecutor'] = toolExecutor;

      // Spy on executeApprovedTool to verify it's called directly
      const executeSpy = vi.spyOn(toolExecutor, 'executeApprovedTool');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: []
      });

      await helper.execute('Test bypass approval');

      // Should call executeApprovedTool directly (bypassing approval)
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test_tool' }),
        expect.any(Object)
      );
    });

    it('should use custom working directory in tool context', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['test_tool'],
        workingDirectory: '/custom/dir'
      });

      helper['toolExecutor'] = toolExecutor;

      const executeSpy = vi.spyOn(toolExecutor, 'executeApprovedTool');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: []
      });

      await helper.execute('Test working directory');

      // Check that context includes working directory
      expect(executeSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          workingDirectory: '/custom/dir'
        })
      );
    });

    it('should handle empty tool list', async () => {
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: [] // No tools allowed
      });

      helper['toolExecutor'] = toolExecutor;

      mockProvider.addMockResponse({
        content: 'I cannot use any tools',
        toolCalls: []
      });

      const result = await helper.execute('No tools available');

      expect(result.content).toBe('I cannot use any tools');
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe('model resolution', () => {
    it('should use fast model when specified', async () => {
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('fast-instance:fast-model');

      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: []
      });

      helper['toolExecutor'] = toolExecutor;

      mockProvider.addMockResponse({
        content: 'Using fast model',
        toolCalls: []
      });

      await helper.execute('Test fast model');

      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('fast');
    });

    it('should use smart model when specified', async () => {
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('smart-instance:smart-model');

      const helper = new InfrastructureHelper({
        model: 'smart',
        tools: []
      });

      helper['toolExecutor'] = toolExecutor;

      mockProvider.addMockResponse({
        content: 'Using smart model',
        toolCalls: []
      });

      await helper.execute('Test smart model');

      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('smart');
    });
  });
});
```

Run test to verify it fails:
```bash
npm run test:run packages/core/src/helpers/infrastructure-helper.test.ts
```

Now implement `packages/core/src/helpers/infrastructure-helper.ts`:
```typescript
// ABOUTME: Infrastructure helper for Lace's internal systems to execute LLM tasks
// ABOUTME: Bypasses user approval with programmatic tool whitelist for trusted operations

import { BaseHelper } from './base-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { parseProviderModel } from '~/utils/provider-utils';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { ToolCall, ToolResult, ToolContext, createErrorResult } from '~/tools/types';
import { AIProvider } from '~/providers/base-provider';
import { logger } from '~/utils/logger';

export interface InfrastructureHelperOptions {
  /** Model tier to use - 'fast' or 'smart' */
  model: 'fast' | 'smart';
  
  /** Explicit whitelist of tool names that can be used */
  tools: string[];
  
  /** Optional working directory for file operations */
  workingDirectory?: string;
  
  /** Optional environment variables for subprocess execution */
  processEnv?: NodeJS.ProcessEnv;
  
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Helper for infrastructure-level LLM operations
 * Used by Lace's internal systems for tasks like memory management, naming, etc.
 * Bypasses user approval system with explicit tool whitelist
 */
export class InfrastructureHelper extends BaseHelper {
  private provider: AIProvider | null = null;
  private toolExecutor: ToolExecutor;
  private availableTools: Tool[] = [];
  
  constructor(private options: InfrastructureHelperOptions) {
    super();
    this.toolExecutor = new ToolExecutor();
    this.toolExecutor.registerAllAvailableTools();
  }

  protected async getProvider(): Promise<AIProvider> {
    if (this.provider) {
      return this.provider;
    }

    // Get model configuration from global config
    const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
    const { instanceId, modelId } = parseProviderModel(providerModel);

    logger.debug('InfrastructureHelper resolving provider', {
      tier: this.options.model,
      instanceId,
      modelId
    });

    // Get provider instance
    const instanceManager = new ProviderInstanceManager();
    const instance = await instanceManager.getInstance(instanceId);
    
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    // Set the model for this helper
    instance.setModelId(modelId);
    
    this.provider = instance;
    return instance;
  }

  protected async getTools(): Promise<Tool[]> {
    if (this.availableTools.length > 0) {
      return this.availableTools;
    }

    // Get tool instances for whitelisted names
    this.availableTools = this.options.tools
      .map(name => this.toolExecutor.getTool(name))
      .filter((tool): tool is Tool => tool !== undefined);

    logger.debug('InfrastructureHelper resolved tools', {
      requested: this.options.tools,
      available: this.availableTools.map(t => t.name)
    });

    return this.availableTools;
  }

  protected async getToolExecutor(): Promise<ToolExecutor> {
    return this.toolExecutor;
  }

  protected async executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      // Check abort signal
      if (signal?.aborted) {
        results.push(createErrorResult('Execution aborted', toolCall.id));
        continue;
      }

      // Security check: only allow whitelisted tools
      if (!this.options.tools.includes(toolCall.name)) {
        logger.warn('InfrastructureHelper blocked non-whitelisted tool', {
          toolName: toolCall.name,
          whitelist: this.options.tools
        });
        
        results.push(createErrorResult(
          `Tool '${toolCall.name}' not in whitelist`,
          toolCall.id
        ));
        continue;
      }

      // Build context without agent (infrastructure mode)
      const context: ToolContext = {
        signal: this.options.abortSignal || signal || new AbortController().signal,
        workingDirectory: this.options.workingDirectory,
        processEnv: this.options.processEnv,
        // NO agent property - this is infrastructure mode
      };

      logger.debug('InfrastructureHelper executing tool', {
        toolName: toolCall.name,
        hasWorkingDir: !!context.workingDirectory,
        hasProcessEnv: !!context.processEnv
      });

      try {
        // Execute directly (bypass approval)
        const result = await this.toolExecutor.executeApprovedTool(toolCall, context);
        results.push(result);
      } catch (error) {
        logger.error('InfrastructureHelper tool execution failed', {
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : String(error)
        });
        
        results.push(createErrorResult(
          error instanceof Error ? error.message : String(error),
          toolCall.id
        ));
      }
    }

    return results;
  }

  /**
   * Execute a prompt using infrastructure privileges
   * @param prompt The task to execute
   * @param signal Optional abort signal (overrides constructor option)
   */
  async execute(prompt: string, signal?: AbortSignal): Promise<HelperResult> {
    const effectiveSignal = signal || this.options.abortSignal;
    return super.execute(prompt, effectiveSignal);
  }
}
```

Run tests to verify they pass:
```bash
npm run test:run packages/core/src/helpers/infrastructure-helper.test.ts
```

Commit:
```bash
git add -A
git commit -m "feat: implement InfrastructureHelper with programmatic tool whitelist"
```

### Phase 5: Session Helper

#### Task 5.1: Implement SessionHelper

**Files to create:**
- `packages/core/src/helpers/session-helper.ts` - Implementation
- `packages/core/src/helpers/session-helper.test.ts` - Tests

**Test first (TDD):**

Create `packages/core/src/helpers/session-helper.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionHelper } from './session-helper';
import { Agent } from '~/agents/agent';
import { Session } from '~/sessions/session';
import { GlobalConfigManager } from '~/config/global-config';
import { TestProvider } from '~/test-utils/test-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { z } from 'zod';

// Mock modules
vi.mock('~/config/global-config');

class TestTool extends Tool {
  name = 'test_tool';
  description = 'Test tool';
  schema = z.object({ input: z.string() });
  
  protected async executeValidated(args: { input: string }) {
    return this.createResult(`Result: ${args.input}`);
  }
}

describe('SessionHelper', () => {
  let mockAgent: Agent;
  let mockSession: Session;
  let mockProvider: TestProvider;
  let toolExecutor: ToolExecutor;
  let testTool: TestTool;

  beforeEach(() => {
    // Setup mock provider
    mockProvider = new TestProvider({
      modelId: 'test-model',
      config: {}
    });

    // Setup tool executor
    toolExecutor = new ToolExecutor();
    testTool = new TestTool();
    toolExecutor.registerTool(testTool.name, testTool);

    // Mock session
    mockSession = {
      getToolPolicy: vi.fn().mockReturnValue('require-approval'),
      getWorkingDirectory: vi.fn().mockReturnValue('/session/dir'),
      getTools: vi.fn().mockReturnValue([testTool])
    } as any;

    // Mock agent
    mockAgent = {
      getFullSession: vi.fn().mockResolvedValue(mockSession),
      getProvider: vi.fn().mockResolvedValue(mockProvider),
      getTools: vi.fn().mockReturnValue([testTool])
    } as any;

    // Mock global config
    vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('test-instance:test-model');
  });

  describe('constructor', () => {
    it('should create with parent agent', () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });

      expect(helper).toBeDefined();
    });

    it('should create with abort signal', () => {
      const controller = new AbortController();
      const helper = new SessionHelper({
        model: 'smart',
        parentAgent: mockAgent,
        abortSignal: controller.signal
      });

      expect(helper).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should inherit tools from parent agent', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });

      // Set internal properties (normally done differently)
      helper['toolExecutor'] = toolExecutor;

      mockProvider.addMockResponse({
        content: 'Using inherited tools',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'from session' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: []
      });

      const result = await helper.execute('Use session tools');

      expect(mockAgent.getTools).toHaveBeenCalled();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('test_tool');
    });

    it('should use parent agent context for tool execution', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });

      helper['toolExecutor'] = toolExecutor;
      const executeSpy = vi.spyOn(toolExecutor, 'requestToolPermission');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      // Mock approval granted
      executeSpy.mockResolvedValue('granted');

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: []
      });

      await helper.execute('Test with agent context');

      // Should pass agent in context
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test_tool' }),
        expect.objectContaining({
          agent: mockAgent
        })
      );
    });

    it('should respect tool approval policies', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });

      helper['toolExecutor'] = toolExecutor;
      
      // Mock denial
      const executeSpy = vi.spyOn(toolExecutor, 'requestToolPermission');
      executeSpy.mockResolvedValue({
        id: 'call_1',
        status: 'denied',
        content: [{ type: 'text', text: 'Tool denied by policy' }]
      });

      mockProvider.addMockResponse({
        content: 'Want to use tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'Could not use tool',
        toolCalls: []
      });

      const result = await helper.execute('Test denial');

      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].status).toBe('denied');
    });

    it('should inherit working directory from session', async () => {
      const helper = new SessionHelper({
        model: 'fast',
        parentAgent: mockAgent
      });

      helper['toolExecutor'] = toolExecutor;
      
      const executeSpy = vi.spyOn(toolExecutor, 'requestToolPermission');
      executeSpy.mockResolvedValue('granted');

      mockProvider.addMockResponse({
        content: 'Using tool',
        toolCalls: [{
          id: 'call_1',
          name: 'test_tool',
          arguments: { input: 'test' }
        }]
      });

      mockProvider.addMockResponse({
        content: 'Done',
        toolCalls: []
      });

      await helper.execute('Test working dir');

      expect(mockSession.getWorkingDirectory).toHaveBeenCalled();
    });
  });

  describe('model resolution', () => {
    it('should resolve model from global config', async () => {
      vi.mocked(GlobalConfigManager.getDefaultModel).mockReturnValue('smart-instance:smart-model');

      const helper = new SessionHelper({
        model: 'smart',
        parentAgent: mockAgent
      });

      helper['toolExecutor'] = toolExecutor;

      mockProvider.addMockResponse({
        content: 'Using smart model',
        toolCalls: []
      });

      await helper.execute('Test model');

      expect(GlobalConfigManager.getDefaultModel).toHaveBeenCalledWith('smart');
    });
  });
});
```

Run test to verify it fails:
```bash
npm run test:run packages/core/src/helpers/session-helper.test.ts
```

Now implement `packages/core/src/helpers/session-helper.ts`:
```typescript
// ABOUTME: Session helper for agents to spawn lightweight LLM tasks within conversation context
// ABOUTME: Inherits session policies and approval workflow from parent agent

import { BaseHelper } from './base-helper';
import { Agent } from '~/agents/agent';
import { GlobalConfigManager } from '~/config/global-config';
import { parseProviderModel } from '~/utils/provider-utils';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { ToolCall, ToolResult, ToolContext, createErrorResult } from '~/tools/types';
import { AIProvider } from '~/providers/base-provider';
import { logger } from '~/utils/logger';

export interface SessionHelperOptions {
  /** Model tier to use - 'fast' or 'smart' */
  model: 'fast' | 'smart';
  
  /** Parent agent to inherit context and policies from */
  parentAgent: Agent;
  
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Helper for session-level LLM operations
 * Used by agents to spawn sub-tasks during conversation flow
 * Inherits tool policies and approval workflow from parent session
 */
export class SessionHelper extends BaseHelper {
  private provider: AIProvider | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private tools: Tool[] | null = null;
  
  constructor(private options: SessionHelperOptions) {
    super();
  }

  protected async getProvider(): Promise<AIProvider> {
    if (this.provider) {
      return this.provider;
    }

    try {
      // Try to get provider from parent agent first
      this.provider = await this.options.parentAgent.getProvider();
      if (this.provider) {
        // Clone the provider and set our model
        const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
        const { modelId } = parseProviderModel(providerModel);
        this.provider.setModelId(modelId);
        return this.provider;
      }
    } catch (error) {
      logger.debug('SessionHelper could not get provider from parent agent', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Fallback: create new provider instance
    const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
    const { instanceId, modelId } = parseProviderModel(providerModel);

    logger.debug('SessionHelper creating new provider', {
      tier: this.options.model,
      instanceId,
      modelId
    });

    const instanceManager = new ProviderInstanceManager();
    const instance = await instanceManager.getInstance(instanceId);
    
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    instance.setModelId(modelId);
    this.provider = instance;
    return instance;
  }

  protected async getTools(): Promise<Tool[]> {
    if (this.tools) {
      return this.tools;
    }

    // Inherit tools from parent agent
    this.tools = this.options.parentAgent.getTools();
    
    logger.debug('SessionHelper inherited tools from parent', {
      toolCount: this.tools.length,
      toolNames: this.tools.map(t => t.name)
    });

    return this.tools;
  }

  protected async getToolExecutor(): Promise<ToolExecutor> {
    if (this.toolExecutor) {
      return this.toolExecutor;
    }

    // Get tool executor from parent agent if possible
    const parentExecutor = this.options.parentAgent['toolExecutor'];
    if (parentExecutor instanceof ToolExecutor) {
      this.toolExecutor = parentExecutor;
      return parentExecutor;
    }

    // Fallback: create new executor
    this.toolExecutor = new ToolExecutor();
    this.toolExecutor.registerAllAvailableTools();
    return this.toolExecutor;
  }

  protected async executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const toolExecutor = await this.getToolExecutor();
    const session = await this.options.parentAgent.getFullSession();

    for (const toolCall of toolCalls) {
      // Check abort signal
      if (signal?.aborted) {
        results.push(createErrorResult('Execution aborted', toolCall.id));
        continue;
      }

      // Build context with parent agent (inherit session policies)
      const context: ToolContext = {
        signal: this.options.abortSignal || signal || new AbortController().signal,
        agent: this.options.parentAgent, // Key difference - has agent context
        workingDirectory: session?.getWorkingDirectory(),
      };

      logger.debug('SessionHelper requesting tool permission', {
        toolName: toolCall.name,
        hasAgent: !!context.agent,
        hasWorkingDir: !!context.workingDirectory
      });

      try {
        // Go through normal approval flow
        const permission = await toolExecutor.requestToolPermission(toolCall, context);
        
        if (typeof permission === 'object' && 'status' in permission) {
          // Permission denied - return as result
          results.push(permission);
          continue;
        }
        
        if (permission === 'pending') {
          // This shouldn't happen in single-shot execution
          logger.warn('SessionHelper got pending approval in single-shot mode', {
            toolName: toolCall.name
          });
          results.push(createErrorResult(
            'Tool approval pending in single-shot helper',
            toolCall.id
          ));
          continue;
        }
        
        // Permission granted - execute
        const result = await toolExecutor.executeApprovedTool(toolCall, context);
        results.push(result);
      } catch (error) {
        logger.error('SessionHelper tool execution failed', {
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : String(error)
        });
        
        results.push(createErrorResult(
          error instanceof Error ? error.message : String(error),
          toolCall.id
        ));
      }
    }

    return results;
  }

  /**
   * Execute a prompt using session privileges
   * @param prompt The task to execute
   * @param signal Optional abort signal (overrides constructor option)
   */
  async execute(prompt: string, signal?: AbortSignal): Promise<HelperResult> {
    const effectiveSignal = signal || this.options.abortSignal;
    return super.execute(prompt, effectiveSignal);
  }
}
```

Run tests to verify they pass:
```bash
npm run test:run packages/core/src/helpers/session-helper.test.ts
```

Commit:
```bash
git add -A
git commit -m "feat: implement SessionHelper with session policy inheritance"
```

### Phase 6: Integration and Testing

#### Task 6.1: Create Integration Tests

Create `packages/core/src/helpers/integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InfrastructureHelper } from './infrastructure-helper';
import { SessionHelper } from './session-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { Session } from '~/sessions/session';
import { Agent } from '~/agents/agent';
import { Tool } from '~/tools/tool';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { getTempDir } from '~/test-utils/temp-directory';

// Create real test tools
class CountFilesTool extends Tool {
  name = 'count_files';
  description = 'Count files in a directory';
  schema = z.object({
    directory: z.string(),
  });

  protected async executeValidated(args: { directory: string }) {
    try {
      const files = fs.readdirSync(args.directory);
      return this.createResult(`Found ${files.length} files`);
    } catch (error) {
      return this.createErrorResult(error instanceof Error ? error.message : String(error));
    }
  }
}

describe('Helper Integration Tests', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create temp directory structure
    tempDir = await getTempDir('helper-integration');
    
    // Create test config
    configPath = path.join(tempDir, 'config.json');
    const config = {
      defaultModels: {
        fast: 'test-provider:fast-model',
        smart: 'test-provider:smart-model'
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Set LACE_DIR to temp directory
    process.env.LACE_DIR = tempDir;
    
    // Clear config cache
    GlobalConfigManager.clearCache();
  });

  afterEach(() => {
    // Cleanup
    delete process.env.LACE_DIR;
    GlobalConfigManager.clearCache();
  });

  describe('End-to-end scenarios', () => {
    it.skip('should execute infrastructure task with real tools', async () => {
      // This test would require real provider setup
      // Marked as skip for unit tests, but shows the pattern
      
      const helper = new InfrastructureHelper({
        model: 'fast',
        tools: ['count_files'],
        workingDirectory: tempDir
      });

      // Would need real provider to work
      const result = await helper.execute('Count the files in the current directory');
      
      expect(result.content).toContain('files');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('count_files');
    });

    it('should load config correctly', () => {
      const fastModel = GlobalConfigManager.getDefaultModel('fast');
      expect(fastModel).toBe('test-provider:fast-model');
      
      const smartModel = GlobalConfigManager.getDefaultModel('smart');
      expect(smartModel).toBe('test-provider:smart-model');
    });

    it('should throw on missing config', () => {
      fs.unlinkSync(configPath);
      GlobalConfigManager.clearCache();
      
      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        /Global config not found/
      );
    });
  });
});
```

Run tests:
```bash
npm run test:run packages/core/src/helpers/integration.test.ts
```

Commit:
```bash
git add -A
git commit -m "test: add integration tests for helper system"
```

#### Task 6.2: Export Public API

Create `packages/core/src/helpers/index.ts`:
```typescript
// ABOUTME: Public API exports for the helper system
// ABOUTME: Provides lightweight LLM task execution outside normal agent workflows

export { InfrastructureHelper, type InfrastructureHelperOptions } from './infrastructure-helper';
export { SessionHelper, type SessionHelperOptions } from './session-helper';
export { type HelperResult } from './types';
// BaseHelper is not exported - it's an implementation detail
```

Update `packages/core/src/index.ts` to include helpers:
```typescript
// Add to existing exports
export * from './helpers';
```

Commit:
```bash
git add -A
git commit -m "feat: export helper system public API"
```

### Phase 7: Documentation

#### Task 7.1: Create Usage Documentation

Create `docs/guides/using-helpers.md`:
```markdown
# Using Helper Agents

Helper agents provide lightweight LLM task execution outside the normal conversation workflow.

## When to Use Helpers

Use helpers when you need to:
- Execute a specific LLM task programmatically (infrastructure)
- Spawn a sub-task from within an agent conversation (session)
- Get a complete result from a multi-step LLM process

## Infrastructure Helpers

For Lace's internal systems:

```typescript
import { InfrastructureHelper } from '@lace/core';

// Memory system analyzing conversations
const helper = new InfrastructureHelper({
  model: 'smart',  // Use the smart model for complex analysis
  tools: ['ripgrep-search', 'file-read'],  // Whitelist specific tools
  workingDirectory: '/path/to/logs'
});

const insights = await helper.execute(
  'Analyze the last 10 conversations and identify recurring patterns'
);

console.log(insights.content);  // The analysis
console.log(insights.toolCalls);  // What tools were used
console.log(insights.tokenUsage);  // Token consumption
```

### Security Model

- **Explicit whitelist**: Only tools in the `tools` array can be used
- **No user approval**: Bypasses approval system entirely
- **Trust boundary**: Calling code is responsible for tool safety

## Session Helpers

For agents spawning sub-tasks:

```typescript
// Inside an agent
const helper = new SessionHelper({
  model: 'fast',  // Use fast model for simple tasks
  parentAgent: this  // Inherit context and policies
});

const summary = await helper.execute(`Summarize this data: ${data}`);
```

### Security Model

- **Inherited policies**: Uses parent session's tool policies
- **Normal approval**: Goes through standard approval workflow
- **Session context**: Inherits working directory, environment, etc.

## Configuration

Create `~/.lace/config.json`:

```json
{
  "defaultModels": {
    "fast": "anthropic-default:claude-3-haiku-20240307",
    "smart": "anthropic-default:claude-3-opus-20240229"
  }
}
```

The system will fail fast if this configuration is missing.

## Error Handling

Helpers are resilient - tool failures don't break execution:

```typescript
const result = await helper.execute('Do something');

// Check individual tool results
for (const toolResult of result.toolResults) {
  if (toolResult.status === 'failed') {
    console.error('Tool failed:', toolResult.content);
  }
}
```

## Testing Helpers

Always use real implementations in tests:

```typescript
// Good: Real tool with test data
const helper = new InfrastructureHelper({
  model: 'fast',
  tools: ['file-read'],
  workingDirectory: testDataDir
});

// Bad: Mocking the helper itself
const mockHelper = jest.mock('InfrastructureHelper');
```

## Common Patterns

### Task Creation from User Input

```typescript
const taskHelper = new InfrastructureHelper({
  model: 'fast',
  tools: ['task-create'],
});

await taskHelper.execute(
  `Create tasks from this request: "${userInput}"`
);
```

### Error Analysis

```typescript
const errorHelper = new InfrastructureHelper({
  model: 'smart',
  tools: ['ripgrep-search'],
  workingDirectory: logDir
});

await errorHelper.execute(
  'Search for .log files and identify error patterns'
);
```

### URL Summarization

```typescript
const helper = new SessionHelper({
  model: 'fast',
  parentAgent: agent
});

await helper.execute(`Summarize ${url}`);
```
```

Commit:
```bash
git add -A
git commit -m "docs: add comprehensive helper usage documentation"
```

### Phase 8: Example Usage Updates

#### Task 8.1: Update Agent to Show Helper Usage

Create an example in `docs/examples/agent-with-helper.ts`:
```typescript
// Example: How an agent might use SessionHelper

import { Agent } from '~/agents/agent';
import { SessionHelper } from '~/helpers/session-helper';

class EnhancedAgent extends Agent {
  /**
   * Example: Summarize a URL during conversation
   */
  private async summarizeUrl(url: string): Promise<string> {
    const helper = new SessionHelper({
      model: 'fast',
      parentAgent: this
    });

    const result = await helper.execute(
      `Please fetch and summarize the content at ${url}`
    );

    return result.content;
  }

  /**
   * Example: Analyze complex data with smart model
   */
  private async analyzeData(data: string): Promise<string> {
    const helper = new SessionHelper({
      model: 'smart',
      parentAgent: this
    });

    const result = await helper.execute(
      `Analyze this data and provide key insights:\n${data}`
    );

    return result.content;
  }

  /**
   * Override message handling to use helpers
   */
  async handleMessage(content: string): Promise<void> {
    // Check if message contains a URL
    const urlMatch = content.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const summary = await this.summarizeUrl(urlMatch[0]);
      // Use summary in response...
    }

    // Continue with normal processing
    await super.handleMessage(content);
  }
}
```

Commit:
```bash
git add -A
git commit -m "docs: add example of agent using SessionHelper"
```

## Summary

This implementation plan provides:

1. **Clean refactoring** of ProviderToolCall → ToolCall
2. **Global configuration** system with `~/.lace/config.json`
3. **Two helper types** with clear security boundaries
4. **Multi-turn execution** within single-shot interface
5. **Comprehensive testing** with TDD approach
6. **Full documentation** and examples

### Key Testing Principles Followed

- **No mocking what we test**: Tests use real Tool implementations
- **Test behavior, not implementation**: Tests verify outcomes, not internal state
- **TDD throughout**: Write failing test, implement, verify passing
- **Integration tests**: Show real-world usage patterns

### Architecture Benefits

- **Reuses existing infrastructure**: ToolExecutor, providers, tools unchanged
- **Clear security model**: Infrastructure bypasses approval, Session inherits policies
- **Simple configuration**: Just fast/smart model mapping
- **Extensible**: Easy to add new helper types or model tiers

### Next Steps After Implementation

1. Update existing Lace systems to use InfrastructureHelper where appropriate
2. Add SessionHelper support to Agent class for common patterns
3. Monitor usage and add more model tiers if needed
4. Consider adding helper metrics/telemetry

The implementation follows YAGNI, DRY, and TDD principles throughout, with frequent commits at each passing test.