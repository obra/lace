# Claude Agent SDK Provider Implementation Plan

**Status:** Phase 5 Complete - Core Implementation Done
**Created:** 2025-10-01
**Updated:** 2025-10-01
**Goal:** Add a new provider that integrates Anthropic's Claude Agent SDK, allowing users with Claude Pro subscriptions to use Lace without per-token API costs.

## Progress Summary

✅ **Phase 0: Provider Request Context** - Architecture change complete
✅ **Phase 1: Foundation & Setup** - SDK installed, provider stub created
✅ **Phase 2: History Fingerprinting** - Session resumption logic implemented
✅ **Phase 3: MCP Tool Integration** - Lace tools wrapped in MCP server
✅ **Phase 4: Permission System** - Approval bridge with event system
✅ **Phase 5: Core Implementation** - createResponse() and createStreamingResponse() functional
⏳ **Phase 6: Integration & Configuration** - Next up
⏳ **Phase 7: Integration Testing**
⏳ **Phase 8: Documentation & Polish**
⏳ **Phase 9: Final Integration**
⏳ **Phase 10: Cleanup & Review**

---

## Background

Anthropic has released the Claude Agent SDK - a TypeScript library that wraps the Claude Code CLI and provides programmatic access to Claude using subscription-based authentication rather than API keys. This allows users with Claude Pro/Team subscriptions to use their existing subscription quota instead of paying per-token.

The SDK is a complete framework (includes its own tool system, session management, and subprocess orchestration). We'll integrate it as a new Lace provider while replacing its tool system with ours and bridging the permission/approval systems.

---

## Architecture Overview

### Key Design Decisions

1. **Provider Type:** New provider `claude-agents-sdk` that extends `AIProvider`
2. **Process Model:** New SDK subprocess spawned per `createResponse()` call
3. **Session Continuity:** Use SDK's `resume: sessionId` with history fingerprinting
4. **Tool Integration:** Create MCP server wrapping Lace's ToolExecutor, disable SDK built-in tools
5. **Permission System:** Map Lace's permission modes to SDK's, bridge approval events via Promises
6. **Message Flow:** SDK returns standard `ProviderResponse` - Agent doesn't know it's SDK

### Data Flow

```
User Message → Agent.sendMessage()
  ↓
Provider.createResponse() → Spawn SDK subprocess with query()
  ↓
SDK calls MCP tool → __lace-tools handler → ToolExecutor.execute()
  ↓
SDK approval needed → canUseTool() → Emit approval_request → Wait for response
  ↓
SDK completes turn → Extract usage/content/toolCalls
  ↓
Return ProviderResponse → Agent creates events normally
```

---

## Reference Materials

**Before starting ANY task, read these files:**

1. `packages/core/src/providers/anthropic-provider.ts` - Reference implementation
2. `packages/core/src/providers/base-provider.ts` - Provider interface
3. `packages/core/src/tools/executor.ts` - Tool execution and permissions
4. `packages/core/src/agents/agent.ts` - Lines 2850-2890 (approval flow)
5. `reference/typescript.md` - Complete SDK API documentation
6. `reference/claude-agent-sdk/sdk.d.ts` - SDK TypeScript definitions

**Key Concepts:**

- **Provider:** Abstraction layer that talks to AI services (Anthropic, OpenAI, etc.)
- **ProviderMessage:** Generic message format (`role`, `content`, `toolCalls`, `toolResults`)
- **ProviderResponse:** What providers return (`content`, `toolCalls`, `usage`, `stopReason`)
- **ToolExecutor:** Central service that manages and executes all tools
- **ToolContext:** Runtime context passed to tools (agent, workingDirectory, signal, etc.)
- **Permission Override Mode:** Session-level setting (`normal`, `yolo`, `read-only`)
- **Tool Policy:** Per-tool permission (`allow`, `ask`, `deny`, `disable`)
- **ProviderRequestContext:** Runtime context passed to providers (NEW in Phase 0)

---

## Why We Need ProviderRequestContext

The SDK provider needs access to runtime components that other providers don't need:

1. **ToolExecutor** - To execute tools through Lace's full pipeline (validation, approval, events)
2. **Session** - To access permission modes, tool policies, project MCP servers
3. **Working Directory** - Session's working directory (not project or process.cwd())
4. **Environment Variables** - Merged project + process environment
5. **Agent** - For delegation tools and logging context

**Phase 0 adds this context to the provider interface** so SDK provider (and future providers) can access these components.

**Benefits of Context Parameter:**
- ✅ Full tool approval flow (not just yolo mode)
- ✅ Project MCP servers merged with SDK
- ✅ Tools run in correct working directory with project env vars
- ✅ Delegation tools work (Task tool, agent spawning)
- ✅ ToolExecutor manages temp directories
- ✅ Full permission system (normal/yolo/read-only modes)

---

## Implementation Tasks

### Phase 0: Add Provider Request Context (Architecture Change)

#### Task 0.1: Add ProviderRequestContext Interface

**Goal:** Enable providers to access runtime context (agent, executor, session, working directory).

**Files to modify:**
- `packages/core/src/providers/base-provider.ts`

**Add interface before AIProvider class:**

```typescript
/**
 * Runtime context passed to provider methods
 * Provides access to agent, executor, session for advanced provider features
 */
export interface ProviderRequestContext {
  /** Agent making the request (for delegation, logging) */
  agent?: Agent;

  /** Tool executor for proper tool execution with approval flow */
  toolExecutor?: ToolExecutor;

  /** Session for accessing project config, MCP servers, permissions */
  session?: Session;

  /** Session's working directory (not project directory) */
  workingDirectory?: string;

  /** Merged process + project environment variables */
  processEnv?: NodeJS.ProcessEnv;
}
```

**Update AIProvider abstract methods:**

```typescript
  abstract createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext  // NEW parameter
  ): Promise<ProviderResponse>;

  // Optional streaming support - providers can override this
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext  // NEW parameter
  ): Promise<ProviderResponse> {
    // Default implementation: fall back to non-streaming
    return this.createResponse(messages, tools, model, signal, context);
  }
```

**Add to imports at top of file:**

```typescript
import type { Agent } from '~/agents/agent';
import type { ToolExecutor } from '~/tools/executor';
import type { Session } from '~/sessions/session';
```

**Testing:**
```bash
npm run type-check  # Verify no type errors
```

**Commit:** `feat(providers): add ProviderRequestContext to provider interface`

---

#### Task 0.2: Update All Existing Providers

**Goal:** Add optional context parameter to all existing providers (they can ignore it).

**Files to modify:**
- `packages/core/src/providers/anthropic-provider.ts`
- `packages/core/src/providers/openai-provider.ts`
- `packages/core/src/providers/lmstudio-provider.ts`
- `packages/core/src/providers/ollama-provider.ts`
- `packages/core/src/providers/gemini-provider.ts`
- Any other provider implementations

**For each provider, update method signatures:**

```typescript
// Example for AnthropicProvider
async createResponse(
  messages: ProviderMessage[],
  tools: Tool[] = [],
  model: string,
  signal?: AbortSignal,
  context?: ProviderRequestContext  // NEW - optional, can be ignored
): Promise<ProviderResponse> {
  // Existing implementation unchanged
  // These providers don't need context (yet)
}

async createStreamingResponse(
  messages: ProviderMessage[],
  tools: Tool[] = [],
  model: string,
  signal?: AbortSignal,
  context?: ProviderRequestContext  // NEW
): Promise<ProviderResponse> {
  // Existing implementation unchanged
}
```

