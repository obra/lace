# Agent Spawning and Management Implementation Specification

## Overview
Implement the ability to spawn multiple agents within a session, manage their lifecycle, and coordinate their work. This builds on the existing delegate thread pattern but makes agents persistent and switchable.

## Background for Engineers

### Current Architecture
- Single agent per conversation
- Delegate tool creates temporary sub-agents
- No concept of sessions or agent teams
- Thread IDs like `lace_20250703_abc123`

### What We're Building
- Sessions containing multiple agents
- Persistent agents you can switch between
- Agent lifecycle (active, suspended, completed)
- Spawning agents with specific roles/models

### Key Files to Understand
- `src/agents/agent.ts` - Agent class
- `src/threads/thread-manager.ts` - Thread management
- `src/tools/implementations/delegate.ts` - Current delegation pattern
- `src/cli.ts` - CLI entry point and agent initialization

## Implementation Plan

### Phase 1: Session Infrastructure

**Task 1.1: Create Session type**

File: `src/sessions/types.ts` (new)

```typescript
export interface Session {
  id: string;                    // Parent thread ID
  name: string;                  // Human-readable session name
  createdAt: Date;
  agents: AgentMetadata[];
  activeAgentId?: string;        // Currently active agent
}

export interface AgentMetadata {
  id: string;                    // Thread ID (parent.1, parent.2, etc)
  name: string;                  // "pm", "architect", etc
  type: 'persistent' | 'ephemeral';
  provider: string;              // "anthropic", "openai", etc
  model: string;                 // "claude-3-opus", "gpt-4", etc
  state: 'active' | 'suspended' | 'completed';
  currentTask?: string;          // Short description for UI
  currentTaskId?: string;        // Link to full task
  createdAt: Date;
  lastActiveAt: Date;
}
```

Tests:
- Type validation
- Session creation
- Agent metadata updates

**Commit**: "feat: define session and agent types"

**Task 1.2: Create SessionManager**

File: `src/sessions/session-manager.ts` (new)

```typescript
export class SessionManager {
  constructor(
    private threadManager: ThreadManager,
    private dbPath: string
  ) {}
  
  // Create new session
  createSession(name: string): Session
  
  // Load existing session
  loadSession(sessionId: string): Session | null
  
  // Add agent to session
  addAgent(
    sessionId: string, 
    agent: Omit<AgentMetadata, 'id' | 'createdAt' | 'lastActiveAt'>
  ): AgentMetadata
  
  // Update agent metadata
  updateAgent(agentId: string, updates: Partial<AgentMetadata>): void
  
  // Get active agent for session
  getActiveAgent(sessionId: string): AgentMetadata | null
  
  // Switch active agent
  setActiveAgent(sessionId: string, agentId: string): void
  
  // List agents (with filtering)
  listAgents(sessionId: string, filter?: {
    state?: AgentMetadata['state'];
    type?: AgentMetadata['type'];
  }): AgentMetadata[]
}
```

Implementation notes:
- Use parent thread as session container
- Store metadata in SQLite
- Reuse delegate thread ID pattern

Tests:
- Session CRUD operations
- Agent management
- Active agent switching
- Filtering

**Commit**: "feat: implement SessionManager"

### Phase 2: Agent Spawning

**Task 2.1: Create agent-spawn tool**

File: `src/tools/implementations/agent-spawn.ts` (new)

```typescript
export class AgentSpawnTool extends Tool {
  name = 'agent-spawn';
  description = 'Create a new agent in the current session';
  
  schema = z.object({
    name: z.string().min(1).describe('Agent name (e.g., "architect", "impl-1")'),
    provider: z.string().describe('AI provider (anthropic, openai, etc)'),
    model: z.string().describe('Model name (claude-3-opus, gpt-4, etc)'),
    type: z.enum(['persistent', 'ephemeral']).default('persistent'),
    systemPrompt: z.string().optional().describe('Custom system prompt'),
    task: z.string().optional().describe('Initial task description'),
  });
  
  async executeValidated(args: z.infer<typeof this.schema>): Promise<ToolResult> {
    // Implementation
  }
}
```

Implementation:
1. Get current session from context
2. Create delegate thread (reuse pattern)
3. Add agent metadata to session
4. Initialize agent with thread
5. Return agent info

Tests:
- Test agent creation
- Test duplicate names rejected
- Test invalid provider/model
- Test thread creation

**Commit**: "feat: add agent-spawn tool"

**Task 2.2: Create agent management tools**

File: `src/tools/implementations/agent-tools.ts` (new)

Tools to implement:
- `agent-list` - Show session agents
- `agent-switch` - Change active agent  
- `agent-suspend` - Suspend an agent
- `agent-resume` - Resume suspended agent

Each tool needs:
- Zod schema
- Implementation
- Tests

**Commit**: "feat: add agent management tools"

### Phase 3: Agent Factory

**Task 3.1: Create AgentFactory**

File: `src/agents/agent-factory.ts` (new)

