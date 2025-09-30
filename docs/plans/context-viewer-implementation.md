# Context Viewer Implementation Plan

## Executive Summary

Users need visibility into how their conversation context is being consumed. This feature adds a context viewer modal that shows a detailed breakdown of token usage across categories (system prompt, tools, messages, etc.). The viewer is accessible by clicking the existing token usage display in the chat footer and provides a static snapshot of context at that moment.

## Design Overview

### User Flow

1. User is chatting with an agent in the web UI
2. User clicks on the `CompactTokenUsage` component in the chat footer
3. Modal opens showing context breakdown with:
   - Header: Model info, context limit, timestamp
   - Visualization: Treemap (preferred) or progress bars showing proportional usage
   - Detailed list: Category breakdowns with token counts and sub-items
4. User reviews the breakdown (static snapshot, no real-time updates)
5. User closes modal by clicking backdrop, ESC key, or close button

### Architecture

Three-layer implementation:

1. **Backend** (`packages/core/src/token-management/`) - Context analysis engine
2. **API** (`packages/web/app/routes/`) - REST endpoint exposing context data
3. **Frontend** (`packages/web/components/`) - UI components for visualization

### Data Model

```typescript
// Core response from API
interface ContextBreakdown {
  timestamp: string;           // ISO timestamp of snapshot
  modelId: string;             // e.g., "claude-sonnet-4-5"
  contextLimit: number;        // e.g., 200000
  totalUsedTokens: number;     // Sum of all categories except free space
  percentUsed: number;         // 0-1 decimal

  categories: {
    systemPrompt: CategoryDetail;
    coreTools: CategoryDetail;
    mcpTools: CategoryDetail;
    messages: MessageCategoryDetail;
    reservedForResponse: CategoryDetail;
    freeSpace: CategoryDetail;
  };
}

interface CategoryDetail {
  tokens: number;
  items?: ItemDetail[];  // Optional drill-down
}

interface MessageCategoryDetail extends CategoryDetail {
  subcategories: {
    userMessages: { tokens: number };
    agentMessages: { tokens: number };
    toolCalls: { tokens: number };
    toolResults: { tokens: number };
  };
}

interface ItemDetail {
  name: string;    // e.g., "bash", "deepwiki__read_wiki_structure"
  tokens: number;
}
```

## Implementation Phases

### Phase 1: Backend Foundation - Context Analyzer

Build the core token analysis engine.

---

#### Task 1.1: Create Type Definitions

**Objective**: Define TypeScript interfaces for context breakdown data.

**Files to Create**:
- `packages/core/src/token-management/context-breakdown-types.ts`

**What to Do**:

1. Create the file with ABOUTME comments:
   ```typescript
   // ABOUTME: Type definitions for context breakdown feature
   // ABOUTME: Interfaces for categorizing and reporting token usage
   ```

2. Copy the interface definitions from the Data Model section above

3. Export all interfaces:
   ```typescript
   export type {
     ContextBreakdown,
     CategoryDetail,
     MessageCategoryDetail,
     ItemDetail,
   };
   ```

**Testing**:
- No runtime tests needed (just types)
- Verify TypeScript compilation: `npm run build`

**Commit**: `feat(token-management): add context breakdown type definitions`

---

#### Task 1.2: Create Context Analyzer Skeleton

**Objective**: Set up the main analyzer class with empty methods.

**Files to Create**:
- `packages/core/src/token-management/context-analyzer.ts`

**Files to Read First** (understand existing patterns):
- `packages/core/src/token-management/token-counter.ts` - Token counting utilities
- `packages/core/src/agents/agent.ts` - Agent class structure, look for `getContextLimit()`, `getModel()`
- `packages/core/src/threads/thread-manager.ts` - Thread event retrieval
- `packages/core/src/tools/executor.ts` - Tool registration

**What to Do**:

1. Create file with ABOUTME comments:
   ```typescript
   // ABOUTME: Context analyzer that breaks down token usage by category
   // ABOUTME: Analyzes thread events and agent state to calculate context breakdown
   ```

2. Import dependencies:
   ```typescript
   import type { ThreadId } from '~/threads/types';
   import type { Agent } from '~/agents/agent';
   import type { ContextBreakdown } from './context-breakdown-types';
   ```

3. Create class skeleton:
   ```typescript
   export class ContextAnalyzer {
     /**
      * Analyzes an agent's thread and returns detailed context breakdown
      */
     static async analyze(
       threadId: ThreadId,
       agent: Agent
     ): Promise<ContextBreakdown> {
       // TODO: Implement in subsequent tasks
       throw new Error('Not implemented');
     }
   }
   ```

**Testing**:
- Verify TypeScript compilation: `npm run build`

**Commit**: `feat(token-management): add ContextAnalyzer skeleton`

---

#### Task 1.3: Implement System Prompt Token Counting

**Objective**: Calculate tokens used by system prompts and context.

**Files to Modify**:
- `packages/core/src/token-management/context-analyzer.ts`

**Files to Read First**:
- `packages/core/src/threads/types.ts` - Look for `SYSTEM_PROMPT`, `USER_SYSTEM_PROMPT` event types
- `packages/core/src/providers/base-provider.ts` - Look for `buildConversation()` method
- `packages/core/src/token-management/token-counter.ts` - Token counting utilities

**Reference Code Locations**:
- Agent builds conversation with system prompts: `packages/core/src/agents/agent.ts` around line 400-500 (look for `buildConversationFromEvents`)
- System prompt events: `packages/core/src/threads/types.ts` event type definitions

**What to Do**:

1. Add private helper method:
   ```typescript
   private static async countSystemPromptTokens(
     threadId: ThreadId,
     agent: Agent
   ): Promise<number> {
     // 1. Get thread manager from agent
     const threadManager = agent.getThreadManager();

     // 2. Get all events from thread
     const events = await threadManager.getEvents(threadId);

     // 3. Filter for SYSTEM_PROMPT and USER_SYSTEM_PROMPT events
     const systemEvents = events.filter(e =>
       e.type === 'SYSTEM_PROMPT' || e.type === 'USER_SYSTEM_PROMPT'
     );

     // 4. Extract content and count tokens
     let totalTokens = 0;
     for (const event of systemEvents) {
       if (event.data && typeof event.data === 'object' && 'content' in event.data) {
         const content = (event.data as { content: string }).content;
         // Use TokenCounter utility - you'll need to find the right method
         totalTokens += estimateTokenCount(content);
       }
     }

     return totalTokens;
   }
   ```