**Note:** Existing providers work unchanged - context is optional.

**Testing:**
```bash
npm test  # All existing provider tests should still pass
```

**Commit:** `refactor(providers): add optional context parameter to existing providers`

---

#### Task 0.3: Update Agent to Pass Context

**Goal:** Modify Agent to build and pass context to providers.

**Files to modify:**
- `packages/core/src/agents/agent.ts`

**Find the `_createResponse()` method (around line 1078) and update:**

```typescript
  private async _createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    signal?: AbortSignal
  ): Promise<AgentMessageResult> {
    const provider = await this.getProvider();

    if (!provider) {
      throw new Error('Provider not initialized');
    }

    const metadata = this.getThreadMetadata();
    const modelId = metadata?.modelId as string;

    // NEW: Build provider request context
    const session = await this.getFullSession();
    const context: ProviderRequestContext = {
      agent: this,
      toolExecutor: this._toolExecutor,
      session: session || undefined,
      workingDirectory: this._getWorkingDirectory(),
      processEnv: session
        ? this._envManager.getMergedEnvironment(session.getProjectId())
        : process.env,
    };

    // Check if provider supports streaming
    if (provider.supportsStreaming && this._config.streaming) {
      try {
        const response = await provider.createStreamingResponse(
          messages,
          tools,
          modelId,
          signal,
          context  // NEW: Pass context
        );
        // ... rest of streaming logic
      }
    }

    // Non-streaming path
    if (!this.providerInstance) {
      throw new Error('Cannot create response with missing provider instance');
    }

    const response = await this.providerInstance.createResponse(
      messages,
      tools,
      modelId,
      signal,
      context  // NEW: Pass context
    );

    // ... rest of method
  }
```

**Add import at top of file:**
```typescript
import type { ProviderRequestContext } from '~/providers/base-provider';
```

**Testing:**
```bash
npm test -- agent.test.ts
# Existing tests should pass - providers ignore context
```

**Commit:** `feat(agent): pass request context to providers`

---

### Phase 1: Foundation & Setup

#### Task 1.1: Install SDK Dependency

**Goal:** Add the Claude Agent SDK package to the project.

**Files to modify:**
- `packages/core/package.json`

**Steps:**
1. Run: `npm install @anthropic-ai/claude-agent-sdk --workspace=packages/core`
2. Verify installation: `npm list @anthropic-ai/claude-agent-sdk`
3. Check that TypeScript types are available (SDK includes `.d.ts` files)

**Testing:**
```bash
cd packages/core
node -e "require('@anthropic-ai/claude-agent-sdk')"
# Should not throw
```

**Commit:** `feat: add claude-agent-sdk dependency`

---

#### Task 1.2: Create Provider Stub

**Goal:** Create basic provider class structure without functionality.

**Files to create:**
- `packages/core/src/providers/claude-sdk-provider.ts`
- `packages/core/src/providers/claude-sdk-provider.test.ts`

**Implementation:**

```typescript
// ABOUTME: Claude Agent SDK provider using subscription-based authentication
// ABOUTME: Integrates Anthropic's SDK while using Lace's tool system and approval flow

import { AIProvider, ProviderConfig, ProviderResponse, ProviderInfo, ModelInfo } from '~/providers/base-provider';
import type { ProviderMessage } from '~/providers/base-provider';
import type { Tool } from '~/tools/tool';
import { logger } from '~/utils/logger';

interface ClaudeSDKProviderConfig extends ProviderConfig {
  sessionToken: string | null; // SDK session credentials
}

export class ClaudeSDKProvider extends AIProvider {
  private sessionId?: string;
  private lastHistoryFingerprint?: string;

  constructor(config: ClaudeSDKProviderConfig) {
    super(config);
  }

  get providerName(): string {
    return 'claude-agents-sdk';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ): Promise<ProviderResponse> {
    throw new Error('Not implemented');
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'claude-agents-sdk',
      displayName: 'Claude Agent SDK (Subscription)',
      requiresApiKey: true,
      configurationHint: 'Requires Claude Pro/Team subscription authentication',
    };
  }

  getAvailableModels(): ModelInfo[] {
    // Hardcoded fallback - will be replaced with dynamic fetching
    return [
      this.createModel({
        id: 'claude-sonnet-4',
        displayName: 'Claude 4 Sonnet',
        description: 'Balanced performance and capability',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        isDefault: true,
      }),
      this.createModel({
        id: 'claude-opus-4',
        displayName: 'Claude 4 Opus',
        description: 'Most capable model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
      this.createModel({
        id: 'claude-haiku-4',
        displayName: 'Claude 4 Haiku',
        description: 'Fastest model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      }),
    ];
  }

  isConfigured(): boolean {
    const config = this._config as ClaudeSDKProviderConfig;
    return !!config.sessionToken && config.sessionToken.length > 0;
  }
}
```

**Test file:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';

describe('ClaudeSDKProvider', () => {
  let provider: ClaudeSDKProvider;

  beforeEach(() => {
    provider = new ClaudeSDKProvider({ sessionToken: 'test-token' });
  });

  it('should have correct provider name', () => {
    expect(provider.providerName).toBe('claude-agents-sdk');
  });

  it('should support streaming', () => {
    expect(provider.supportsStreaming).toBe(true);
  });

  it('should return provider info', () => {
    const info = provider.getProviderInfo();
    expect(info.name).toBe('claude-agents-sdk');
    expect(info.displayName).toContain('SDK');
    expect(info.requiresApiKey).toBe(true);
  });

  it('should return model list', () => {
    const models = provider.getAvailableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id.includes('sonnet'))).toBe(true);
  });

  it('should check configuration', () => {
    expect(provider.isConfigured()).toBe(true);

    const unconfigured = new ClaudeSDKProvider({ sessionToken: null });
    expect(unconfigured.isConfigured()).toBe(false);
  });

  it('should throw on createResponse (not implemented)', async () => {
    await expect(
      provider.createResponse([], [], 'model', undefined, undefined)
    ).rejects.toThrow('Not implemented');
  });
});
```

**Files to modify:**
- `packages/core/src/providers/registry.ts` - Add to provider registry

**Testing:**
```bash
npm test -- claude-sdk-provider.test.ts
```

**Commit:** `feat(providers): add claude-sdk provider stub`

---

### Phase 2: History Fingerprinting & Session Management

#### Task 2.1: Implement History Fingerprinting

**Goal:** Track conversation history to detect when we can resume vs need new session.

**Files to modify:**
- `packages/core/src/providers/claude-sdk-provider.ts`

**Add to imports:**
```typescript
import { createHash } from 'crypto';
```

**Add private method:**
```typescript
  /**
   * Fingerprint conversation history to detect changes (compaction, edits)
   * Returns SHA256 hash of all messages to enable change detection
   */
  private fingerprintHistory(messages: ProviderMessage[]): string {
    return createHash('sha256')
      .update(JSON.stringify(messages))
      .digest('hex');
  }

  /**
   * Check if history has changed since last turn
   * Returns true if we can resume, false if we need new session
   */
  private canResumeSession(messages: ProviderMessage[]): boolean {
    if (!this.sessionId || !this.lastHistoryFingerprint) {
      return false;
    }

    // Fingerprint everything except the latest user message
    const historyMessages = messages.slice(0, -1);
    const currentFingerprint = this.fingerprintHistory(historyMessages);

    return currentFingerprint === this.lastHistoryFingerprint;
  }

  /**
   * Update fingerprint after successful turn
   */
  private updateFingerprint(messages: ProviderMessage[]): void {
    this.lastHistoryFingerprint = this.fingerprintHistory(messages);
  }
