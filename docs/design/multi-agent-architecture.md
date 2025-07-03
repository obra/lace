# Multi-Agent Architecture Specification

## Overview

This specification describes a multi-agent architecture for Lace that enables multiple AI agents to collaborate on complex tasks through a shared task queue, without requiring direct agent-to-agent communication.

## Core Concepts

### Sessions
A **session** is a container for related agents working together on a project. Technically implemented as a parent thread that contains child threads (agents).

### Agents
An **agent** is an AI instance working within a session. Agents can be:
- **Persistent**: Long-lived agents that maintain context across the session (PM, architect, reviewer)
- **Ephemeral**: Task-scoped agents with fresh context, spawned for specific tasks

### Agent Identification
Agents are identified by:
- A human-readable name (e.g., "pm", "architect", "impl-1")
- A thread ID (following the existing delegate pattern: `parent.1`, `parent.2`)

## Architecture

### Thread Structure
```
Session Thread: lace_20250703_abc123 (parent, contains metadata)
├── lace_20250703_abc123.1 (pm agent)
├── lace_20250703_abc123.2 (architect agent)
├── lace_20250703_abc123.3 (impl-1 agent)
└── lace_20250703_abc123.4 (impl-2 agent)
```

### Task Management

Enhanced task structure:
```typescript
interface Task {
  id: string;
  title: string;
  description: string;      // Human-readable summary for task list
  prompt: string;          // Detailed instructions for assigned agent
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: string;     // Agent name or "new:provider/model"
  createdBy?: string;      // Agent that created the task
  notes?: Array<{
    author: string;        // Agent name
    timestamp: Date;
    content: string;
  }>;
}
```

### Agent Spawning

Agents can be spawned in two ways:

1. **Explicit spawning**: User or PM creates an agent
   ```
   agent-spawn { name: "architect", provider: "anthropic", model: "claude-3-opus" }
   ```

2. **Task-based spawning**: Agent created when task assigned
   ```
   task-create { 
     title: "Implement OAuth",
     assignedTo: "new:anthropic/claude-3-sonnet"
   }
   ```

## Communication Model

### Task-Based Communication
Agents communicate through the shared task queue:
1. No direct agent-to-agent messaging
2. Agents read tasks assigned to them
3. Agents update task status and add notes
4. Other agents see updates through task notes

### Notification System
Agents receive notifications via the user message channel, but clearly marked as system-generated:

**Task Assignment:**
```
[LACE TASK SYSTEM] You have been assigned a new task:
Title: "Implement OAuth login flow"
Created by: pm
Priority: high

--- TASK DETAILS ---
[Full task prompt here]
--- END TASK DETAILS ---
```

**Task Completion:**
```
[LACE TASK SYSTEM] Task completed notification:
Task: "Implement OAuth login flow" 
Assigned to: impl-23
Status: COMPLETED

Recent notes from impl-23:
- Successfully implemented Google OAuth
- Added refresh token handling
- All tests passing
```

These messages are sent with role="user" at the API level but the `[LACE TASK SYSTEM]` prefix makes it clear they're automated notifications, not human input.

### Message Queueing
To handle notifications while agents are busy, implement message queueing:

```typescript
interface QueuedMessage {
  type: 'user' | 'system' | 'task_notification';
  content: string;
  metadata?: {
    taskId?: string;
    fromAgent?: string;
    priority?: 'normal' | 'high';
  };
}

interface Agent {
  messageQueue: QueuedMessage[];
  
  // Queue message if busy, process if idle
  queueMessage(message: QueuedMessage): void;
  
  // Process queued messages when returning to idle
  processQueuedMessages(): void;
}
```

Benefits:
- PM can queue completion notifications without blocking
- Users can queue messages to busy agents  
- System can queue important notifications
- Maintains conversation coherence

## Thread Versioning for Compaction

To handle context window limits, we use shadow threads:

```typescript
interface ThreadVersion {
  canonicalId: string;      // Original thread ID (stable external reference)
  currentVersion: string;   // Active working thread ID
  versions: Array<{
    id: string;
    created: Date;
    reason: string;         // "original", "optimized", etc.
  }>;
}
```

Benefits:
- Thread IDs remain stable for external references
- Compaction strategies can evolve independently
- Original history preserved for audit
- Clean runtime implementation

## User Interface

### Terminal UI
Status bar showing active agents:
```
[pm*] [architect] [impl-1:◐] [impl-2:✓] [+New]  Tasks: 3◐ 2✓ 1✗
```

Key bindings:
- `Ctrl+A, 1-9`: Switch to agent by number
- `Ctrl+A, n/p`: Next/previous agent
- `Ctrl+A, c`: Create new agent
- `Ctrl+A, d`: Show task dashboard

### Task Dashboard
Shows all tasks across agents with status, assignment, and progress.

## Implementation Plan

### Phase 1: Core Infrastructure
1. Extend ThreadManager to support session concept (parent thread)
2. Add agent metadata to threads (name, provider, model, currentTask)
3. Implement thread versioning for compaction
4. Add message queueing to Agent class

### Phase 2: Task System
1. Enhance task-manager tool:
   - Add `prompt` field separate from description
   - Add `assignedTo` field
   - Add timestamped notes with author
   - Support filtering by assigned agent
2. Add new tools:
   - `agent-spawn`: Create new agent
   - `agent-switch`: Change active agent
   - `agent-list`: Show session agents

### Phase 3: UI Implementation
1. Terminal UI:
   - Status bar with agent tabs
   - Keyboard shortcuts for switching
   - Task dashboard view
2. Web/API UI (future):
   - Similar agent switching capability
   - Real-time updates across agents

## Example Workflow

1. User starts new session for "OAuth Implementation"
2. Spawns PM agent (Haiku) to coordinate
3. PM creates tasks:
   - "Design OAuth architecture" → architect (Opus)
   - "Implement Google OAuth" → new:anthropic/claude-3-sonnet
   - "Add OAuth tests" → new:openai/gpt-4
4. Agents work independently:
   - Read their assigned tasks
   - Update status and add notes
   - PM monitors progress
5. User switches between agents to check progress
6. When impl gets stuck, adds note to task
7. Architect sees note, provides guidance

## Benefits

- **No complex messaging**: Simple task-based coordination
- **Context isolation**: Ephemeral agents avoid context bloat
- **Cost efficiency**: PM uses cheap model, specialists spawned as needed
- **Flexible compaction**: Thread versioning allows strategy evolution
- **UI agnostic**: Core works for terminal, web, and API interfaces
- **Message queueing**: Agents can receive notifications without blocking
- **Clean agent lifecycle**: Ephemeral agents auto-hide when tasks complete

## Future Considerations

- Event bus for agent notifications (if needed)
- Direct agent messaging (if use cases emerge)
- Automated escalation rules in PM
- Agent templates for common roles