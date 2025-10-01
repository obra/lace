# Design Fix: MCP Tool Integration

## Problem

Task 3.1's `createLaceToolsServer()` requires `ToolExecutor` and `ToolContext`, but `createResponse()` only receives:
- `messages: ProviderMessage[]`
- `tools: Tool[]`
- `model: string`
- `signal?: AbortSignal`

The provider interface doesn't give us ToolExecutor or full ToolContext.

## Solution

**Create MCP server inline within `createResponse()` and call `tool.execute()` directly.**

### Updated Task 3.1: Create MCP Tools Inline

**Replace the `createLaceToolsServer()` method with an inline approach in `createResponse()`:**

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
 * Build minimal ToolContext for SDK tool execution
 * Note: This context lacks agent reference and full workspace info
 * Some advanced tools (delegation, workspace-dependent) may not work
 */
private buildMinimalToolContext(signal: AbortSignal): ToolContext {
  return {
    signal,
    workingDirectory: process.cwd(), // Fallback to process cwd
    // Note: agent, toolExecutor, workspaceInfo are unavailable
    // This is a limitation of the provider interface
  };
}
```

**Then in `createResponse()` (Task 5.1), create MCP server inline:**

```typescript
async createResponse(
  messages: ProviderMessage[],
  tools: Tool[],
  model: string,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  logger.info('SDK Provider createResponse', {
    messageCount: messages.length,
    toolCount: tools.length,
    model,
  });

  const config = this._config as ClaudeSDKProviderConfig;
  if (!config.sessionToken) {
    throw new Error('SDK provider not configured: missing session token');
  }

  const canResume = this.canResumeSession(messages);
  const latestMessage = messages[messages.length - 1];

  if (!latestMessage || latestMessage.role !== 'user') {
    throw new Error('Last message must be a user message');
  }

  // Build minimal tool context (limitation: no agent reference)
  const toolContext = this.buildMinimalToolContext(
    signal || new AbortController().signal
  );

  // Create MCP server inline - use closure to capture tools and context
  const mcpTools = tools.map(tool =>
    sdkTool(
      tool.name,
      tool.description,
      tool.schema.shape,
      async (args: Record<string, unknown>, extra: unknown) => {
        logger.debug('MCP tool called via SDK', {
          toolName: tool.name,
          args,
        });

        try {
          // Call tool.execute() directly
          // NOTE: Validation happens inside Tool.execute() via schema
          const result = await tool.execute(args, toolContext);

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

  const laceToolsServer = createSdkMcpServer({
    name: '__lace-tools',
    version: '1.0.0',
    tools: mcpTools,
  });

  // Build SDK query options
  const queryOptions = {
    resume: canResume ? this.sessionId : undefined,
    forkSession: !canResume && this.sessionId !== undefined,
    model,
    systemPrompt: this._systemPrompt,
    includePartialMessages: false,
    settingSources: [],
    mcpServers: {
      '__lace-tools': laceToolsServer,
      // TODO: Add project/session MCP servers when we have access to them
    },
    allowedTools: ['WebSearch'], // Only SDK's server-side WebSearch
    permissionMode: 'default', // TODO: Map from session permission mode
    // TODO: Add canUseTool handler for approval flow
  };

  // ... rest of implementation (SDK query execution)
}
```

## Limitations & Trade-offs

### What Works
✅ Tools can execute via SDK's MCP system
✅ Tool validation happens automatically (via Tool.execute())
✅ Basic file operations (Read, Write, Edit, Glob, Grep)
✅ Bash commands
✅ WebFetch, WebSearch

### What Doesn't Work
❌ Tools requiring agent reference (e.g., delegation tools)
❌ Tools needing workspace manager
❌ Tool approval flow (will be addressed separately in Task 4.2)
❌ Project-specific environment variables
❌ Tools that need temp directory management

### Why This Limitation Exists

The provider interface is designed to be stateless and agent-agnostic:
- Providers can be shared across multiple agents
- `createResponse()` is a pure function of messages + tools
- Providers don't have lifecycle hooks to receive agent context

### Future Improvements

To support full tool context, we could:

**Option A: Add context parameter to createResponse**
```typescript
async createResponse(
  messages: ProviderMessage[],
  tools: Tool[],
  model: string,
  signal?: AbortSignal,
  context?: { agent?: Agent; executor?: ToolExecutor } // NEW
): Promise<ProviderResponse>
```

**Option B: Add lifecycle method for context**
```typescript
provider.setRequestContext({
  agent: this,
  executor: this._toolExecutor,
  workingDirectory: this._getWorkingDirectory(),
});
const response = await provider.createResponse(...);
provider.clearRequestContext();
```

**Option C: Make SDK provider agent-specific**
- Each agent creates its own SDK provider instance
- Provider stores agent reference in constructor
- Breaks provider sharing model

For now, **accept the limitations** and document them clearly.

## Updated Tests

```typescript
describe('ClaudeSDKProvider - MCP Integration', () => {
  it('should convert ToolResult to CallToolResult', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    const toolResult: ToolResult = {
      content: [{ type: 'text', text: 'Hello' }],
      status: 'completed',
    };

    const mcpResult = (provider as any).convertToolResultToMCP(toolResult);

    expect(mcpResult.content).toHaveLength(1);
    expect(mcpResult.content[0].type).toBe('text');
    expect(mcpResult.isError).toBe(false);
  });

  it('should build minimal tool context', () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });
    const signal = new AbortController().signal;

    const context = (provider as any).buildMinimalToolContext(signal);

    expect(context.signal).toBe(signal);
    expect(context.workingDirectory).toBeDefined();
    expect(context.agent).toBeUndefined(); // Known limitation
  });

  it('should create MCP tools that call tool.execute()', async () => {
    const provider = new ClaudeSDKProvider({ sessionToken: 'test' });

    // Create a mock tool
    const mockTool = {
      name: 'test_tool',
      description: 'Test tool',
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'success' }],
        status: 'completed',
      }),
    };

    // This would be done inline in createResponse, but we test the pattern
    const handler = async (args: any) => {
      const context = { signal: new AbortController().signal };
      const result = await mockTool.execute(args, context);
      return (provider as any).convertToolResultToMCP(result);
    };

    const mcpResult = await handler({ input: 'test' });

    expect(mockTool.execute).toHaveBeenCalled();
    expect(mcpResult.isError).toBe(false);
  });
});
```

## Documentation Note

Add to provider documentation:

```markdown
## Known Limitations

### Tool Context Restrictions

The SDK provider creates a minimal tool context that lacks:
- Agent reference
- Workspace manager
- Project-specific environment variables
- Shared temp directory management

**Impact:**
- Delegation tools (Task, Agent spawning) are NOT supported
- Container/workspace-dependent tools may not work correctly
- Tools receive process.cwd() as working directory, not project directory

**Workaround:**
Use the standard Anthropic provider (with API key) for sessions requiring advanced tool features.

**Why:**
The provider interface doesn't provide agent context. This is by design - providers are stateless and can be shared across agents.
```

## Integration with Approval Flow (Task 4.2)

The approval flow (Task 4.2) has the same issue - `buildCanUseToolHandler` needs session reference.

**Solution:** Defer approval integration to Phase 10 (Future Work) or accept "yolo" mode only initially.

For MVP implementation:
- Set `permissionMode: 'bypassPermissions'` (yolo mode)
- Document that approval flow requires architecture changes
- Track as known limitation

Later, implement one of the "Future Improvements" options to provide full context.