```

**Test file additions:**

```typescript
describe('ClaudeSDKProvider - Session Management', () => {
  it('should not resume on first turn', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const messages = [{ role: 'user', content: 'Hello' }];

    // Access private method via type assertion for testing
    expect((provider as any).canResumeSession(messages)).toBe(false);
  });

  it('should resume when history unchanged', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ];

    // Simulate first turn
    (provider as any).sessionId = 'session-123';
    (provider as any).updateFingerprint(messages.slice(0, -1));

    // Check second turn with same history
    expect((provider as any).canResumeSession(messages)).toBe(true);
  });

  it('should not resume when history changed', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    // First conversation
    const messages1 = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Question' },
    ];

    (provider as any).sessionId = 'session-123';
    (provider as any).updateFingerprint(messages1.slice(0, -1));

    // Compacted conversation (different history)
    const messages2 = [
      { role: 'assistant', content: 'Summary of previous conversation' },
      { role: 'user', content: 'New question' },
    ];

    expect((provider as any).canResumeSession(messages2)).toBe(false);
  });
});
```

**Testing:**
```bash
npm test -- claude-sdk-provider.test.ts
```

**Commit:** `feat(claude-sdk): add history fingerprinting for session resumption`

---

### Phase 3: MCP Tool Integration

#### Task 3.1: Create Lace Tools MCP Server

**Goal:** Wrap Lace's tools in an SDK MCP server so the SDK calls our tool execution system.

**Files to modify:**
- `packages/core/src/providers/claude-sdk-provider.ts`

**Add to imports:**
```typescript
import { createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@anthropic-ai/claude-agent-sdk';
import type { ToolExecutor } from '~/tools/executor';
import type { ToolContext, ToolResult } from '~/tools/types';
```

**Add private methods:**

```typescript
  /**
   * Convert Lace's ToolResult to MCP CallToolResult format
   */
  private convertToolResultToMCP(result: ToolResult): CallToolResult {
    return {
      content: result.content.map(block => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text || '' };
        } else if (block.type === 'image') {
          return { type: 'image', data: block.data || '', mimeType: 'image/png' };
        } else if (block.type === 'resource') {
          return { type: 'resource', uri: block.uri || '', text: block.text };
        }
        return { type: 'text', text: JSON.stringify(block) };
      }),
      isError: result.status !== 'completed',
    };
  }

  /**
   * Create MCP server that wraps all Lace tools
   * Uses ToolExecutor for full pipeline: validation, approval, execution
   */
  private createLaceToolsServer(
    context: ProviderRequestContext
  ): ReturnType<typeof createSdkMcpServer> {
    if (!context.toolExecutor) {
      throw new Error('ToolExecutor required for MCP server creation');
    }

    const tools = context.toolExecutor.getAllTools();

    logger.debug('Creating Lace MCP server', {
      toolCount: tools.length,
      toolNames: tools.map(t => t.name),
    });

    const mcpTools = tools.map(tool =>
      sdkTool(
        tool.name,
        tool.description,
        tool.schema.shape, // Zod shape for MCP
        async (args: Record<string, unknown>, extra: unknown) => {
          logger.debug('MCP tool called via SDK', {
            toolName: tool.name,
            args,
          });

          // Create tool call matching Lace's format
          const toolCall = {
            id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: tool.name,
            arguments: args,
          };

          // Build ToolContext from provider context
          const toolContext = {
            signal: new AbortController().signal, // TODO: Get from SDK if available
            workingDirectory: context.workingDirectory,
            agent: context.agent,
            processEnv: context.processEnv,
          };

          try {
            // Execute via Lace's ToolExecutor (full pipeline)
            // This handles: validation, approval flow, execution, events
            const result = await context.toolExecutor!.execute(toolCall, toolContext);

            logger.debug('MCP tool completed', {
              toolName: tool.name,
              status: result.status,
            });

            return this.convertToolResultToMCP(result);
          } catch (error) {
            logger.error('MCP tool execution failed', {
              toolName: tool.name,
              error: error instanceof Error ? error.message : String(error),
            });

            return {
              content: [{
                type: 'text',
                text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            };
          }
        }
      )
    );

    return createSdkMcpServer({
      name: '__lace-tools',
      version: '1.0.0',
      tools: mcpTools,
    });
  }
```

**Test additions:**

```typescript
import { ToolExecutor } from '~/tools/executor';
import { ReadTool } from '~/tools/implementations/read';
import type { ProviderRequestContext } from '~/providers/base-provider';

describe('ClaudeSDKProvider - MCP Integration', () => {
  it('should create MCP server from context', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const toolExecutor = new ToolExecutor();
    toolExecutor.registerTool(new ReadTool());

    const context: ProviderRequestContext = {
      toolExecutor,
      workingDirectory: '/test',
    };

    const server = (provider as any).createLaceToolsServer(context);

    expect(server).toBeDefined();
    expect(server.type).toBe('sdk');
    expect(server.name).toBe('__lace-tools');
  });

  it('should throw if context lacks toolExecutor', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const context: ProviderRequestContext = {
      workingDirectory: '/test',
    };

    expect(() => {
      (provider as any).createLaceToolsServer(context);
    }).toThrow('ToolExecutor required');
  });

  it('should convert ToolResult to CallToolResult', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    const toolResult = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'image', data: 'base64data', mimeType: 'image/png' },
      ],
      status: 'completed',
    };

    const mcpResult = (provider as any).convertToolResultToMCP(toolResult);

    expect(mcpResult.content).toHaveLength(2);
    expect(mcpResult.content[0].type).toBe('text');
    expect(mcpResult.isError).toBe(false);
  });

  it('should mark failed results as errors', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    const toolResult = {
      content: [{ type: 'text', text: 'Error message' }],
      status: 'failed',
    };

    const mcpResult = (provider as any).convertToolResultToMCP(toolResult);
    expect(mcpResult.isError).toBe(true);
  });
});
```

**Testing:**
```bash
npm test -- claude-sdk-provider.test.ts
```

**Commit:** `feat(claude-sdk): add MCP server wrapping Lace tools`

---

### Phase 4: Permission System Integration

#### Task 4.1: Implement Permission Mode Mapping

**Goal:** Map Lace's permission override modes to SDK's permission modes.

**Files to modify:**
- `packages/core/src/providers/claude-sdk-provider.ts`

**Add to imports:**
```typescript
import type { PermissionMode as SDKPermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionOverrideMode } from '~/tools/types';
```

**Add private method:**

```typescript
  /**
   * Map Lace's permission override mode to SDK permission mode
   */
  private mapPermissionMode(laceMode: PermissionOverrideMode): SDKPermissionMode {
    switch (laceMode) {
      case 'yolo':
        return 'bypassPermissions';
      case 'read-only':
        return 'plan'; // Plan mode doesn't execute, only plans
      case 'normal':
      default:
        return 'default';
    }
  }
