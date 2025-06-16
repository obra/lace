# Lace Architecture Refactor Plan

## Current Problem

The current `src/agent.ts` file mixes multiple concerns:
- CLI argument parsing
- Interactive readline interface  
- Provider/tool setup
- Core conversation processing
- Direct console I/O throughout

This makes it impossible to:
- Create programmatic APIs
- Support multiple interfaces (CLI, web, Ink console)
- Implement streaming token-by-token responses
- Use agents as sub-agents/tools
- Test core logic separately from UI

## Proposed Architecture

### Core Agent Enhancement

**Enhance `src/agents/agent.ts`** from a thin provider wrapper into a full conversation processor:

```typescript
class Agent extends EventEmitter {
  // Core conversation methods
  async sendMessage(content: string): Promise<void>
  async continueConversation(): Promise<void>
  
  // State access (read-only)
  getConversationHistory(): ProviderMessage[]
  getCurrentState(): 'idle' | 'thinking' | 'tool_execution' | 'streaming'
  getThreadId(): string
  getAvailableTools(): Tool[]
  
  // Control methods
  start(): void
  stop(): void
  pause(): void
  resume(): void
}
```

**Events Emitted:**
```typescript
'agent_thinking_start'
'agent_token'              // { token: string } - for streaming
'agent_thinking_complete'   // { content: string }
'agent_response_complete'   // { content: string }
'tool_call_start'          // { toolName: string, input: object }
'tool_call_complete'       // { toolName: string, result: ToolResult }
'state_change'             // { from: State, to: State }
'error'                    // { error: Error, context: object }
'conversation_complete'
```

### File Structure Refactor

**Current:**
```
src/
  agent.ts              # Everything mixed together
  agents/
    agent.ts            # Thin provider wrapper
```

**Proposed:**
```
src/
  cli.ts                # Main CLI entry point
  cli/
    args.ts             # Command line argument parsing
    interface.ts        # CLIInterface class with readline
  agents/
    agent.ts            # Enhanced Agent class (conversation processor)
  interfaces/           # Future: InkInterface, WebInterface, etc.
  providers/            # AI provider abstractions (unchanged)
  tools/                # Tool system (unchanged)
  threads/              # Event storage & conversation building (unchanged)
```

### Interface Architecture

**Event-Driven Design:**
All interfaces subscribe to Agent events and handle presentation differently:

```typescript
// CLI Interface
const agent = new Agent(provider, tools, threadManager, threadId);
const cli = new CLIInterface(agent);

cli.on('agent_token', ({ token }) => process.stdout.write(token));
cli.on('tool_call_start', ({ toolName, input }) => 
  console.log(`🔧 Running: ${toolName}...`));

await cli.start();
```

**Multiple Interface Support:**
```typescript
// Same agent, different presentations
const agent = new Agent(...);

new CLIInterface(agent);      // Current readline interface
new InkInterface(agent);      // Rich console with React-like components  
new WebInterface(agent);      // HTTP/WebSocket API server
new SubAgentTool(agent);      // Agent as a tool for other agents
```

### Streaming Support

**Provider-Level Configuration:**
```typescript
const provider = new AnthropicProvider({ 
  apiKey: "...", 
  streaming: true  // Configure streaming at provider level
});
```

**Agent Passes Through Events:**
- If provider streams → agent emits `agent_token` events
- If provider doesn't stream → agent emits single `agent_response_complete`
- Interfaces choose how to handle tokens vs. complete responses

### Sub-Agent Architecture

**Recursive Agent Support:**
```typescript
class SubAgentTool implements Tool {
  async executeTool(input: Record<string, unknown>): Promise<ToolResult> {
    // Spawn a new agent to handle this sub-task
    const subAgent = new Agent(provider, subTools, newThreadManager);
    await subAgent.sendMessage(input.prompt);
    return result;
  }
}
```

## Implementation Steps

### Phase 1: Extract Core Agent
1. Move conversation processing logic from `src/agent.ts` to enhanced `src/agents/agent.ts`
2. Replace console I/O with EventEmitter events
3. Add state management and control methods
4. Update tests to verify event emissions

### Phase 2: Split CLI Components  
1. Create `src/cli/args.ts` with argument parsing logic
2. Create `src/cli/interface.ts` with CLIInterface class
3. Refactor `src/agent.ts` → `src/cli.ts` as orchestration entry point
4. Wire everything together and verify CLI still works

### Phase 3: Add Streaming Support
1. Add streaming support to Anthropic provider (if not already present)
2. Implement token-by-token event emission in Agent
3. Update CLIInterface to handle streaming presentation
4. Test streaming vs. non-streaming providers

### Phase 4: Create Interface Framework
1. Define common Interface base class or pattern
2. Implement InkInterface for rich console UI
3. Implement WebInterface for HTTP/WebSocket API
4. Create SubAgentTool for recursive agent calls

### Phase 5: Polish & Documentation
1. Add comprehensive examples for each interface type
2. Document the event-driven architecture
3. Create TypeScript SDK wrapper for external use
4. Performance testing and optimization

## Benefits

**For Development:**
- Clean separation of concerns
- Testable core logic independent of UI
- Reusable components across interfaces

**For Users:**
- Multiple interface options (CLI, web, rich console)
- Streaming responses for better UX
- Programmatic API for integration
- Sub-agent capabilities for complex workflows

**For Future Growth:**
- Easy to add new interface types
- Agent-as-a-service deployment ready
- Foundation for advanced features (multi-agent, workflows)
- Clean foundation for performance optimizations

## Risk Mitigation

**Backward Compatibility:**
- Keep existing CLI interface working throughout refactor
- Maintain all current command-line arguments and behavior
- Preserve session management and thread continuity

**Testing Strategy:**
- Unit tests for each component in isolation
- Integration tests for full conversation flows
- CLI behavior tests to ensure no regression
- Performance benchmarks for streaming vs. non-streaming

**Migration Path:**
- Each phase is independently deliverable
- Can ship improvements incrementally
- Easy rollback points if issues arise