2. Update `analyze()` method to use this helper (but don't implement full method yet):
   ```typescript
   static async analyze(
     threadId: ThreadId,
     agent: Agent
   ): Promise<ContextBreakdown> {
     const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);

     // Return minimal valid response for now
     return {
       timestamp: new Date().toISOString(),
       modelId: agent.getModel(),
       contextLimit: agent.getContextLimit(),
       totalUsedTokens: systemPromptTokens,
       percentUsed: systemPromptTokens / agent.getContextLimit(),
       categories: {
         systemPrompt: { tokens: systemPromptTokens },
         coreTools: { tokens: 0, items: [] },
         mcpTools: { tokens: 0, items: [] },
         messages: {
           tokens: 0,
           subcategories: {
             userMessages: { tokens: 0 },
             agentMessages: { tokens: 0 },
             toolCalls: { tokens: 0 },
             toolResults: { tokens: 0 },
           }
         },
         reservedForResponse: { tokens: 0 },
         freeSpace: { tokens: agent.getContextLimit() - systemPromptTokens },
       },
     };
   }
   ```

**Write Tests First** (TDD):

Create `packages/core/src/token-management/context-analyzer.test.ts`:

```typescript
// ABOUTME: Tests for context analyzer token counting
// ABOUTME: Validates category calculations and edge cases

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextAnalyzer } from './context-analyzer';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { createTestThreadManager } from '~/utils/test-utils';

describe('ContextAnalyzer', () => {
  let threadManager: ThreadManager;
  let agent: Agent;
  let threadId: string;

  beforeEach(async () => {
    // Set up test infrastructure
    threadManager = await createTestThreadManager();
    // Create a test agent - you'll need to look at other agent tests
    // to see the proper setup pattern
    agent = /* TODO: create test agent */;
    threadId = agent.threadId;
  });

  describe('System Prompt Tokens', () => {
    it('should count tokens from SYSTEM_PROMPT events', async () => {
      // Add a system prompt event
      await threadManager.addEvent(threadId, {
        type: 'SYSTEM_PROMPT',
        data: { content: 'You are a helpful assistant.' },
        timestamp: Date.now(),
      });

      const breakdown = await ContextAnalyzer.analyze(threadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);
    });

    it('should count tokens from USER_SYSTEM_PROMPT events', async () => {
      await threadManager.addEvent(threadId, {
        type: 'USER_SYSTEM_PROMPT',
        data: { content: 'Additional context from user.' },
        timestamp: Date.now(),
      });

      const breakdown = await ContextAnalyzer.analyze(threadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBeGreaterThan(0);
    });

    it('should handle threads with no system prompts', async () => {
      const breakdown = await ContextAnalyzer.analyze(threadId, agent);

      expect(breakdown.categories.systemPrompt.tokens).toBe(0);
    });
  });
});
```

**Testing**:
1. Run tests (they should fail initially): `npm test context-analyzer`
2. Implement the code above
3. Run tests again (should pass): `npm test context-analyzer`
4. Run full test suite: `npm test`

**Commit**: `feat(token-management): implement system prompt token counting`

---

#### Task 1.4: Implement Tool Token Counting

**Objective**: Calculate tokens used by tool definitions (core + MCP).

**Files to Modify**:
- `packages/core/src/token-management/context-analyzer.ts`

**Files to Read First**:
- `packages/core/src/tools/executor.ts` - Look for `getTools()` or similar method
- `packages/core/src/tools/tool.ts` - Base tool class, look for `toJSON()` or schema methods
- `packages/core/src/mcp/client.ts` - MCP tool discovery

**Reference Code**:
- Look at how Agent sends tools to provider: `packages/core/src/agents/agent.ts` search for "tools" and "toolExecutor"
- Provider tool formatting: `packages/core/src/providers/anthropic/provider.ts` or similar

**What to Do**:

1. Add helper methods:
   ```typescript
   private static async countToolTokens(
     agent: Agent
   ): Promise<{ core: CategoryDetail; mcp: CategoryDetail }> {
     // 1. Get tool executor from agent
     const toolExecutor = agent.getToolExecutor();

     // 2. Get all registered tools
     const allTools = toolExecutor.getTools(); // Method name may vary

     const coreToolItems: ItemDetail[] = [];
     const mcpToolItems: ItemDetail[] = [];
     let coreTotal = 0;
     let mcpTotal = 0;

     // 3. Iterate tools and categorize
     for (const tool of allTools) {
       // Convert tool to provider format (JSON schema)
       const toolSchema = tool.toJSON(); // Method name may vary
       const toolTokens = estimateTokenCount(JSON.stringify(toolSchema));

       const item: ItemDetail = {
         name: tool.name,
         tokens: toolTokens,
       };

       // 4. Determine if MCP or core
       // MCP tools typically have a server property or namespace
       if (tool.isMCP() || tool.name.includes('mcp_')) { // Adjust detection logic
         mcpToolItems.push(item);
         mcpTotal += toolTokens;
       } else {
         coreToolItems.push(item);
         coreTotal += toolTokens;
       }
     }

     return {
       core: { tokens: coreTotal, items: coreToolItems },
       mcp: { tokens: mcpTotal, items: mcpToolItems },
     };
   }
   ```

2. Update `analyze()` method:
   ```typescript
   static async analyze(
     threadId: ThreadId,
     agent: Agent
   ): Promise<ContextBreakdown> {
     const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);
     const { core, mcp } = await this.countToolTokens(agent);

     const totalUsed = systemPromptTokens + core.tokens + mcp.tokens;

     return {
       timestamp: new Date().toISOString(),
       modelId: agent.getModel(),
       contextLimit: agent.getContextLimit(),
       totalUsedTokens: totalUsed,
       percentUsed: totalUsed / agent.getContextLimit(),
       categories: {
         systemPrompt: { tokens: systemPromptTokens },
         coreTools: core,
         mcpTools: mcp,
         messages: {
           tokens: 0,
           subcategories: {
             userMessages: { tokens: 0 },
             agentMessages: { tokens: 0 },
             toolCalls: { tokens: 0 },
             toolResults: { tokens: 0 },
           }
         },
         reservedForResponse: { tokens: 0 },
         freeSpace: { tokens: agent.getContextLimit() - totalUsed },
       },
     };
   }
   ```

**Add Tests** (TDD - write these first):

In `context-analyzer.test.ts`:

```typescript
describe('Tool Token Counting', () => {
  it('should count core tool tokens', async () => {
    // Agent should have some default core tools (bash, file-read, etc.)
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.coreTools.tokens).toBeGreaterThan(0);
    expect(breakdown.categories.coreTools.items).toBeDefined();
    expect(breakdown.categories.coreTools.items!.length).toBeGreaterThan(0);
  });

  it('should list individual core tools with token counts', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    const bashTool = breakdown.categories.coreTools.items?.find(
      t => t.name === 'bash'
    );
    expect(bashTool).toBeDefined();
    expect(bashTool!.tokens).toBeGreaterThan(0);
  });

  it('should count MCP tool tokens separately', async () => {
    // TODO: Set up agent with MCP tools
    // This might require mocking MCP server or using test fixtures

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.mcpTools).toBeDefined();
    // Add specific assertions once you understand MCP setup
  });

  it('should handle agents with no MCP tools', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.mcpTools.tokens).toBe(0);
    expect(breakdown.categories.mcpTools.items).toEqual([]);
  });
});
```

**Testing**:
1. Write tests first: `npm test context-analyzer`
2. Implement code
3. Run tests: `npm test context-analyzer`
4. Verify all tests pass

**Note**: You may need to explore the codebase to find exact method names. Use grep:
```bash
cd packages/core
grep -r "getTools" src/tools/
grep -r "class Tool" src/tools/tool.ts
```

**Commit**: `feat(token-management): implement tool token counting`

---

#### Task 1.5: Implement Message Token Counting

**Objective**: Calculate tokens used by conversation messages, broken down by type.

**Files to Modify**:
- `packages/core/src/token-management/context-analyzer.ts`

**Files to Read First**:
- `packages/core/src/threads/types.ts` - Event types: `USER_MESSAGE`, `AGENT_MESSAGE`, `TOOL_CALL`, `TOOL_RESULT`
- `packages/core/src/threads/thread-manager.ts` - Getting events from thread

**What to Do**:

1. Add helper method:
   ```typescript
   private static async countMessageTokens(
     threadId: ThreadId,
     agent: Agent
   ): Promise<MessageCategoryDetail> {
     const threadManager = agent.getThreadManager();
     const events = await threadManager.getEvents(threadId);

     let userTokens = 0;
     let agentTokens = 0;
     let toolCallTokens = 0;
     let toolResultTokens = 0;

     for (const event of events) {
       let content = '';

       // Extract content based on event type
       switch (event.type) {
         case 'USER_MESSAGE':
           if (event.data && typeof event.data === 'object' && 'content' in event.data) {
             content = (event.data as { content: string }).content;
             userTokens += estimateTokenCount(content);
           }
           break;

         case 'AGENT_MESSAGE':
           if (event.data && typeof event.data === 'object' && 'content' in event.data) {
             content = (event.data as { content: string }).content;
             agentTokens += estimateTokenCount(content);
           }
           break;

         case 'TOOL_CALL':
           // Tool calls include name + arguments
           if (event.data && typeof event.data === 'object') {
             const toolData = JSON.stringify(event.data);
             toolCallTokens += estimateTokenCount(toolData);
           }
           break;

         case 'TOOL_RESULT':
           // Tool results include output
           if (event.data && typeof event.data === 'object' && 'result' in event.data) {
             const result = (event.data as { result: string }).result;
             toolResultTokens += estimateTokenCount(result);
           }
           break;
       }
     }

     const totalMessageTokens = userTokens + agentTokens + toolCallTokens + toolResultTokens;

     return {
       tokens: totalMessageTokens,
       subcategories: {
         userMessages: { tokens: userTokens },
         agentMessages: { tokens: agentTokens },
         toolCalls: { tokens: toolCallTokens },
         toolResults: { tokens: toolResultTokens },
       },
     };
   }
   ```

2. Update `analyze()` method:
   ```typescript
   static async analyze(
     threadId: ThreadId,
     agent: Agent
   ): Promise<ContextBreakdown> {
     const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);
     const { core, mcp } = await this.countToolTokens(agent);
     const messages = await this.countMessageTokens(threadId, agent);

     const totalUsed = systemPromptTokens + core.tokens + mcp.tokens + messages.tokens;

     return {
       timestamp: new Date().toISOString(),
       modelId: agent.getModel(),
       contextLimit: agent.getContextLimit(),
       totalUsedTokens: totalUsed,
       percentUsed: totalUsed / agent.getContextLimit(),
       categories: {
         systemPrompt: { tokens: systemPromptTokens },
         coreTools: core,
         mcpTools: mcp,
         messages,
         reservedForResponse: { tokens: 0 }, // Still TODO
         freeSpace: { tokens: agent.getContextLimit() - totalUsed },
       },
     };
   }
   ```

**Add Tests** (TDD):

```typescript
describe('Message Token Counting', () => {
  it('should count user message tokens', async () => {
    await threadManager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: { content: 'Hello, world!' },
      timestamp: Date.now(),
    });

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.messages.subcategories.userMessages.tokens).toBeGreaterThan(0);
  });

  it('should count agent message tokens', async () => {
    await threadManager.addEvent(threadId, {
      type: 'AGENT_MESSAGE',
      data: { content: 'I can help with that.' },
      timestamp: Date.now(),
    });

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.messages.subcategories.agentMessages.tokens).toBeGreaterThan(0);
  });

  it('should count tool call tokens', async () => {
    await threadManager.addEvent(threadId, {
      type: 'TOOL_CALL',
      data: {
        toolName: 'bash',
        arguments: { command: 'ls -la' }
      },
      timestamp: Date.now(),
    });

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.messages.subcategories.toolCalls.tokens).toBeGreaterThan(0);
  });

  it('should count tool result tokens', async () => {
    await threadManager.addEvent(threadId, {
      type: 'TOOL_RESULT',
      data: {
        result: 'total 64\ndrwxr-xr-x  10 user  staff   320 Sep 29 14:23 .\n...'
      },
      timestamp: Date.now(),
    });

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.messages.subcategories.toolResults.tokens).toBeGreaterThan(0);
  });

  it('should calculate total message tokens correctly', async () => {
    await threadManager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: { content: 'Test user message' },
      timestamp: Date.now(),
    });

    await threadManager.addEvent(threadId, {
      type: 'AGENT_MESSAGE',
      data: { content: 'Test agent response' },
      timestamp: Date.now(),
    });

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);
    const { subcategories } = breakdown.categories.messages;

    const expectedTotal =
      subcategories.userMessages.tokens +
      subcategories.agentMessages.tokens +
      subcategories.toolCalls.tokens +
      subcategories.toolResults.tokens;

    expect(breakdown.categories.messages.tokens).toBe(expectedTotal);
  });
});
```

**Testing**:
1. Write tests first
2. Implement code
3. Run tests: `npm test context-analyzer`

**Commit**: `feat(token-management): implement message token counting`

---

#### Task 1.6: Implement Reserved Tokens Calculation

**Objective**: Calculate tokens reserved for agent response buffer.

**Files to Modify**:
- `packages/core/src/token-management/context-analyzer.ts`

**Files to Read First**:
- `packages/core/src/agents/agent.ts` - Look for output token settings, max tokens config
- `packages/core/src/token-management/types.ts` - Token budget types

**Reference**:
- Current auto-compact threshold is 80% (from `TokenUsageDisplay.tsx` line 54)
- Reserved tokens ensure agent has space to respond

**What to Do**:

1. Add helper method:
   ```typescript
   private static getReservedTokens(agent: Agent): number {
     // 1. Try to get max output tokens from agent config
     // This value might be in agent.config or agent.tokenBudget
     const maxOutputTokens = agent.getMaxOutputTokens?.() ?? 4096; // Default to 4096

     // 2. Alternatively, calculate as percentage of context limit
     // Reserve enough for a substantial response
     // const contextLimit = agent.getContextLimit();
     // return Math.floor(contextLimit * 0.20); // 20% of context

     return maxOutputTokens;
   }
   ```

2. Update `analyze()` method:
   ```typescript
   static async analyze(
     threadId: ThreadId,
     agent: Agent
   ): Promise<ContextBreakdown> {
     const systemPromptTokens = await this.countSystemPromptTokens(threadId, agent);
     const { core, mcp } = await this.countToolTokens(agent);
     const messages = await this.countMessageTokens(threadId, agent);
     const reservedTokens = this.getReservedTokens(agent);

     const totalUsed = systemPromptTokens + core.tokens + mcp.tokens + messages.tokens;
     const freeTokens = agent.getContextLimit() - totalUsed - reservedTokens;

     return {
       timestamp: new Date().toISOString(),
       modelId: agent.getModel(),
       contextLimit: agent.getContextLimit(),
       totalUsedTokens: totalUsed,
       percentUsed: totalUsed / agent.getContextLimit(),
       categories: {
         systemPrompt: { tokens: systemPromptTokens },
         coreTools: core,
         mcpTools: mcp,
         messages,
         reservedForResponse: { tokens: reservedTokens },
         freeSpace: { tokens: Math.max(0, freeTokens) }, // Don't go negative
       },
     };
   }
   ```

**Add Tests**:

```typescript
describe('Reserved and Free Space Tokens', () => {
  it('should calculate reserved tokens for response', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.reservedForResponse.tokens).toBeGreaterThan(0);
  });

  it('should calculate free space correctly', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

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
    // This test verifies edge case where context is over-full
    // You may need to add many events to fill context
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.freeSpace.tokens).toBeGreaterThanOrEqual(0);
  });

  it('should calculate percentUsed correctly', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    const expectedPercent = breakdown.totalUsedTokens / breakdown.contextLimit;
    expect(breakdown.percentUsed).toBeCloseTo(expectedPercent, 5);
  });
});
```

**Testing**:
1. Write tests first
2. Implement code
3. Run tests: `npm test context-analyzer`
4. Run full suite: `npm test`

**Commit**: `feat(token-management): implement reserved tokens calculation`

---

#### Task 1.7: Add Integration Tests

**Objective**: Test full end-to-end context analysis with realistic scenarios.

**Files to Modify**:
- `packages/core/src/token-management/context-analyzer.test.ts`

**What to Do**:

Add comprehensive integration tests:

```typescript
describe('ContextAnalyzer Integration', () => {
  it('should analyze a complete conversation', async () => {
    // Set up a realistic conversation
    await threadManager.addEvent(threadId, {
      type: 'SYSTEM_PROMPT',
      data: { content: 'You are a helpful coding assistant.' },
      timestamp: Date.now(),
    });

    await threadManager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: { content: 'Can you help me write a function?' },
      timestamp: Date.now(),
    });

    await threadManager.addEvent(threadId, {
      type: 'AGENT_MESSAGE',
      data: { content: 'Of course! What should the function do?' },
      timestamp: Date.now(),
    });

    await threadManager.addEvent(threadId, {
      type: 'USER_MESSAGE',
      data: { content: 'Calculate factorial of a number' },
      timestamp: Date.now(),
    });

    await threadManager.addEvent(threadId, {
      type: 'TOOL_CALL',
      data: {
        toolName: 'file-write',
        arguments: { path: 'factorial.js', content: 'function factorial(n) {...}' }
      },
      timestamp: Date.now(),
    });

    await threadManager.addEvent(threadId, {
      type: 'TOOL_RESULT',
      data: { result: 'File written successfully' },
      timestamp: Date.now(),
    });

    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

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
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.systemPrompt.tokens).toBe(0);
    expect(breakdown.categories.messages.tokens).toBe(0);
    expect(breakdown.totalUsedTokens).toBeGreaterThanOrEqual(0);
    expect(breakdown.categories.freeSpace.tokens).toBeGreaterThan(0);
  });

  it('should return valid ISO timestamp', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(() => new Date(breakdown.timestamp)).not.toThrow();
    const timestamp = new Date(breakdown.timestamp);
    expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('should include tool items in breakdown', async () => {
    const breakdown = await ContextAnalyzer.analyze(threadId, agent);

    expect(breakdown.categories.coreTools.items).toBeDefined();
    expect(breakdown.categories.coreTools.items!.length).toBeGreaterThan(0);

    // Verify item structure
    const firstTool = breakdown.categories.coreTools.items![0];
    expect(firstTool.name).toBeDefined();
    expect(firstTool.tokens).toBeGreaterThan(0);
  });
});
```

**Testing**:
1. Run integration tests: `npm test context-analyzer`
2. Fix any failures
3. Run full test suite: `npm test`

**Commit**: `test(token-management): add context analyzer integration tests`

---

#### Task 1.8: Export from Token Management Module

**Objective**: Make ContextAnalyzer available to other packages.

**Files to Modify**:
- `packages/core/src/token-management/index.ts` (create if doesn't exist)

**What to Do**:

1. Check if index file exists:
   ```bash
   ls packages/core/src/token-management/index.ts
   ```

2. If it doesn't exist, create it with ABOUTME comments:
   ```typescript
   // ABOUTME: Token management module exports
   // ABOUTME: Provides token counting, budgeting, and context analysis utilities
   ```

3. Add exports:
   ```typescript
   export { ContextAnalyzer } from './context-analyzer';
   export type {
     ContextBreakdown,
     CategoryDetail,
     MessageCategoryDetail,
     ItemDetail,
   } from './context-breakdown-types';

   // Re-export existing types if they exist
   export type { ThreadTokenUsage, CombinedTokenUsage } from './types';
   ```

**Testing**:
- Verify TypeScript compilation: `npm run build`
- Verify exports are accessible: Try importing in another file temporarily

**Commit**: `feat(token-management): export context analyzer from module`

---

**Phase 1 Complete! Checkpoint:**
- Run full test suite: `npm test`
- Build packages: `npm run build`
- Commit all changes if not already committed
- Review: You now have a working context analyzer that can break down token usage by category

---

### Phase 2: API Layer - REST Endpoint

Expose context data through a REST API endpoint.

---

#### Task 2.1: Create API Route File

**Objective**: Set up the API route structure.

**Files to Create**:
- `packages/web/app/routes/api.agents.$agentId.context.ts`

**Files to Read First** (understand patterns):
- `packages/web/app/routes/api.agents.$agentId.ts` - Existing agent route
- `packages/web/app/routes.ts` - Route registration
- `packages/web/lib/server/session-service.ts` - Session/agent lookup

**What to Do**:

1. Create the route file with ABOUTME comments:
   ```typescript
   // ABOUTME: API endpoint for agent context breakdown
   // ABOUTME: Returns detailed token usage categorization for an agent's thread

   import { json } from 'react-router';
   import type { Route } from './+types/api.agents.$agentId.context';
   import { ContextAnalyzer } from '@lace/core/token-management';
   import { getSessionService } from '@/lib/server/session-service';

   export async function loader({ params }: Route.LoaderArgs) {
     const { agentId } = params;

     // TODO: Implement in next task
     throw new Response('Not implemented', { status: 501 });
   }
   ```

2. Register route in `packages/web/app/routes.ts`:
   ```typescript
   // Add to the routes array:
   route(
     'api/agents/:agentId/context',
     'routes/api.agents.$agentId.context.ts'
   ),
   ```

**Testing**:
- Start dev server: `npm run dev`
- Verify route compilation: Check terminal for any errors
- Test endpoint: `curl http://localhost:3000/api/agents/test-id/context`
  - Should return 501 Not Implemented

**Commit**: `feat(api): add context endpoint route skeleton`

---

#### Task 2.2: Implement Agent Lookup

**Objective**: Get agent from session service.

**Files to Modify**:
- `packages/web/app/routes/api.agents.$agentId.context.ts`

**Files to Read First**:
- `packages/web/lib/server/session-service.ts` - Look for `getAgent()` or similar
- Other API routes that access agents

**What to Do**:

1. Implement agent lookup:
   ```typescript
   export async function loader({ params }: Route.LoaderArgs) {
     const { agentId } = params;

     try {
       // 1. Get session service singleton
       const sessionService = getSessionService();

       // 2. Find agent by ID
       // Method name may vary - check SessionService API
       const agent = await sessionService.getAgent(agentId);

       if (!agent) {
         throw new Response('Agent not found', {
           status: 404,
           statusText: 'Not Found'
         });
       }

       // TODO: Call ContextAnalyzer in next task
       return json({ message: 'Agent found', agentId: agent.threadId });

     } catch (error) {
       // If it's already a Response (like 404), rethrow
       if (error instanceof Response) {
         throw error;
       }

       // Otherwise it's an unexpected error
       console.error('[Context API] Error fetching agent:', error);
       throw new Response('Internal server error', {
         status: 500,
         statusText: 'Internal Server Error'
       });
     }
   }
   ```

**Testing**:
1. Start dev server: `npm run dev`
2. Create an agent in the UI (or use existing agent)
3. Get agent ID from URL (e.g., `/project/123/session/456/agent/789`)
4. Test endpoint: `curl http://localhost:3000/api/agents/789/context`
   - Should return JSON with agent ID
5. Test with invalid ID: `curl http://localhost:3000/api/agents/invalid/context`
   - Should return 404

**Commit**: `feat(api): implement agent lookup in context endpoint`

---

#### Task 2.3: Call Context Analyzer

**Objective**: Use ContextAnalyzer to get breakdown and return as JSON.

**Files to Modify**:
- `packages/web/app/routes/api.agents.$agentId.context.ts`

**What to Do**:

1. Complete the loader implementation:
   ```typescript
   export async function loader({ params }: Route.LoaderArgs) {
     const { agentId } = params;

     try {
       // 1. Get agent
       const sessionService = getSessionService();
       const agent = await sessionService.getAgent(agentId);

       if (!agent) {
         throw new Response('Agent not found', { status: 404 });
       }

       // 2. Analyze context
       const breakdown = await ContextAnalyzer.analyze(agentId, agent);

       // 3. Return as JSON
       return json(breakdown);

     } catch (error) {
       if (error instanceof Response) {
         throw error;
       }

       console.error('[Context API] Error analyzing context:', error);
       throw new Response('Failed to analyze context', {
         status: 500,
         statusText: 'Internal Server Error'
       });
     }
   }
   ```

**Testing**:
1. Start dev server: `npm run dev`
2. Have an active conversation with an agent
3. Test endpoint: `curl http://localhost:3000/api/agents/<agentId>/context | jq`
4. Verify response structure:
   - Has `timestamp`, `modelId`, `contextLimit`, `totalUsedTokens`, `percentUsed`
   - Has `categories` object with all expected categories
   - Token counts are reasonable numbers
   - Items arrays are present where expected

**Manual Testing Checklist**:
- [ ] Empty conversation (new agent) - should work
- [ ] Conversation with user messages - should count tokens
- [ ] Conversation with tool calls - should count tool tokens
- [ ] Agent with MCP tools - should list MCP tools separately
- [ ] Invalid agent ID - should return 404
- [ ] Server error scenario - should return 500

**Commit**: `feat(api): implement context analysis in endpoint`

---

**Phase 2 Complete! Checkpoint:**
- API endpoint is functional
- Returns proper error codes
- Test manually with curl or Postman
- Ready for frontend integration

---

### Phase 3: Frontend Components - Modal and Visualization

Build the UI components to display context breakdown.

---

#### Task 3.1: Create Type Definitions for Frontend

**Objective**: Import core types into web package with proper serialization.

**Files to Create**:
- `packages/web/types/context.ts`

**What to Do**:

1. Create type file with ABOUTME comments:
   ```typescript
   // ABOUTME: Frontend types for context breakdown feature
   // ABOUTME: Re-exports core types with web-specific additions

   // Import from core package
   import type {
     ContextBreakdown as CoreContextBreakdown,
     CategoryDetail,
     MessageCategoryDetail,
     ItemDetail,
   } from '@lace/core/token-management';

   // Re-export core types
   export type {
     CategoryDetail,
     MessageCategoryDetail,
     ItemDetail,
   };

   // Frontend type that matches API response
   // (Should be identical to core type, but explicitly defined for clarity)
   export type ContextBreakdown = CoreContextBreakdown;
   ```

2. Update `packages/web/types/index.ts` (if it exists) to export:
   ```typescript
   export type { ContextBreakdown, CategoryDetail, MessageCategoryDetail, ItemDetail } from './context';
   ```

**Testing**:
- Verify TypeScript compilation: `cd packages/web && npm run build`

**Commit**: `feat(web): add context breakdown type definitions`

---

#### Task 3.2: Create Context Breakdown List Component

**Objective**: Build the detailed list view showing categories and token counts.

**Files to Create**:
- `packages/web/components/context/ContextBreakdownList.tsx`

**Files to Read First** (understand component patterns):
- `packages/web/components/ui/Alert.tsx` - DaisyUI component wrapper example
- `packages/web/components/ui/Badge.tsx` - Badge styling

**What to Do**:

1. Create component file:
   ```typescript
   // ABOUTME: Detailed list view of context breakdown by category
   // ABOUTME: Shows token counts, percentages, and nested items

   'use client';

   import React from 'react';
   import type { ContextBreakdown } from '@/types/context';
   import { Badge } from '@/components/ui/Badge';

   interface ContextBreakdownListProps {
     breakdown: ContextBreakdown;
   }

   export function ContextBreakdownList({ breakdown }: ContextBreakdownListProps) {
     // Helper to format token counts
     const formatTokens = (tokens: number): string => {
       if (tokens < 1000) return tokens.toString();
       if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
       return `${(tokens / 1000000).toFixed(1)}M`;
     };

     // Helper to calculate percentage
     const calcPercent = (tokens: number): string => {
       return ((tokens / breakdown.contextLimit) * 100).toFixed(1);
     };

     // Color coding for categories
     const getCategoryColor = (categoryName: string) => {
       const colors: Record<string, string> = {
         systemPrompt: 'badge-primary',
         coreTools: 'badge-secondary',
         mcpTools: 'badge-accent',
         messages: 'badge-info',
         reservedForResponse: 'badge-warning',
         freeSpace: 'badge-success',
       };
       return colors[categoryName] || 'badge-neutral';
     };

     return (
       <div className="space-y-4 text-sm">
         {/* System Prompt */}
         <CategoryRow
           name="System Prompt"
           tokens={breakdown.categories.systemPrompt.tokens}
           percentage={calcPercent(breakdown.categories.systemPrompt.tokens)}
           color={getCategoryColor('systemPrompt')}
         />

         {/* Core Tools */}
         <CategoryRow
           name="Core Tools"
           tokens={breakdown.categories.coreTools.tokens}
           percentage={calcPercent(breakdown.categories.coreTools.tokens)}
           color={getCategoryColor('coreTools')}
         >
           {breakdown.categories.coreTools.items?.map(item => (
             <ItemRow key={item.name} name={item.name} tokens={item.tokens} />
           ))}
         </CategoryRow>

         {/* MCP Tools */}
         <CategoryRow
           name="MCP Tools"
           tokens={breakdown.categories.mcpTools.tokens}
           percentage={calcPercent(breakdown.categories.mcpTools.tokens)}
           color={getCategoryColor('mcpTools')}
         >
           {breakdown.categories.mcpTools.items?.map(item => (
             <ItemRow key={item.name} name={item.name} tokens={item.tokens} />
           ))}
         </CategoryRow>

         {/* Messages */}
         <CategoryRow
           name="Messages"
           tokens={breakdown.categories.messages.tokens}
           percentage={calcPercent(breakdown.categories.messages.tokens)}
           color={getCategoryColor('messages')}
         >
           <ItemRow
             name="User Messages"
             tokens={breakdown.categories.messages.subcategories.userMessages.tokens}
           />
           <ItemRow
             name="Agent Messages"
             tokens={breakdown.categories.messages.subcategories.agentMessages.tokens}
           />
           <ItemRow
             name="Tool Calls"
             tokens={breakdown.categories.messages.subcategories.toolCalls.tokens}
           />
           <ItemRow
             name="Tool Results"
             tokens={breakdown.categories.messages.subcategories.toolResults.tokens}
           />
         </CategoryRow>

         {/* Reserved for Response */}
         <CategoryRow
           name="Reserved for Response"
           tokens={breakdown.categories.reservedForResponse.tokens}
           percentage={calcPercent(breakdown.categories.reservedForResponse.tokens)}
           color={getCategoryColor('reservedForResponse')}
         />

         {/* Free Space */}
         <CategoryRow
           name="Free Space"
           tokens={breakdown.categories.freeSpace.tokens}
           percentage={calcPercent(breakdown.categories.freeSpace.tokens)}
           color={getCategoryColor('freeSpace')}
         />
       </div>
     );
   }

   // Sub-component for category rows
   function CategoryRow({
     name,
     tokens,
     percentage,
     color,
     children,
   }: {
     name: string;
     tokens: number;
     percentage: string;
     color: string;
     children?: React.ReactNode;
   }) {
     const formatTokens = (tokens: number): string => {
       if (tokens < 1000) return tokens.toLocaleString();
       if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
       return `${(tokens / 1000000).toFixed(1)}M`;
     };

     return (
       <div className="space-y-1">
         <div className="flex items-center justify-between">
           <div className="flex items-center gap-2">
             <Badge variant="neutral" size="xs" className={color}>
               ■
             </Badge>
             <span className="font-medium">{name}</span>
           </div>
           <div className="flex items-center gap-2 text-base-content/70">
             <span>{formatTokens(tokens)} tokens</span>
             <Badge variant="neutral" size="xs">
               {percentage}%
             </Badge>
           </div>
         </div>
         {children && <div className="ml-6 space-y-1">{children}</div>}
       </div>
     );
   }

   // Sub-component for item rows (nested under categories)
   function ItemRow({ name, tokens }: { name: string; tokens: number }) {
     const formatTokens = (tokens: number): string => {
       if (tokens < 1000) return tokens.toLocaleString();
       if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
       return `${(tokens / 1000000).toFixed(1)}M`;
     };

     return (
       <div className="flex items-center justify-between text-base-content/60">
         <span className="text-xs">└─ {name}</span>
         <span className="text-xs">{formatTokens(tokens)}</span>
       </div>
     );
   }
   ```

**Testing**:
1. Create test file: `packages/web/components/context/ContextBreakdownList.test.tsx`

```typescript
// ABOUTME: Tests for context breakdown list component
// ABOUTME: Validates rendering and formatting of context data

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextBreakdownList } from './ContextBreakdownList';
import type { ContextBreakdown } from '@/types/context';

describe('ContextBreakdownList', () => {
  const mockBreakdown: ContextBreakdown = {
    timestamp: '2025-09-29T14:23:45.123Z',
    modelId: 'claude-sonnet-4-5',
    contextLimit: 200000,
    totalUsedTokens: 95430,
    percentUsed: 0.477,
    categories: {
      systemPrompt: { tokens: 8450 },
      coreTools: {
        tokens: 12300,
        items: [
          { name: 'bash', tokens: 2100 },
          { name: 'file-read', tokens: 1800 },
        ],
      },
      mcpTools: {
        tokens: 4200,
        items: [{ name: 'deepwiki__read', tokens: 2100 }],
      },
      messages: {
        tokens: 45780,
        subcategories: {
          userMessages: { tokens: 8900 },
          agentMessages: { tokens: 28300 },
          toolCalls: { tokens: 3200 },
          toolResults: { tokens: 5380 },
        },
      },
      reservedForResponse: { tokens: 20000 },
      freeSpace: { tokens: 24700 },
    },
  };

  it('should render all category names', () => {
    render(<ContextBreakdownList breakdown={mockBreakdown} />);

    expect(screen.getByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText('Core Tools')).toBeInTheDocument();
    expect(screen.getByText('MCP Tools')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Reserved for Response')).toBeInTheDocument();
    expect(screen.getByText('Free Space')).toBeInTheDocument();
  });

  it('should display token counts', () => {
    render(<ContextBreakdownList breakdown={mockBreakdown} />);

    // Check formatted token displays (8450 -> "8.5k")
    expect(screen.getByText(/8\.5k tokens/)).toBeInTheDocument();
  });

  it('should display tool items', () => {
    render(<ContextBreakdownList breakdown={mockBreakdown} />);

    expect(screen.getByText(/bash/)).toBeInTheDocument();
    expect(screen.getByText(/file-read/)).toBeInTheDocument();
    expect(screen.getByText(/deepwiki__read/)).toBeInTheDocument();
  });

  it('should display message subcategories', () => {
    render(<ContextBreakdownList breakdown={mockBreakdown} />);

    expect(screen.getByText('User Messages')).toBeInTheDocument();
    expect(screen.getByText('Agent Messages')).toBeInTheDocument();
    expect(screen.getByText('Tool Calls')).toBeInTheDocument();
    expect(screen.getByText('Tool Results')).toBeInTheDocument();
  });

  it('should calculate and display percentages', () => {
    render(<ContextBreakdownList breakdown={mockBreakdown} />);

    // System prompt: 8450 / 200000 = 4.2%
    expect(screen.getByText('4.2%')).toBeInTheDocument();
  });
});
```

2. Run tests: `npm test ContextBreakdownList`
3. Fix any test failures
4. Verify in Storybook or by importing into a test page

**Commit**: `feat(web): add context breakdown list component`

---

#### Task 3.3: Create Context Viewer Modal Component

**Objective**: Build the modal that displays context breakdown.

**Files to Create**:
- `packages/web/components/context/ContextViewerModal.tsx`

**Files to Read First**:
- `packages/web/components/ui/Modal.tsx` (or look for DaisyUI modal examples)
- Other modal components in the codebase

**What to Do**:

1. Create modal component:
   ```typescript
   // ABOUTME: Modal dialog for viewing agent context breakdown
   // ABOUTME: Displays snapshot of token usage with visualization and details

   'use client';

   import React, { useEffect, useState } from 'react';
   import type { ContextBreakdown } from '@/types/context';
   import { ContextBreakdownList } from './ContextBreakdownList';
   import { api } from '@/lib/api-client';
   import type { ThreadId } from '@/types/core';

   interface ContextViewerModalProps {
     agentId: ThreadId;
     isOpen: boolean;
     onClose: () => void;
   }

   export function ContextViewerModal({ agentId, isOpen, onClose }: ContextViewerModalProps) {
     const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);

     // Fetch context breakdown when modal opens
     useEffect(() => {
       if (!isOpen) return;

       const fetchBreakdown = async () => {
         setLoading(true);
         setError(null);

         try {
           const data = await api.get<ContextBreakdown>(
             `/api/agents/${agentId}/context`
           );
           setBreakdown(data);
         } catch (err) {
           console.error('Failed to fetch context breakdown:', err);
           setError(err instanceof Error ? err.message : 'Failed to load context');
         } finally {
           setLoading(false);
         }
       };

       void fetchBreakdown();
     }, [isOpen, agentId]);

     // Handle ESC key
     useEffect(() => {
       const handleEsc = (e: KeyboardEvent) => {
         if (e.key === 'Escape' && isOpen) {
           onClose();
         }
       };

       document.addEventListener('keydown', handleEsc);
       return () => document.removeEventListener('keydown', handleEsc);
     }, [isOpen, onClose]);

     if (!isOpen) return null;

     return (
       <>
         {/* Backdrop */}
         <div
           className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
           onClick={onClose}
         />

         {/* Modal */}
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="modal-box max-w-3xl max-h-[90vh] overflow-y-auto">
             {/* Header */}
             <div className="flex items-start justify-between mb-4">
               <div>
                 <h3 className="text-lg font-bold">Context Usage</h3>
                 {breakdown && (
                   <div className="text-sm text-base-content/60 mt-1">
                     <div>{breakdown.modelId} • {formatTokenCount(breakdown.contextLimit)} tokens</div>
                     <div>
                       Snapshot: {formatTimestamp(breakdown.timestamp)}
                     </div>
                   </div>
                 )}
               </div>
               <button
                 className="btn btn-sm btn-circle btn-ghost"
                 onClick={onClose}
                 aria-label="Close"
               >
                 ✕
               </button>
             </div>

             {/* Content */}
             <div className="divider my-2" />

             {loading && (
               <div className="flex items-center justify-center py-12">
                 <div className="loading loading-spinner loading-lg" />
               </div>
             )}

             {error && (
               <div className="alert alert-error">
                 <span>{error}</span>
               </div>
             )}

             {breakdown && !loading && !error && (
               <ContextBreakdownList breakdown={breakdown} />
             )}
           </div>
         </div>
       </>
     );
   }

   // Helper functions
   function formatTokenCount(tokens: number): string {
     if (tokens < 1000) return tokens.toLocaleString();
     if (tokens < 1000000) return `${(tokens / 1000).toFixed(0)}k`;
     return `${(tokens / 1000000).toFixed(1)}M`;
   }

   function formatTimestamp(timestamp: string): string {
     const date = new Date(timestamp);
     return date.toLocaleTimeString([], {
       hour: '2-digit',
       minute: '2-digit'
     });
   }
   ```

**Testing**:

Create test file: `packages/web/components/context/ContextViewerModal.test.tsx`

```typescript
// ABOUTME: Tests for context viewer modal component
// ABOUTME: Validates modal behavior, loading states, and error handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextViewerModal } from './ContextViewerModal';
import { api } from '@/lib/api-client';

// Mock API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('ContextViewerModal', () => {
  const mockAgentId = 'test-agent-123';
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when closed', () => {
    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={false}
        onClose={mockOnClose}
      />
    );

    expect(screen.queryByText('Context Usage')).not.toBeInTheDocument();
  });

  it('should render when open', () => {
    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText('Context Usage')).toBeInTheDocument();
  });

  it('should show loading state initially', () => {
    vi.mocked(api.get).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument(); // Loading spinner
  });

  it('should fetch and display breakdown', async () => {
    const mockBreakdown = {
      timestamp: '2025-09-29T14:23:45.123Z',
      modelId: 'claude-sonnet-4-5',
      contextLimit: 200000,
      totalUsedTokens: 95430,
      percentUsed: 0.477,
      categories: {
        systemPrompt: { tokens: 8450 },
        coreTools: { tokens: 12300, items: [] },
        mcpTools: { tokens: 4200, items: [] },
        messages: {
          tokens: 45780,
          subcategories: {
            userMessages: { tokens: 8900 },
            agentMessages: { tokens: 28300 },
            toolCalls: { tokens: 3200 },
            toolResults: { tokens: 5380 },
          },
        },
        reservedForResponse: { tokens: 20000 },
        freeSpace: { tokens: 24700 },
      },
    };

    vi.mocked(api.get).mockResolvedValue(mockBreakdown);

    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument();
    });

    expect(screen.getByText('System Prompt')).toBeInTheDocument();
  });

  it('should display error message on fetch failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('should close on backdrop click', async () => {
    vi.mocked(api.get).mockResolvedValue({
      /* minimal mock data */
    });

    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const backdrop = screen.getByRole('dialog').previousSibling;
    await userEvent.click(backdrop as Element);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should close on ESC key', async () => {
    vi.mocked(api.get).mockResolvedValue({
      /* minimal mock data */
    });

    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    await userEvent.keyboard('{Escape}');

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should close on close button click', async () => {
    vi.mocked(api.get).mockResolvedValue({
      /* minimal mock data */
    });

    render(
      <ContextViewerModal
        agentId={mockAgentId}
        isOpen={true}
        onClose={mockOnClose}
      />
    );

    const closeButton = screen.getByLabelText('Close');
    await userEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
```

**Testing**:
1. Run tests: `npm test ContextViewerModal`
2. Fix any failures
3. Manual testing in browser (next task)

**Commit**: `feat(web): add context viewer modal component`

---

#### Task 3.4: Wire Modal to CompactTokenUsage

**Objective**: Make clicking token usage display open the modal.

**Files to Modify**:
- `packages/web/components/ui/CompactTokenUsage.tsx`

**What to Do**:

1. Add modal state and click handler:
   ```typescript
   // At the top, add import
   import { ContextViewerModal } from '@/components/context/ContextViewerModal';

   // Inside CompactTokenUsage component
   export const CompactTokenUsage = memo(function CompactTokenUsage({
     agentId,
   }: {
     agentId: ThreadId;
   }) {
     const usageResult: UseAgentTokenUsageResult = useAgentTokenUsage(agentId);
     const [isModalOpen, setIsModalOpen] = useState(false);

     if (usageResult.loading) {
       return (
         <div className="text-xs text-base-content/40 flex items-center gap-1">
           <div className="loading loading-spinner loading-xs" role="status"></div>
           <span>Loading usage...</span>
         </div>
       );
     }

     if (usageResult.error || !usageResult.tokenUsage) {
       return null;
     }

     return (
       <>
         <button
           className="text-xs text-base-content/40 hover:text-base-content/70 transition-colors cursor-pointer"
           onClick={() => setIsModalOpen(true)}
           title="View context breakdown"
         >
           <TokenUsageDisplay tokenUsage={usageResult.tokenUsage} loading={false} />
         </button>

         <ContextViewerModal
           agentId={agentId}
           isOpen={isModalOpen}
           onClose={() => setIsModalOpen(false)}
         />
       </>
     );
   });
   ```

2. Add `useState` import if not already present:
   ```typescript
   import React, { memo, useState } from 'react';
   ```

**Testing**:
1. Start dev server: `npm run dev`
2. Navigate to agent chat page
3. Click on token usage display in footer
4. Modal should open with context breakdown
5. Verify:
   - Modal displays model info and timestamp
   - All categories are shown
   - Token counts are accurate
   - Can close with X button, backdrop, or ESC
6. Test with different conversation states:
   - Fresh agent (no messages)
   - After sending user message
   - After agent response
   - After tool calls

**Commit**: `feat(web): wire context modal to token usage display`

---

**Phase 3 Complete! Checkpoint:**
- Modal opens on click
- Context breakdown displays correctly
- All categories show accurate data
- Ready for visualization enhancement

---

### Phase 4: Visualization Enhancement (Optional)

Add treemap visualization (if feasible) or enhance with progress bars.

---

#### Task 4.1: Evaluate Treemap Libraries

**Objective**: Research and choose a treemap library.

**What to Do**:

1. Research options:
   - **Recharts** - Popular, React-friendly, has treemap support
   - **Nivo** - Beautiful visualizations, good TypeScript support
   - **D3.js** - Powerful but complex
   - **Victory** - Another React option

2. Create a spike/prototype:
   - Install candidate library: `npm install recharts` (or chosen library)
   - Create test file: `packages/web/components/context/TreemapPrototype.tsx`
   - Implement basic treemap with mock data
   - Evaluate:
     - Is it straightforward to implement?
     - Does it work with our data structure?
     - Is the bundle size acceptable?
     - Does it look good with DaisyUI theme?

3. Decision point:
   - **If treemap is straightforward**: Proceed to Task 4.2
   - **If treemap is complex**: Skip to Task 4.3 (progress bars fallback)

**Example Recharts Prototype**:

```typescript
'use client';

import React from 'react';
import { Treemap, ResponsiveContainer } from 'recharts';
import type { ContextBreakdown } from '@/types/context';

export function TreemapPrototype({ breakdown }: { breakdown: ContextBreakdown }) {
  // Transform breakdown into recharts format
  const data = [
    {
      name: 'Context',
      children: [
        {
          name: 'System Prompt',
          size: breakdown.categories.systemPrompt.tokens,
        },
        {
          name: 'Core Tools',
          size: breakdown.categories.coreTools.tokens,
        },
        {
          name: 'MCP Tools',
          size: breakdown.categories.mcpTools.tokens,
        },
        {
          name: 'Messages',
          size: breakdown.categories.messages.tokens,
        },
        {
          name: 'Reserved',
          size: breakdown.categories.reservedForResponse.tokens,
        },
        {
          name: 'Free',
          size: breakdown.categories.freeSpace.tokens,
        },
      ],
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <Treemap
        data={data}
        dataKey="size"
        stroke="#fff"
        fill="#8884d8"
      />
    </ResponsiveContainer>
  );
}
```

**Testing**:
1. Import prototype into modal temporarily
2. Verify it renders correctly
3. Check bundle size impact: `npm run build && ls -lh dist/`

**Decision**: Document decision in commit message

**Commit**: `chore(web): evaluate treemap visualization options [decision: X]`

---

#### Task 4.2: Implement Treemap Visualization (If Chosen)

**Objective**: Add treemap to context modal.

**Files to Create**:
- `packages/web/components/context/ContextTreemap.tsx`

**Files to Modify**:
- `packages/web/components/context/ContextViewerModal.tsx`

**Only proceed if Task 4.1 decision was YES to treemap**

**What to Do**:

1. Create treemap component (customize based on library):
   ```typescript
   // ABOUTME: Treemap visualization of context breakdown
   // ABOUTME: Shows proportional rectangles for each category

   'use client';

   import React from 'react';
   import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
   import type { ContextBreakdown } from '@/types/context';

   export function ContextTreemap({ breakdown }: { breakdown: ContextBreakdown }) {
     // Transform data
     const data = [
       {
         name: 'Context',
         children: [
           {
             name: 'System Prompt',
             size: breakdown.categories.systemPrompt.tokens,
             fill: 'hsl(var(--p))', // DaisyUI primary color
           },
           {
             name: 'Core Tools',
             size: breakdown.categories.coreTools.tokens,
             fill: 'hsl(var(--s))', // Secondary
           },
           {
             name: 'MCP Tools',
             size: breakdown.categories.mcpTools.tokens,
             fill: 'hsl(var(--a))', // Accent
           },
           {
             name: 'Messages',
             size: breakdown.categories.messages.tokens,
             fill: 'hsl(var(--in))', // Info
           },
           {
             name: 'Reserved',
             size: breakdown.categories.reservedForResponse.tokens,
             fill: 'hsl(var(--wa))', // Warning
           },
           {
             name: 'Free',
             size: breakdown.categories.freeSpace.tokens,
             fill: 'hsl(var(--su))', // Success
           },
         ],
       },
     ];

     const CustomTooltip = ({ active, payload }: any) => {
       if (active && payload && payload[0]) {
         const data = payload[0].payload;
         return (
           <div className="bg-base-100 p-2 border border-base-300 rounded shadow-lg">
             <p className="font-medium">{data.name}</p>
             <p className="text-sm text-base-content/70">
               {data.size.toLocaleString()} tokens
             </p>
           </div>
         );
       }
       return null;
     };

     return (
       <div className="mb-6">
         <ResponsiveContainer width="100%" height={300}>
           <Treemap
             data={data}
             dataKey="size"
             stroke="#fff"
             strokeWidth={2}
           >
             <Tooltip content={<CustomTooltip />} />
           </Treemap>
         </ResponsiveContainer>
       </div>
     );
   }
   ```

2. Add to modal:
   ```typescript
   // In ContextViewerModal.tsx, after header
   {breakdown && !loading && !error && (
     <>
       <ContextTreemap breakdown={breakdown} />
       <div className="divider my-2" />
       <ContextBreakdownList breakdown={breakdown} />
     </>
   )}
   ```

**Testing**:
1. Verify treemap renders correctly
2. Test hover interactions
3. Verify colors match theme
4. Test with different data (empty categories, large categories)

**Commit**: `feat(web): add treemap visualization to context modal`

---

#### Task 4.3: Implement Progress Bar Visualization (Fallback)

**Objective**: Add progress bars if treemap wasn't chosen.

**Files to Create**:
- `packages/web/components/context/ContextProgressBars.tsx`

**Only proceed if Task 4.1 decision was NO to treemap**

**What to Do**:

1. Create progress bar component:
   ```typescript
   // ABOUTME: Progress bar visualization of context breakdown
   // ABOUTME: Shows stacked and individual progress bars for categories

   'use client';

   import React from 'react';
   import type { ContextBreakdown } from '@/types/context';

   export function ContextProgressBars({ breakdown }: { breakdown: ContextBreakdown }) {
     const { categories, contextLimit } = breakdown;

     // Calculate percentages
     const getPercent = (tokens: number) => (tokens / contextLimit) * 100;

     const systemPercent = getPercent(categories.systemPrompt.tokens);
     const coreToolsPercent = getPercent(categories.coreTools.tokens);
     const mcpToolsPercent = getPercent(categories.mcpTools.tokens);
     const messagesPercent = getPercent(categories.messages.tokens);
     const reservedPercent = getPercent(categories.reservedForResponse.tokens);
     const freePercent = getPercent(categories.freeSpace.tokens);

     return (
       <div className="space-y-4 mb-6">
         {/* Stacked Progress Bar */}
         <div className="w-full">
           <div className="text-xs text-base-content/60 mb-1">Overall Usage</div>
           <div className="flex h-8 rounded-lg overflow-hidden border border-base-300">
             <div
               className="bg-primary transition-all"
               style={{ width: `${systemPercent}%` }}
               title={`System: ${systemPercent.toFixed(1)}%`}
             />
             <div
               className="bg-secondary transition-all"
               style={{ width: `${coreToolsPercent}%` }}
               title={`Core Tools: ${coreToolsPercent.toFixed(1)}%`}
             />
             <div
               className="bg-accent transition-all"
               style={{ width: `${mcpToolsPercent}%` }}
               title={`MCP: ${mcpToolsPercent.toFixed(1)}%`}
             />
             <div
               className="bg-info transition-all"
               style={{ width: `${messagesPercent}%` }}
               title={`Messages: ${messagesPercent.toFixed(1)}%`}
             />
             <div
               className="bg-warning transition-all"
               style={{ width: `${reservedPercent}%` }}
               title={`Reserved: ${reservedPercent.toFixed(1)}%`}
             />
             <div
               className="bg-success transition-all"
               style={{ width: `${freePercent}%` }}
               title={`Free: ${freePercent.toFixed(1)}%`}
             />
           </div>
         </div>

         {/* Individual Category Bars */}
         <div className="space-y-2">
           <CategoryBar
             label="System Prompt"
             percent={systemPercent}
             color="bg-primary"
           />
           <CategoryBar
             label="Core Tools"
             percent={coreToolsPercent}
             color="bg-secondary"
           />
           <CategoryBar
             label="MCP Tools"
             percent={mcpToolsPercent}
             color="bg-accent"
           />
           <CategoryBar
             label="Messages"
             percent={messagesPercent}
             color="bg-info"
           />
           <CategoryBar
             label="Reserved"
             percent={reservedPercent}
             color="bg-warning"
           />
           <CategoryBar
             label="Free"
             percent={freePercent}
             color="bg-success"
           />
         </div>
       </div>
     );
   }

   function CategoryBar({
     label,
     percent,
     color,
   }: {
     label: string;
     percent: number;
     color: string;
   }) {
     return (
       <div>
         <div className="flex justify-between text-xs text-base-content/70 mb-1">
           <span>{label}</span>
           <span>{percent.toFixed(1)}%</span>
         </div>
         <div className="w-full bg-base-200 rounded-full h-2">
           <div
             className={`${color} h-2 rounded-full transition-all`}
             style={{ width: `${percent}%` }}
           />
         </div>
       </div>
     );
   }
   ```

2. Add to modal:
   ```typescript
   // In ContextViewerModal.tsx
   {breakdown && !loading && !error && (
     <>
       <ContextProgressBars breakdown={breakdown} />
       <div className="divider my-2" />
       <ContextBreakdownList breakdown={breakdown} />
     </>
   )}
   ```

**Testing**:
1. Verify progress bars render correctly
2. Verify percentages are accurate
3. Test with different data sizes
4. Verify colors match DaisyUI theme

**Commit**: `feat(web): add progress bar visualization to context modal`

---

**Phase 4 Complete! Checkpoint:**
- Visualization is complete (either treemap or progress bars)
- Modal has both visual and detailed breakdown
- Ready for final polish

---

### Phase 5: Polish and Documentation

Final touches, edge cases, and documentation.

---

#### Task 5.1: Add Loading and Error States Polish

**Objective**: Ensure all edge cases are handled gracefully.

**Files to Modify**:
- `packages/web/components/context/ContextViewerModal.tsx`

**What to Do**:

1. Enhance loading state:
   ```typescript
   {loading && (
     <div className="flex flex-col items-center justify-center py-12 gap-4">
       <div className="loading loading-spinner loading-lg" />
       <p className="text-sm text-base-content/60">
         Analyzing context...
       </p>
     </div>
   )}
   ```

2. Enhance error state with retry:
   ```typescript
   {error && (
     <div className="alert alert-error">
       <svg>...</svg>
       <div className="flex-1">
         <h3 className="font-bold">Failed to load context</h3>
         <div className="text-sm">{error}</div>
       </div>
       <button
         className="btn btn-sm"
         onClick={() => {
           setError(null);
           // Re-trigger fetch by toggling a flag
         }}
       >
         Retry
       </button>
     </div>
   )}
   ```

3. Add empty state handling:
   ```typescript
   {breakdown && breakdown.totalUsedTokens === 0 && (
     <div className="alert alert-info">
       <span>This conversation hasn't started yet. Context is empty.</span>
     </div>
   )}
   ```

**Testing**:
1. Test loading state (add artificial delay)
2. Test error state (simulate API failure)
3. Test empty conversation
4. Test retry functionality

**Commit**: `feat(web): enhance context modal loading and error states`

---

#### Task 5.2: Add Accessibility Improvements

**Objective**: Ensure modal is keyboard navigable and screen reader friendly.

**Files to Modify**:
- `packages/web/components/context/ContextViewerModal.tsx`

**What to Do**:

1. Add ARIA attributes:
   ```typescript
   <div
     className="modal-box max-w-3xl max-h-[90vh] overflow-y-auto"
     role="dialog"
     aria-labelledby="context-modal-title"
     aria-describedby="context-modal-description"
   >
     <h3 id="context-modal-title" className="text-lg font-bold">
       Context Usage
     </h3>
     <div id="context-modal-description" className="sr-only">
       Detailed breakdown of how the AI agent is using its context window
     </div>
   ```

2. Add focus trap (when modal opens, focus should be trapped inside):
   ```typescript
   // Use a library like 'focus-trap-react' or implement custom logic
   ```

3. Add screen reader announcements for loading:
   ```typescript
   {loading && (
     <div
       className="flex items-center justify-center py-12"
       role="status"
       aria-live="polite"
     >
       <div className="loading loading-spinner loading-lg" />
       <span className="sr-only">Loading context breakdown</span>
     </div>
   )}
   ```

**Testing**:
1. Tab through modal (should stay within modal)
2. Test with screen reader (VoiceOver on Mac, NVDA on Windows)
3. Verify all interactive elements are reachable
4. Verify ESC key works

**Commit**: `a11y(web): improve context modal accessibility`

---

#### Task 5.3: Add Component Documentation

**Objective**: Document the new components for other developers.

**Files to Create**:
- `packages/web/components/context/README.md`

**What to Do**:

Create documentation:

```markdown
# Context Viewer Components

Components for displaying detailed breakdown of agent context usage.

## Components

### ContextViewerModal

Main modal dialog that fetches and displays context breakdown.

**Usage:**
```tsx
import { ContextViewerModal } from '@/components/context/ContextViewerModal';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>View Context</button>
      <ContextViewerModal
        agentId={agentId}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
```

**Props:**
- `agentId: ThreadId` - ID of the agent to analyze
- `isOpen: boolean` - Whether modal is visible
- `onClose: () => void` - Callback when modal should close

**Behavior:**
- Fetches context breakdown when opened (static snapshot)
- Displays loading spinner while fetching
- Shows error alert if fetch fails
- Closes on backdrop click, ESC key, or close button

### ContextBreakdownList

Detailed list view of token usage by category.

**Usage:**
```tsx
import { ContextBreakdownList } from '@/components/context/ContextBreakdownList';

<ContextBreakdownList breakdown={breakdown} />
```

**Props:**
- `breakdown: ContextBreakdown` - Context breakdown data

### ContextTreemap / ContextProgressBars

Visual representation of context usage (one or the other is used).

**Usage:**
```tsx
import { ContextTreemap } from '@/components/context/ContextTreemap';
// OR
import { ContextProgressBars } from '@/components/context/ContextProgressBars';

<ContextTreemap breakdown={breakdown} />
```

## Data Structure

See `packages/web/types/context.ts` for full type definitions.

```typescript
interface ContextBreakdown {
  timestamp: string;
  modelId: string;
  contextLimit: number;
  totalUsedTokens: number;
  percentUsed: number;
  categories: {
    systemPrompt: CategoryDetail;
    coreTools: CategoryDetail;
    mcpTools: CategoryDetail;
    messages: MessageCategoryDetail;
    reservedForResponse: CategoryDetail;
    freeSpace: CategoryDetail;
  };
}
```

## Integration

The context viewer is integrated into `CompactTokenUsage` component:
- Clicking the token usage display opens the modal
- Modal shows snapshot of current context state
- No real-time updates (re-open modal to refresh)

## Testing

Run component tests:
```bash
npm test ContextViewerModal
npm test ContextBreakdownList
```

## API Endpoint

Context data comes from: `GET /api/agents/:agentId/context`

See `packages/web/app/routes/api.agents.$agentId.context.ts`
```

**Commit**: `docs(web): add context viewer component documentation`

---

#### Task 5.4: Update Project Documentation

**Objective**: Document the feature in main project docs.

**Files to Modify**:
- `docs/architecture/CODE-MAP.md` (add context viewer locations)
- `CLAUDE.md` (add notes about context viewer if relevant)

**What to Do**:

1. Update CODE-MAP.md:
   ```markdown
   ## Context Viewer Feature

   **Backend**:
   - `packages/core/src/token-management/context-analyzer.ts` - Token analysis engine
   - `packages/core/src/token-management/context-breakdown-types.ts` - Type definitions

   **API**:
   - `packages/web/app/routes/api.agents.$agentId.context.ts` - REST endpoint

   **Frontend**:
   - `packages/web/components/context/ContextViewerModal.tsx` - Main modal
   - `packages/web/components/context/ContextBreakdownList.tsx` - Detailed list
   - `packages/web/components/context/ContextTreemap.tsx` - Treemap visualization
   - `packages/web/components/ui/CompactTokenUsage.tsx` - Entry point (click to open)

   **Types**:
   - `packages/web/types/context.ts` - Frontend type definitions
   ```

2. Add usage notes to CLAUDE.md if relevant:
   ```markdown
   ## Context Viewer

   Users can view detailed context breakdown by clicking the token usage display
   in the chat footer. The modal shows:
   - Token counts by category (system, tools, messages, reserved, free)
   - Visual representation (treemap or progress bars)
   - Detailed listing of tools and message types

   Implementation follows our component system philosophy:
   - DaisyUI-based modal
   - Strong TypeScript types
   - Static snapshot approach (no real-time updates)
   - Fail-cleanly error handling
   ```

**Commit**: `docs: update project documentation for context viewer`

---

#### Task 5.5: Write End-to-End Test

**Objective**: Add E2E test using Playwright.

**Files to Create**:
- `packages/web/e2e/context-viewer.spec.ts`

**Files to Read First**:
- Other E2E test files to understand patterns

**What to Do**:

```typescript
// ABOUTME: E2E tests for context viewer modal
// ABOUTME: Validates full user flow from chat to context breakdown

import { test, expect } from '@playwright/test';

test.describe('Context Viewer', () => {
  test.beforeEach(async ({ page }) => {
    // Set up: Create project, session, agent
    // This depends on your existing E2E setup
    await page.goto('/');
    // ... setup code
  });

  test('should open context modal when clicking token usage', async ({ page }) => {
    // Navigate to agent chat
    await page.goto('/project/1/session/1/agent/1');

    // Wait for token usage display
    await page.waitForSelector('[data-testid="token-usage"]', { timeout: 5000 });

    // Click token usage
    await page.click('[data-testid="token-usage"]');

    // Modal should appear
    await expect(page.getByText('Context Usage')).toBeVisible();
  });

  test('should display context breakdown categories', async ({ page }) => {
    await page.goto('/project/1/session/1/agent/1');
    await page.click('[data-testid="token-usage"]');

    // Wait for modal to load
    await page.waitForSelector('[data-testid="context-breakdown"]');

    // Verify categories are present
    await expect(page.getByText('System Prompt')).toBeVisible();
    await expect(page.getByText('Core Tools')).toBeVisible();
    await expect(page.getByText('Messages')).toBeVisible();
    await expect(page.getByText('Reserved for Response')).toBeVisible();
    await expect(page.getByText('Free Space')).toBeVisible();
  });

  test('should close modal on ESC key', async ({ page }) => {
    await page.goto('/project/1/session/1/agent/1');
    await page.click('[data-testid="token-usage"]');

    await expect(page.getByText('Context Usage')).toBeVisible();

    // Press ESC
    await page.keyboard.press('Escape');

    // Modal should disappear
    await expect(page.getByText('Context Usage')).not.toBeVisible();
  });

  test('should close modal on backdrop click', async ({ page }) => {
    await page.goto('/project/1/session/1/agent/1');
    await page.click('[data-testid="token-usage"]');

    await expect(page.getByText('Context Usage')).toBeVisible();

    // Click backdrop (outside modal)
    await page.click('.modal-backdrop', { force: true });

    await expect(page.getByText('Context Usage')).not.toBeVisible();
  });

  test('should show accurate token counts', async ({ page }) => {
    // Send a message to create some context
    await page.goto('/project/1/session/1/agent/1');
    await page.fill('[data-testid="chat-input"]', 'Hello, agent!');
    await page.click('[data-testid="send-button"]');

    // Wait for response
    await page.waitForSelector('[data-testid="agent-message"]');

    // Open context viewer
    await page.click('[data-testid="token-usage"]');

    // Verify message tokens are greater than 0
    const messageTokens = await page.textContent('[data-testid="messages-tokens"]');
    expect(parseInt(messageTokens || '0')).toBeGreaterThan(0);
  });
});
```

**Note**: You'll need to add `data-testid` attributes to components for reliable E2E testing.

**Testing**:
1. Run E2E tests: `npm run test:e2e`
2. Fix any failures
3. Ensure tests are stable (no flakiness)

**Commit**: `test(web): add E2E tests for context viewer`

---

**Phase 5 Complete! Checkpoint:**
- All edge cases handled
- Accessibility improved
- Documentation complete
- E2E tests passing

---

## Final Checklist

Before marking this feature complete, verify:

### Functionality
- [ ] Context analyzer correctly counts tokens for all categories
- [ ] API endpoint returns valid JSON
- [ ] Modal opens when clicking token usage
- [ ] Modal displays all categories with accurate counts
- [ ] Modal shows visualization (treemap or progress bars)
- [ ] Modal closes on backdrop, ESC, or close button
- [ ] Error states display correctly
- [ ] Loading states display correctly
- [ ] Empty conversation handled gracefully

### Code Quality
- [ ] All tests pass: `npm test`
- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Linting passes: `npm run lint`
- [ ] No console warnings in browser
- [ ] Code follows DRY principles
- [ ] Components follow our styling patterns (DaisyUI)

### Documentation
- [ ] Component README exists
- [ ] CODE-MAP updated
- [ ] All functions have clear comments
- [ ] ABOUTME comments present in all new files
- [ ] API endpoint documented

### Testing
- [ ] Unit tests for ContextAnalyzer
- [ ] Component tests for all React components
- [ ] E2E test for full user flow
- [ ] Manual testing in browser completed
- [ ] Tested with different conversation states

### Performance
- [ ] Modal loads quickly (< 1 second)
- [ ] No performance regression in chat UI
- [ ] Bundle size increase is acceptable
- [ ] No memory leaks (modal cleanup works)

### Accessibility
- [ ] Keyboard navigation works
- [ ] Screen reader announces loading states
- [ ] Focus trap works in modal
- [ ] ARIA labels present

### Git Hygiene
- [ ] Frequent, logical commits throughout
- [ ] Clear commit messages following conventions
- [ ] No uncommitted changes
- [ ] All tests passing on final commit

## Common Issues and Solutions

### Issue: Token counts don't match expectations

**Solution**:
- Verify token counting utility is accurate
- Check that all event types are being processed
- Compare with actual provider API token counts

### Issue: Modal doesn't close

**Solution**:
- Check ESC key handler is registered correctly
- Verify backdrop click handler
- Check React state management (isOpen prop)

### Issue: API returns 404 for valid agent

**Solution**:
- Verify SessionService.getAgent() method exists and works
- Check agent ID format (might need type conversion)
- Add logging to API route to debug

### Issue: Tests fail intermittently

**Solution**:
- Add proper `waitFor` assertions
- Mock API calls consistently
- Clear mocks between tests (`beforeEach`)

### Issue: TypeScript errors about core package imports

**Solution**:
- Verify workspace reference in `packages/web/package.json`
- Check that core package exports types correctly
- Rebuild core package: `cd packages/core && npm run build`

## References

### Key Files to Reference
- Token counting: `packages/core/src/token-management/token-counter.ts`
- Agent structure: `packages/core/src/agents/agent.ts`
- Thread events: `packages/core/src/threads/types.ts`
- Existing modal: Look for other modal components in `packages/web/components/`
- DaisyUI docs: https://daisyui.com/components/modal/

### Testing Patterns
- Agent setup: Look at `packages/core/src/agents/agent.test.ts`
- Component testing: Look at `packages/web/components/ui/__tests__/`
- E2E testing: Look at existing Playwright tests

### Component Patterns
- Modal structure: Search for existing modals in codebase
- DaisyUI usage: Look at `Alert.tsx`, `Badge.tsx` components
- API client usage: Look at `useAgentTokenUsage` hook

## Estimated Timeline

- **Phase 1 (Backend)**: 4-6 hours
- **Phase 2 (API)**: 1-2 hours
- **Phase 3 (Frontend)**: 3-4 hours
- **Phase 4 (Visualization)**: 2-3 hours
- **Phase 5 (Polish)**: 2-3 hours

**Total**: 12-18 hours (2-3 days for a developer new to the codebase)

## Success Criteria

This feature is complete when:

1. Users can click token usage display and see a modal
2. Modal shows accurate breakdown of context by category
3. Visual representation (treemap or progress bars) is present
4. All categories are listed with token counts
5. Modal closes properly and doesn't leak memory
6. All tests pass (unit, component, E2E)
7. Documentation is complete
8. Code is clean, DRY, and follows project patterns

---

**Good luck! Remember: TDD, frequent commits, and ask for help when needed.**