```

**Test additions:**

```typescript
describe('ClaudeSDKProvider - Permissions', () => {
  it('should map yolo to bypassPermissions', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect((provider as any).mapPermissionMode('yolo')).toBe('bypassPermissions');
  });

  it('should map read-only to plan', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect((provider as any).mapPermissionMode('read-only')).toBe('plan');
  });

  it('should map normal to default', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect((provider as any).mapPermissionMode('normal')).toBe('default');
  });
});
```

**Testing:**
```bash
npm test -- claude-sdk-provider.test.ts
```

**Commit:** `feat(claude-sdk): add permission mode mapping`

---

#### Task 4.2: Implement Approval Bridge

**Goal:** Bridge SDK's `canUseTool` callback with Lace's approval event system.

**Files to modify:**
- `packages/core/src/providers/claude-sdk-provider.ts`

**Add to class:**

```typescript
  // Map of pending tool approvals waiting for user decision
  private pendingApprovals = new Map<string, {
    resolve: (decision: ApprovalDecision) => void;
    reject: (error: Error) => void;
  }>();
```

**Add to imports:**
```typescript
import type { ApprovalDecision } from '~/tools/types';
import type { PermissionResult, CanUseTool } from '@anthropic-ai/claude-agent-sdk';
```

**Add private methods:**

```typescript
  /**
   * Handle approval response from external event system
   * Called when TOOL_APPROVAL_RESPONSE event arrives
   */
  public handleApprovalResponse(toolCallId: string, decision: ApprovalDecision): void {
    const pending = this.pendingApprovals.get(toolCallId);
    if (pending) {
      logger.debug('Resolving pending approval', { toolCallId, decision });
      pending.resolve(decision);
      this.pendingApprovals.delete(toolCallId);
    } else {
      logger.warn('Received approval response for unknown tool call', { toolCallId });
    }
  }

  /**
   * Build canUseTool callback that integrates with Lace's approval system
   * This is passed to SDK and called before each tool execution
   *
   * NOTE: This handler is called by SDK BEFORE tool execution to check permissions.
   * It does NOT execute the tool - that happens in the MCP handler.
   * This is purely for permission checking and approval flow.
   */
  private buildCanUseToolHandler(
    context: ProviderRequestContext
  ): CanUseTool {
    const { toolExecutor, session } = context;

    if (!toolExecutor || !session) {
      throw new Error('ToolExecutor and Session required for approval handler');
    }

    return async (toolName, input, { signal, suggestions }) => {
      try {
        // Check tool allowlist first (fail-closed security)
        const config = session.getEffectiveConfiguration();
        if (config.tools && !config.tools.includes(toolName)) {
          logger.debug('Tool denied - not in allowlist', { toolName });
          return {
            behavior: 'deny',
            message: `Tool '${toolName}' is not in the allowed tools list`,
            interrupt: false,
          };
        }

        // Check if tool is marked as safeInternal (auto-allowed)
        const tool = toolExecutor.getTool(toolName);
        if (tool?.annotations?.safeInternal) {
          logger.debug('Tool auto-allowed - safeInternal', { toolName });
          return { behavior: 'allow', updatedInput: input };
        }

        // Get effective policy (respects permission override mode)
        const configuredPolicy = session.getToolPolicy(toolName);
        const effectivePolicy = tool
          ? toolExecutor.getEffectivePolicy(tool, configuredPolicy)
          : configuredPolicy;

        logger.debug('Checking tool permission', {
          toolName,
          configuredPolicy,
          effectivePolicy,
          permissionMode: session.getPermissionOverrideMode(),
        });

        // Handle based on effective policy
        switch (effectivePolicy) {
          case 'allow':
            return { behavior: 'allow', updatedInput: input };

          case 'deny':
            return {
              behavior: 'deny',
              message: `Tool '${toolName}' is denied by policy`,
              interrupt: false,
            };

          case 'ask':
            // Need user approval - create promise and emit event
            const toolCallId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            logger.debug('Requesting tool approval', { toolName, toolCallId });

            const approvalPromise = new Promise<ApprovalDecision>((resolve, reject) => {
              this.pendingApprovals.set(toolCallId, { resolve, reject });

              // Emit event for external approval system
              this.emit('approval_request', {
                toolName,
                input,
                isReadOnly: tool?.annotations?.readOnlySafe || false,
                requestId: toolCallId,
                resolve, // Pass resolve directly so emitter can resolve
              });

              // Handle abort
              signal.addEventListener('abort', () => {
                this.pendingApprovals.delete(toolCallId);
                reject(new Error('Tool approval aborted'));
              }, { once: true });
            });

            // Wait for approval decision
            const decision = await approvalPromise;

            logger.debug('Approval received', { toolName, toolCallId, decision });

            // Check if approval was granted
            const isAllowed = [
              ApprovalDecision.ALLOW_ONCE,
              ApprovalDecision.ALLOW_SESSION,
              ApprovalDecision.ALLOW_PROJECT,
              ApprovalDecision.ALLOW_ALWAYS,
            ].includes(decision);

            if (isAllowed) {
              return { behavior: 'allow', updatedInput: input };
            } else {
              return {
                behavior: 'deny',
                message: 'User denied tool execution',
                interrupt: true,
              };
            }

          default:
            // Safe default: require approval
            logger.warn('Unknown policy, defaulting to ask', { effectivePolicy });
            return {
              behavior: 'deny',
              message: `Unknown policy for tool '${toolName}'`,
              interrupt: false,
            };
        }
      } catch (error) {
        logger.error('Error in canUseTool handler', {
          toolName,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          behavior: 'deny',
          message: `Permission check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          interrupt: false,
        };
      }
    };
  }
```

**Test additions:**

```typescript
import { ApprovalDecision } from '~/tools/types';

describe('ClaudeSDKProvider - Approval System', () => {
  it('should create pending approval and resolve it', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const toolCallId = 'test-call-123';

    // Create a promise that will be resolved by handleApprovalResponse
    const promise = new Promise<ApprovalDecision>((resolve) => {
      (provider as any).pendingApprovals.set(toolCallId, {
        resolve,
        reject: () => {}
      });
    });

    // Simulate approval response
    provider.handleApprovalResponse(toolCallId, ApprovalDecision.ALLOW_ONCE);

    // Promise should resolve
    const decision = await promise;
    expect(decision).toBe(ApprovalDecision.ALLOW_ONCE);
    expect((provider as any).pendingApprovals.has(toolCallId)).toBe(false);
  });

  it('should handle unknown approval responses gracefully', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    // Should not throw
    expect(() => {
      provider.handleApprovalResponse('unknown-id', ApprovalDecision.DENY);
    }).not.toThrow();
  });

  // Note: Full canUseTool testing requires Session mock - will be done in integration tests
});
```

**Testing:**
```bash
npm test -- claude-sdk-provider.test.ts
```

**Commit:** `feat(claude-sdk): add approval bridge with event system`

---

### Phase 5: Core Provider Implementation

#### Task 5.1: Implement createResponse()

**Goal:** Implement the main provider method that calls the SDK and returns responses.

**Files to modify:**
- `packages/core/src/providers/claude-sdk-provider.ts`

**Add to imports:**
```typescript
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
```

**Replace the stub `createResponse()` method:**

```typescript
  async createResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ): Promise<ProviderResponse> {
    logger.info('SDK Provider createResponse', {
      messageCount: messages.length,
      toolCount: tools.length,
      model,
      hasSession: !!this.sessionId,
      hasContext: !!context,
    });

    // Get config
    const config = this._config as ClaudeSDKProviderConfig;
    if (!config.sessionToken) {
      throw new Error('SDK provider not configured: missing session token');
    }

    if (!context) {
      throw new Error('SDK provider requires ProviderRequestContext');
    }

    // Check if we can resume previous session
    const canResume = this.canResumeSession(messages);
    const latestMessage = messages[messages.length - 1];

    if (!latestMessage || latestMessage.role !== 'user') {
      throw new Error('Last message must be a user message');
    }

    logger.debug('SDK query configuration', {
      canResume,
      sessionId: this.sessionId,
      model,
      systemPrompt: this._systemPrompt?.substring(0, 100),
    });

    // Create MCP server wrapping Lace tools
    const laceToolsServer = this.createLaceToolsServer(context);

    // Get project MCP servers if session available
    const projectMcpServers = context.session?.getProject()?.getMCPServers() || {};

    // Get permission mode from session
    const permissionMode = context.session
      ? this.mapPermissionMode(context.session.getPermissionOverrideMode())
      : 'default';

    // Build SDK query options
    const queryOptions = {
      resume: canResume ? this.sessionId : undefined,
      forkSession: !canResume && this.sessionId !== undefined,
      model,
      systemPrompt: this._systemPrompt,
      cwd: context.workingDirectory,
      env: context.processEnv,
      includePartialMessages: false, // Disable for non-streaming
      settingSources: [], // Don't load filesystem settings
      mcpServers: {
        '__lace-tools': laceToolsServer,
        ...projectMcpServers,
      },
      allowedTools: ['WebSearch'], // Only SDK's server-side WebSearch
      permissionMode,
      canUseTool: this.buildCanUseToolHandler(context),
      abortController: signal ? { signal } as AbortController : undefined,
    };

    // Create SDK query
    const query = sdkQuery({
      prompt: latestMessage.content,
      options: queryOptions,
    });

    // Process SDK messages
    let content = '';
    let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let usage: ProviderResponse['usage'];
    let stopReason: string | undefined;

    try {
      for await (const msg of query) {
        logger.debug('SDK message received', { type: msg.type });

        if (msg.type === 'system' && msg.subtype === 'init') {
          // Capture session ID for next turn
          this.sessionId = msg.session_id;
          logger.debug('SDK session initialized', { sessionId: this.sessionId });
        }

        if (msg.type === 'assistant') {
          // Extract content and tool calls from Anthropic message format
          const anthropicMsg = msg.message;

          // Extract text content
          const textBlocks = anthropicMsg.content.filter(
            (block: any) => block.type === 'text'
          );
          content = textBlocks.map((block: any) => block.text).join('');

          // Extract tool calls
          const toolUseBlocks = anthropicMsg.content.filter(
            (block: any) => block.type === 'tool_use'
          );
          toolCalls = toolUseBlocks.map((block: any) => ({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          }));

          logger.debug('Assistant message processed', {
            contentLength: content.length,
            toolCallCount: toolCalls.length,
          });
        }

        if (msg.type === 'result') {
          // Extract usage and stop reason
          if (msg.subtype === 'success') {
            usage = {
              promptTokens: msg.usage.input_tokens,
              completionTokens: msg.usage.output_tokens,
              totalTokens: msg.usage.input_tokens + msg.usage.output_tokens,
            };
            stopReason = 'stop'; // Success = natural stop
          } else {
            // Error subtypes
            stopReason = 'error';
            throw new Error(`SDK execution failed: ${msg.subtype}`);
          }

          logger.debug('SDK result received', {
            subtype: msg.subtype,
            usage,
          });
          break; // Exit iteration
        }
      }

      // Update fingerprint for next turn
      this.updateFingerprint(messages);

      return {
        content,
        toolCalls,
        stopReason,
        usage,
      };

    } catch (error) {
      logger.error('SDK query failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
```

**Test additions:**

```typescript
// Note: These are minimal tests - full testing requires SDK mocking
describe('ClaudeSDKProvider - createResponse', () => {
  it('should throw if not configured', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: null });

    await expect(
      provider.createResponse(
        [{ role: 'user', content: 'Hello' }],
        [],
        'sonnet'
      )
    ).rejects.toThrow('not configured');
  });

  it('should throw if last message is not user message', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    await expect(
      provider.createResponse(
        [{ role: 'assistant', content: 'Hello' }],
        [],
        'sonnet'
      )
    ).rejects.toThrow('must be a user message');
  });

  // Full SDK integration tests will be in separate integration test file
});
```

**Commit:** `feat(claude-sdk): implement createResponse with SDK integration`

---

#### Task 5.2: Add Streaming Support

**Goal:** Implement streaming responses with token-by-token emission.

**Files to modify:**
- `packages/core/src/providers/claude-sdk-provider.ts`

**Add method:**

```typescript
  async createStreamingResponse(
    messages: ProviderMessage[],
    tools: Tool[],
    model: string,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ): Promise<ProviderResponse> {
    logger.info('SDK Provider createStreamingResponse', {
      messageCount: messages.length,
      toolCount: tools.length,
      model,
    });

    const config = this._config as ClaudeSDKProviderConfig;
    if (!config.sessionToken) {
      throw new Error('SDK provider not configured: missing session token');
    }

    if (!context) {
      throw new Error('SDK provider requires ProviderRequestContext');
    }

    const canResume = this.canResumeSession(messages);
    const latestMessage = messages[messages.length - 1];

    if (!latestMessage || latestMessage.role !== 'user') {
      throw new Error('Last message must be a user message');
    }

    // Create MCP server wrapping Lace tools
    const laceToolsServer = this.createLaceToolsServer(context);

    // Get project MCP servers
    const projectMcpServers = context.session?.getProject()?.getMCPServers() || {};

    // Get permission mode from session
    const permissionMode = context.session
      ? this.mapPermissionMode(context.session.getPermissionOverrideMode())
      : 'default';

    // Build query options with streaming enabled
    const queryOptions = {
      resume: canResume ? this.sessionId : undefined,
      forkSession: !canResume && this.sessionId !== undefined,
      model,
      systemPrompt: this._systemPrompt,
      cwd: context.workingDirectory,
      env: context.processEnv,
      includePartialMessages: true, // Enable streaming
      settingSources: [],
      mcpServers: {
        '__lace-tools': laceToolsServer,
        ...projectMcpServers,
      },
      allowedTools: ['WebSearch'],
      permissionMode,
      canUseTool: this.buildCanUseToolHandler(context),
      abortController: signal ? { signal } as AbortController : undefined,
    };

    const query = sdkQuery({
      prompt: latestMessage.content,
      options: queryOptions,
    });

    let content = '';
    let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let usage: ProviderResponse['usage'];
    let stopReason: string | undefined;

    try {
      for await (const msg of query) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          this.sessionId = msg.session_id;
        }

        // Handle streaming events
        if (msg.type === 'stream_event') {
          const event = msg.event;

          // Extract text deltas from Anthropic streaming format
          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              const textDelta = event.delta.text;
              this.emit('token', { token: textDelta });
            }
          }

          // Track progressive token usage
          if (event.type === 'message_delta' && event.usage) {
            this.emit('token_usage_update', {
              usage: {
                promptTokens: event.usage.input_tokens || 0,
                completionTokens: event.usage.output_tokens || 0,
                totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              },
            });
          }
        }

        if (msg.type === 'assistant') {
          const anthropicMsg = msg.message;

          const textBlocks = anthropicMsg.content.filter(
            (block: any) => block.type === 'text'
          );
          content = textBlocks.map((block: any) => block.text).join('');

          const toolUseBlocks = anthropicMsg.content.filter(
            (block: any) => block.type === 'tool_use'
          );
          toolCalls = toolUseBlocks.map((block: any) => ({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          }));
        }

        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            usage = {
              promptTokens: msg.usage.input_tokens,
              completionTokens: msg.usage.output_tokens,
              totalTokens: msg.usage.input_tokens + msg.usage.output_tokens,
            };
            stopReason = 'stop';

            // Emit final usage
            this.emit('token_usage_update', { usage });
          } else {
            stopReason = 'error';
            throw new Error(`SDK execution failed: ${msg.subtype}`);
          }
          break;
        }
      }

      this.updateFingerprint(messages);

      const response = {
        content,
        toolCalls,
        stopReason,
        usage,
      };

      // Emit completion
      this.emit('complete', { response });

      return response;

    } catch (error) {
      logger.error('SDK streaming query failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
```

**Test additions:**

```typescript
describe('ClaudeSDKProvider - Streaming', () => {
  it('should support streaming', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    expect(provider.supportsStreaming).toBe(true);
  });

  // Streaming integration tests will verify token emission
});
```

**Commit:** `feat(claude-sdk): add streaming support with token emission`

---

### Phase 6: Integration & Configuration ✅

**Status:** Complete

**Commit:** `a1efe03ef` - feat(providers): add Claude Agent SDK catalog entry

#### Task 6.1: Add Provider to Registry ✅

**Goal:** Register the new provider so it can be discovered and used.

**What was done:**
- Provider was already registered in `registry.ts` during Phase 1
- Added to provider list in `getAvailableProviders()`
- Added to `getProviderForMetadata()` switch statement
- Added to `createProvider()` switch statement

**Testing:** All provider registry tests pass ✅

---

#### Task 6.2: Add Provider Catalog Entry ✅

**Goal:** Add SDK provider to the catalog system for UI discovery.

**What was done:**
Created `packages/core/src/providers/catalog/data/claude-agents-sdk.json`:

```json
{
  "name": "Claude Agent SDK",
  "id": "claude-agents-sdk",
  "type": "claude-agents-sdk",
  "api_key": "$CLAUDE_SESSION_TOKEN",
  "default_large_model_id": "claude-opus-4",
  "default_small_model_id": "claude-haiku-4",
  "models": [
    {
      "id": "claude-sonnet-4",
      "name": "Claude 4 Sonnet",
      "cost_per_1m_in": 0,
      "cost_per_1m_out": 0,
      "context_window": 200000,
      "default_max_tokens": 8192,
      "can_reason": true,
      "supports_attachments": true
    },
    {
      "id": "claude-opus-4",
      "name": "Claude 4 Opus",
      "cost_per_1m_in": 0,
      "cost_per_1m_out": 0,
      "context_window": 200000,
      "default_max_tokens": 8192,
      "can_reason": true,
      "supports_attachments": true
    },
    {
      "id": "claude-haiku-4",
      "name": "Claude 4 Haiku",
      "cost_per_1m_in": 0,
      "cost_per_1m_out": 0,
      "context_window": 200000,
      "default_max_tokens": 8192,
      "can_reason": false,
      "supports_attachments": true
    }
  ]
}
```

**Key design decisions:**
- Costs are $0 because this provider uses subscription authentication
- Models match those hardcoded in `claude-sdk-provider.ts`
- Environment variable support via `$CLAUDE_SESSION_TOKEN`
- Reasoning support enabled for Opus and Sonnet models

**Testing:** All catalog tests pass ✅
```bash
npm test -- src/providers/catalog
npm test -- src/providers/provider-registry.test.ts
npm test  # Full suite: 1808 passed | 25 skipped
```

---

### Phase 7: Integration Testing

#### Task 7.1: Create Integration Test File

**Goal:** Test the complete flow with mocked SDK.

**Files to create:**
- `packages/core/src/providers/claude-sdk-integration.test.ts`

**Implementation:**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';
import { ToolExecutor } from '~/tools/executor';
import { ReadTool } from '~/tools/implementations/read';

// Mock the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn((opts) => ({
    type: 'sdk',
    name: opts.name,
    instance: {},
  })),
  tool: vi.fn((name, desc, schema, handler) => ({
    name,
    description: desc,
    inputSchema: schema,
    handler,
  })),
}));