```typescript
export class AgentFactory {
  constructor(
    private providerRegistry: ProviderRegistry,
    private toolExecutor: ToolExecutor,
    private threadManager: ThreadManager
  ) {}
  
  // Create agent from metadata
  async createAgent(metadata: AgentMetadata): Promise<Agent> {
    const provider = await this.createProvider(
      metadata.provider,
      metadata.model
    );
    
    return new Agent({
      provider,
      toolExecutor: this.createRestrictedExecutor(metadata),
      threadManager: this.threadManager,
      threadId: metadata.id,
      tools: this.getToolsForAgent(metadata),
    });
  }
  
  // Create provider with custom system prompt
  private async createProvider(
    providerName: string,
    modelName: string,
    systemPrompt?: string
  ): Promise<AIProvider>
  
  // Create tool executor that restricts certain tools
  private createRestrictedExecutor(
    metadata: AgentMetadata
  ): ToolExecutor
  
  // Get appropriate tools for agent type
  private getToolsForAgent(metadata: AgentMetadata): Tool[]
}
```

Notes:
- Ephemeral agents might get fewer tools
- No delegate tool for sub-agents (prevent recursion)
- Custom system prompts per role

Tests:
- Test agent creation
- Test tool restrictions
- Test provider configuration

**Commit**: "feat: implement AgentFactory"

### Phase 4: Context Passing

**Task 4.1: Add session context to tools**

File: `src/tools/types.ts`

Update ToolContext:
```typescript
export interface ToolContext {
  threadId?: string;
  sessionId?: string;      // NEW
  agentName?: string;      // NEW
  agentMetadata?: AgentMetadata;  // NEW
}
```

File: `src/agents/agent.ts`

Update tool execution to pass context:
```typescript
const context: ToolContext = {
  threadId: this.threadId,
  sessionId: this.sessionId,
  agentName: this.metadata?.name,
  agentMetadata: this.metadata,
};
```

Tests:
- Test context passed to tools
- Test tools can access session info

**Commit**: "feat: add session context to tool execution"

### Phase 5: Agent Lifecycle

**Task 5.1: Implement agent state transitions**

File: `src/sessions/session-manager.ts`

Add lifecycle methods:
```typescript
// Suspend agent (preserves thread)
suspendAgent(agentId: string): void

// Resume agent (reactivates)
resumeAgent(agentId: string): void

// Complete agent (ephemeral only)
completeAgent(agentId: string): void

// Archive old ephemeral agents
archiveCompletedAgents(sessionId: string, olderThan?: Date): number
```

State rules:
- Persistent agents: active ↔ suspended
- Ephemeral agents: active → completed (one way)
- Completed agents hidden from UI by default

Tests:
- Test state transitions
- Test invalid transitions rejected
- Test archiving

**Commit**: "feat: implement agent lifecycle management"

### Phase 6: Integration

**Task 6.1: Update CLI initialization**

File: `src/cli.ts`

Add session initialization:
```typescript
// Check for existing session
let session: Session;
if (options.session) {
  session = sessionManager.loadSession(options.session) 
    || sessionManager.createSession(options.session);
} else {
  session = sessionManager.createSession('default');
}

// Create or resume agent
let agent: Agent;
if (options.agent) {
  const metadata = session.agents.find(a => a.name === options.agent);
  if (metadata) {
    agent = await agentFactory.createAgent(metadata);
  } else {
    // Create new agent
  }
}
```

CLI arguments:
- `--session <name>` - Session to use
- `--agent <name>` - Agent to activate
- `--new-agent` - Force new agent

Tests:
- Test session creation/loading
- Test agent selection
- Test defaults

**Commit**: "feat: integrate sessions into CLI"

### Phase 7: Testing & Documentation

**Task 7.1: End-to-end tests**

File: `src/sessions/__tests__/multi-agent-e2e.test.ts`

Scenarios:
1. Create session with multiple agents
2. Switch between agents
3. Ephemeral agent lifecycle
4. Task assignment between agents

**Task 7.2: Documentation**

- Update CLI help text
- Add examples to README
- Document agent lifecycle

## Testing Strategy

### Unit Tests
- Session management operations
- Agent metadata CRUD
- State transitions
- Factory creation

### Integration Tests  
- Multi-agent session flow
- Agent switching preserves context
- Tool context propagation
- Lifecycle management

### Manual Testing
1. Create session with PM agent
2. PM spawns implementer
3. Switch between agents
4. Suspend/resume agents
5. Complete ephemeral agent

## Common Patterns

### Parent-Child Threads
```
session_thread (parent)
├── session_thread.1 (pm agent)
├── session_thread.2 (architect)
└── session_thread.3 (impl-1)
```

### Agent Naming
- Persistent: role-based ("pm", "architect", "reviewer")
- Ephemeral: numbered ("impl-1", "impl-2", "debug-1")

### Tool Restrictions
```typescript
// Ephemeral agents don't get:
- agent-spawn (prevent recursion)
- delegate (use agent-spawn instead)
- dangerous tools (configurable)
```

## Performance Considerations

- Lazy load agents (don't create until switched to)
- Cache agent instances
- Limit active agents (memory)
- Archive old ephemeral agents

## Error Handling

- Agent creation failures shouldn't break session
- Handle missing providers gracefully
- Validate model availability
- Log all lifecycle events

## Migration Path

1. Existing threads work as single-agent sessions
2. Delegate threads become ephemeral agents
3. No breaking changes to current flow
4. Progressive enhancement