describe('ClaudeSDKProvider - Integration', () => {
  let provider: ClaudeSDKProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    provider = new ClaudeSDKProvider({ sessionToken: 'test-token' });
    toolExecutor = new ToolExecutor();
    toolExecutor.registerTool(new ReadTool());
  });

  it('should complete full request-response cycle', async () => {
    // This test will be expanded once we understand SDK mocking better
    expect(provider).toBeDefined();
  });

  it('should handle tool execution via MCP', async () => {
    const context: ProviderRequestContext = {
      toolExecutor,
      workingDirectory: '/test',
    };

    const server = (provider as any).createLaceToolsServer(context);
    expect(server.name).toBe('__lace-tools');
  });

  it('should emit tokens during streaming', async () => {
    const tokens: string[] = [];
    provider.on('token', ({ token }) => tokens.push(token));

    // Mock streaming response - to be implemented with SDK mock
    // expect(tokens.length).toBeGreaterThan(0);
  });
});
```

**Testing:**
```bash
npm test -- claude-sdk-integration.test.ts
```

**Commit:** `test(claude-sdk): add integration tests`

---

#### Task 7.2: Add End-to-End Test

**Goal:** Test with a real SDK call (requires credentials, may be manual).

**Files to create:**
- `packages/core/src/providers/claude-sdk-e2e.test.ts`

**Implementation:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';
import { ToolExecutor } from '~/tools/executor';

// Skip by default - requires real credentials
describe.skip('ClaudeSDKProvider - E2E', () => {
  let provider: ClaudeSDKProvider;

  beforeEach(() => {
    const sessionToken = process.env.CLAUDE_SDK_SESSION_TOKEN;
    if (!sessionToken) {
      throw new Error('CLAUDE_SDK_SESSION_TOKEN not set');
    }

    provider = new ClaudeSDKProvider({ sessionToken });
  });

  it('should make real SDK request', async () => {
    const messages = [
      { role: 'user' as const, content: 'What is 2+2?' }
    ];

    const response = await provider.createResponse(
      messages,
      [],
      'sonnet'
    );

    expect(response.content).toBeTruthy();
    expect(response.content.toLowerCase()).toContain('4');
  }, 30000); // 30 second timeout

  it('should handle streaming', async () => {
    const tokens: string[] = [];
    provider.on('token', ({ token }) => tokens.push(token));

    const messages = [
      { role: 'user' as const, content: 'Count to 5' }
    ];

    await provider.createStreamingResponse(messages, [], 'sonnet');

    expect(tokens.length).toBeGreaterThan(0);
  }, 30000);
});
```

**Manual testing:**
```bash
# Set credentials
export CLAUDE_SDK_SESSION_TOKEN="your-token-here"

# Run e2e tests
npm test -- claude-sdk-e2e.test.ts
```

**Commit:** `test(claude-sdk): add e2e tests (skip by default)`

---

### Phase 8: Documentation & Polish

#### Task 8.1: Add Provider Documentation

**Goal:** Document how to use the SDK provider.

**Files to create:**
- `docs/providers/claude-agent-sdk.md`

**Content:**

```markdown
# Claude Agent SDK Provider

Use Claude with your Claude Pro or Claude Team subscription instead of paying per-token via API.

## Overview

The Claude Agent SDK provider integrates Anthropic's subscription-based SDK, allowing users with existing Claude subscriptions to use Lace without additional API costs. The SDK spawns Claude Code CLI processes and manages authentication via Anthropic's OAuth system.

## Setup

### 1. Install Dependencies

The SDK is automatically installed with Lace's dependencies.

### 2. Authentication

**Option A: Via CLI** (TODO - to be implemented)
```bash
lace auth login --provider claude-agents-sdk
```

**Option B: Manual Token**
1. Visit [claude.ai](https://claude.ai)
2. Open browser DevTools → Application → Cookies
3. Copy the `sessionKey` or similar session cookie
4. Create provider instance with token

### 3. Create Provider Instance

In Lace UI:
1. Settings → Providers → Add Provider
2. Select "Claude Agent SDK (Subscription)"
3. Paste session token
4. Test connection

### 4. Use in Sessions

Select the SDK provider when creating sessions or agents.

## Features

- ✅ Subscription-based billing (no per-token costs)
- ✅ Streaming responses
- ✅ Full tool support (uses Lace tools, not SDK tools)
- ✅ Permission system integration
- ✅ Session resumption with history tracking

## Limitations

- Requires Claude Pro or Team subscription
- Spawns subprocess per request (higher overhead than direct API)
- Session tokens expire (need re-authentication)
- Cannot use SDK's built-in tools (uses Lace tools instead)

## Architecture - Tool Execution Flow

**IMPORTANT: Understanding the dual-execution model**

The SDK provider uses a two-phase tool execution model:

### Phase 1: Permission Check (canUseTool)
```
SDK wants to call tool
  ↓
canUseTool handler called
  ↓
Check Lace policies (allowlist, safeInternal, permission mode)
  ↓
If needs approval: emit event → wait for user decision
  ↓
Return allow/deny to SDK
```

### Phase 2: Tool Execution (MCP Handler)
```
SDK approved to execute
  ↓
SDK calls __lace-tools MCP server
  ↓
MCP handler receives (args, extra)
  ↓
Call ToolExecutor.execute(toolCall, toolContext)
  ↓
ToolExecutor: validates → executes → creates events
  ↓
Return CallToolResult to SDK
  ↓
SDK continues conversation
```

**Key Points:**
- `canUseTool` does NOT execute tools - it only checks permissions
- MCP handler does the actual execution via ToolExecutor
- ToolExecutor.execute() only executes - it does NOT check approvals (Agent normally does this)
- For SDK provider: approval happens in `canUseTool` BEFORE MCP handler is called
- Tools run with full Lace context (agent, working directory, env vars)

**Important Difference from Standard Lace Flow:**

In normal Lace (Anthropic/OpenAI providers):
```
Agent gets tool calls from provider
  ↓
Agent checks approvals (_checkToolPermission)
  ↓
If approved: Agent calls ToolExecutor.execute()
  ↓
ToolExecutor executes and returns result
```

In SDK provider:
```
SDK wants to execute tool
  ↓
canUseTool checks approvals (BEFORE execution)
  ↓
If approved: SDK calls MCP handler
  ↓
MCP handler calls ToolExecutor.execute() (approval already done)
  ↓
ToolExecutor executes and returns result
```

**This means:** Approval logic moves from Agent to Provider's `canUseTool` handler for SDK provider only.

## High-Level Architecture

```
User Message
  ↓
Provider spawns SDK subprocess
  ↓
SDK calls __lace-tools MCP server
  ↓
MCP handlers → ToolExecutor.execute()
  ↓
SDK completes → Return ProviderResponse
  ↓
Agent creates events normally
```

## Troubleshooting

**"SDK provider not configured"**
- Ensure session token is set in provider instance
- Token may have expired - re-authenticate

**"Tool execution failed"**
- Check Lace tool policies and permissions
- Verify MCP server configuration

**"Session resumption failed"**
- History fingerprint changed (compaction/edit)
- New session will be created automatically

## Advanced Configuration

### Custom MCP Servers

Project MCP servers are automatically merged with the SDK configuration.

### Permission Modes

- `normal`: Standard approval flow
- `yolo`: Auto-approve all tools (maps to SDK's `bypassPermissions`)
- `read-only`: Only allow read-only tools (maps to SDK's `plan` mode)

## Development

See implementation plan: `docs/plans/2025-10-01/claude-agents-sdk.md`
```

**Commit:** `docs(claude-sdk): add provider documentation`

---

#### Task 8.2: Update Main Documentation

**Goal:** Reference the new provider in main docs.

**Files to modify:**
- `docs/providers/README.md` or similar index
- `docs/architecture/CODE-MAP.md` (add new files)

**Add to provider list:**
```markdown
## Available Providers

- **Anthropic** - Direct API with API key
- **Claude Agent SDK** - Subscription-based via SDK (NEW)
- **OpenAI** - GPT models
- **LMStudio** - Local models
- ... etc
```

**Update CODE-MAP.md:**
```markdown
packages/core/src/providers/
  ...
  claude-sdk-provider.ts          # SDK provider implementation
  claude-sdk-provider.test.ts     # Unit tests
  claude-sdk-integration.test.ts  # Integration tests
```

**Commit:** `docs: update documentation with SDK provider`

---

### Phase 9: Final Integration & Testing

#### Task 9.1: Test with Real Agent

**Goal:** Verify the provider works end-to-end with a real Lace agent.

**Manual test steps:**

1. Start Lace web interface: `npm run dev`
2. Create new project
3. Add SDK provider instance (use test credentials)
4. Create session with SDK provider
5. Create agent with SDK provider
6. Send message: "List files in current directory"
7. Verify:
   - Tool call happens via Lace's tool system
   - Approval flow works correctly
   - Response is displayed
   - Session can be resumed

**Document results:**
```bash
# Create test report
echo "## Manual Test Report" > test-report.md
echo "Date: $(date)" >> test-report.md
echo "Tester: [Your Name]" >> test-report.md
echo "" >> test-report.md
echo "### Test Cases" >> test-report.md
echo "- [ ] Provider initialization" >> test-report.md
echo "- [ ] First message response" >> test-report.md
echo "- [ ] Tool execution" >> test-report.md
echo "- [ ] Approval flow" >> test-report.md
echo "- [ ] Session resumption" >> test-report.md
echo "- [ ] Streaming tokens" >> test-report.md
```

**Commit:** `test(claude-sdk): add manual test report`

---

#### Task 9.2: Performance Testing

**Goal:** Measure SDK provider overhead vs direct API.

**Files to create:**
- `packages/core/src/providers/claude-sdk-performance.test.ts`

**Implementation:**

```typescript
import { describe, it, expect } from 'vitest';
import { ClaudeSDKProvider } from './claude-sdk-provider';
import { AnthropicProvider } from './anthropic-provider';

describe.skip('ClaudeSDKProvider - Performance', () => {
  it('should measure request latency', async () => {
    const sdkProvider = new ClaudeSDKProvider({ sessionToken: process.env.CLAUDE_SDK_SESSION_TOKEN! });
    const apiProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const messages = [{ role: 'user' as const, content: 'Say hello' }];

    // Warm up
    await sdkProvider.createResponse(messages, [], 'sonnet');
    await apiProvider.createResponse(messages, [], 'claude-3-5-sonnet-20241022');

    // Measure SDK
    const sdkStart = Date.now();
    await sdkProvider.createResponse(messages, [], 'sonnet');
    const sdkTime = Date.now() - sdkStart;

    // Measure API
    const apiStart = Date.now();
    await apiProvider.createResponse(messages, [], 'claude-3-5-sonnet-20241022');
    const apiTime = Date.now() - apiStart;

    console.log(`SDK Time: ${sdkTime}ms, API Time: ${apiTime}ms`);
    console.log(`Overhead: ${sdkTime - apiTime}ms (${((sdkTime / apiTime - 1) * 100).toFixed(1)}%)`);

    // SDK expected to be slower due to subprocess overhead
    expect(sdkTime).toBeGreaterThan(apiTime);
  }, 60000);
});
```

**Commit:** `test(claude-sdk): add performance benchmarks`

---

### Phase 10: Cleanup & Review

#### Task 10.1: Code Review Checklist

**Goal:** Self-review before requesting external review.

**Checklist:**

```markdown
## Code Review Checklist

### Architecture
- [ ] Follows existing provider pattern (extends AIProvider)
- [ ] Uses Lace's tool system (ToolExecutor)
- [ ] Integrates with permission system
- [ ] Returns standard ProviderResponse
- [ ] No special event types

### Implementation Quality
- [ ] All TODOs resolved or documented
- [ ] Error handling is comprehensive
- [ ] Logging at appropriate levels
- [ ] Type safety (no `any` types)
- [ ] Private methods properly scoped

### Testing
- [ ] Unit tests cover core logic
- [ ] Integration tests verify SDK interaction
- [ ] E2E tests exist (even if skipped)
- [ ] All tests pass: `npm test`

### Documentation
- [ ] ABOUTME comments on all files
- [ ] Provider documentation complete
- [ ] Architecture decisions documented
- [ ] Manual test procedures documented

### Integration
- [ ] Provider registered in registry
- [ ] Added to catalog
- [ ] No breaking changes to existing code
- [ ] Works with existing agents/sessions

### Git History
- [ ] Commits are small and focused
- [ ] Commit messages follow convention
- [ ] No debugging code left in
- [ ] No commented-out code
```

**Review and fix any issues found.**

**Commit:** `chore(claude-sdk): address code review checklist`

---

#### Task 10.2: Update CHANGELOG

**Goal:** Document the new feature.

**Files to modify:**
- `CHANGELOG.md` or `packages/core/CHANGELOG.md`

**Add entry:**

```markdown
## [Unreleased]

### Added
- **Claude Agent SDK Provider**: New provider enabling subscription-based Claude access
  - Use Claude Pro/Team subscription instead of per-token API costs
  - Full streaming support with token-by-token emission
  - Integrated with Lace's tool execution and approval system
  - Session resumption with automatic history fingerprinting
  - MCP server wrapping all Lace tools
  - Permission mode mapping (yolo → bypassPermissions, read-only → plan)
```

**Commit:** `docs: update CHANGELOG for SDK provider`

---

## Testing Strategy

### Unit Tests
- Run after each task: `npm test -- claude-sdk-provider.test.ts`
- Focus: Individual methods, logic branches, error cases
- Mock external dependencies (SDK, ToolExecutor, Session)

### Integration Tests
- Run after Phase 7: `npm test -- claude-sdk-integration.test.ts`
- Focus: SDK interaction, tool execution flow, event emission
- Mock SDK but test real ToolExecutor integration

### E2E Tests
- Run manually with credentials: `npm test -- claude-sdk-e2e.test.ts`
- Focus: Real SDK calls, end-to-end verification
- Skip in CI (requires credentials)

### Manual Testing
- After Phase 9: Full agent workflow
- Verify UI integration, tool approvals, session management
- Document results in test report

---

## Common Pitfalls & Solutions

### Problem: SDK subprocess doesn't exit
**Solution:** Ensure query iteration completes (reaches 'result' message)

### Problem: Tools not executing
**Solution:** Verify MCP server registration and __lace-tools prefix

### Problem: Approval hangs forever
**Solution:** Check that handleApprovalResponse is called and promise resolves

### Problem: Session not resuming
**Solution:** Verify history fingerprint logic and sessionId persistence

### Problem: Type errors with SDK types
**Solution:** Import types from '@anthropic-ai/claude-agent-sdk', not implementation

### Problem: Tests failing due to missing mocks
**Solution:** Use vi.mock() to stub SDK, don't call real SDK in unit tests

---

## Definition of Done

A task is complete when:

1. ✅ Code is written and follows patterns from existing providers
2. ✅ Unit tests exist and pass
3. ✅ Manual testing confirms functionality
4. ✅ Code is committed with clear message
5. ✅ No linting errors: `npm run lint`
6. ✅ No type errors: `npm run type-check` (if command exists)
7. ✅ Documentation updated if needed

The entire feature is complete when:

1. ✅ All tasks 1.1 through 10.2 are done
2. ✅ Integration tests pass
3. ✅ E2E test works with real credentials
4. ✅ Manual test report shows all cases passing
5. ✅ Code review checklist is complete
6. ✅ PR is ready for review

---

## Next Steps After Implementation

1. **Authentication Flow**: Implement proper OAuth login flow
2. **Token Refresh**: Handle session token expiration
3. **Model Catalog**: Fetch models dynamically from SDK
4. **Error Recovery**: Better handling of SDK subprocess crashes
5. **Performance**: Optimize subprocess lifecycle
6. **Multi-tenancy**: Support multiple concurrent sessions per provider

---

## Questions & Support

If you get stuck:

1. Read the reference files listed at the top
2. Look at AnthropicProvider implementation for patterns
3. Check SDK documentation in `reference/typescript.md`
4. Search for similar patterns in the codebase
5. Ask for clarification - include specific file/line references

Good luck! Remember: TDD, DRY, YAGNI, frequent commits.
