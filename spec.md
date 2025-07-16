# Lace Multi-Project & Session Architecture Specification

## Overview

This specification outlines the architecture for extending Lace to support multiple projects, adding a project layer above the existing session/agent architecture. The current system already supports multiple concurrent sessions through the SessionService - this spec focuses on organizing those sessions into projects and adding richer configuration at each level.

## Current Architecture Understanding

### Existing Capabilities
- **Multiple Sessions**: SessionService already manages multiple concurrent Session instances
- **Session Reconstruction**: Sessions are runtime constructs built from persistent thread data
- **Thread Metadata**: Configuration stored as metadata on threads (provider, model, name)
- **Hierarchical Threads**: Thread IDs follow pattern `sessionId.agentNumber` for parent-child relationships

### What's Missing
- **Project Layer**: No way to group related sessions
- **Configuration Inheritance**: No project-level defaults for sessions to inherit
- **Rich Configuration**: Limited to provider/model, need more configuration options
- **Project Context**: Sessions exist globally without project scoping

## Core Concepts

### Projects (NEW)
Projects are the top-level organizational unit that group related work sessions together.

**Project Properties:**
- `id`: Unique identifier
- `name`: Human-readable project name
- `description`: Project description
- `working_directory`: Base directory for project operations
- `configuration`: JSON blob for project settings (validated with Zod)
- `is_archived`: Boolean flag for archived projects
- `created_at`: Timestamp of project creation
- `last_used_at`: Timestamp of last project access

**Project Configuration (stored as JSON):**
- Tool restrictions and blanket approvals
- Default provider/model for new sessions
- Token budget defaults
- Custom prompt templates
- Approval policies (auto-approve certain tools)
- Environment variables (future)
- Provider-specific API keys/tokens/URLs (future)
- Custom event hooks (future)

### Sessions (ENHANCED)
Sessions are already implemented as parent threads that contain agents. We need to enhance them with project association and richer configuration.

**Current Session Properties (in thread metadata):**
- `isSession`: true
- `name`: Session name
- `provider`: AI provider
- `model`: AI model

**Additional Session Properties:**
- `project_id`: Foreign key to parent project (stored in threads table)
- `description`: Defaults to first user message, can be auto-summarized
- `working_directory_override`: Optional override for git worktrees or temp directories
- `configuration`: Session-specific configuration overrides (JSON blob)

**Session Configuration (stored as JSON in thread metadata):**
- Provider/model overrides (existing)
- Token budget configuration
- Task management settings
- Agent spawning policies
- Session-specific tool configurations
- Custom instructions

**Key Behaviors:**
- Sessions inherit project's configuration as defaults
- Can override any project-level setting
- Working directory inheritance with override capability
- Agents within a session cannot change the working directory

### Agents/Threads (ENHANCED)
Agents are implemented as child threads of sessions. The thread model needs minor enhancements for better metadata.

**Current Agent Properties (in thread metadata):**
- `isAgent`: true (implied by non-session thread)
- `name`: Agent name
- `parentSessionId`: Parent session reference

**Additional Agent Properties:**
- `description`: Agent purpose/role
- `configuration`: Agent-specific configuration (JSON blob)

**Agent Configuration (stored as JSON in thread metadata):**
- Provider/model override
- Agent-specific instructions
- Tool restrictions
- Token limits
- Current task assignment

## Backend Architecture Changes

### Core Session Class Modifications

The `Session` class (src/sessions/session.ts) needs enhancement to support project context:

**Current Architecture:**
- Session wraps a coordinator agent and manages delegate agents
- Sessions are reconstructed from thread data
- Configuration stored in thread metadata

**Required Changes:**
1. **Project Context**: Session.create() needs to accept projectId and inherit project configuration
2. **Configuration Inheritance**: Sessions need to merge project defaults with session-specific overrides
3. **Working Directory**: Session needs to resolve working directory (project default or session override)
4. **Provider/Model Selection**: Support configuration hierarchy (project → session → agent)

### SessionService Modifications

The SessionService doesn't need major changes - it already supports multiple sessions:
- Keep the singleton pattern for service management
- Add project context to session creation
- Filter sessions by project in listing operations

### Thread Management Integration

ThreadManager needs minimal changes:
- Add project_id to thread creation
- Support filtering threads by project
- Maintain existing hierarchical thread ID system

## Database Schema Changes

### New Tables

```sql
-- Projects table
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    working_directory TEXT NOT NULL,
    configuration TEXT, -- JSON blob
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Update threads table to add project association and richer metadata
ALTER TABLE threads ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE threads ADD COLUMN working_directory_override TEXT;
```

### Configuration Storage

Thread metadata will be extended to store richer configuration as JSON:
- Session threads: Store session configuration blob
- Agent threads: Store agent configuration blob
- Existing fields (name, provider, model) remain for backward compatibility

### Migration Strategy

1. Create a "Historical" project to house all existing sessions
2. Update existing session threads to reference the Historical project
3. Existing thread metadata remains intact
4. New configuration fields default to empty JSON objects

## Configuration Hierarchy

### Configuration Resolution Order
1. Agent-level configuration (highest priority)
2. Session-level configuration
3. Project-level configuration
4. System defaults (lowest priority)

### Project Configuration Schema
```typescript
interface ProjectConfig {
  // Provider defaults
  defaultProvider?: string;
  defaultModel?: string;
  
  // Tool policies
  toolPolicies?: {
    disabled?: string[];           // Tools to disable
    autoApprove?: string[];        // Tools to auto-approve
    requireApproval?: string[];    // Tools requiring approval
  };
  
  // Token management
  tokenBudget?: {
    maxTokensPerRequest?: number;
    maxTokensPerSession?: number;
    warningThreshold?: number;
  };
  
  // Prompt customization
  promptTemplates?: {
    systemPrompt?: string;
    userInstructions?: string;
  };
  
  // Future extensions
  environment?: Record<string, string>;
  hooks?: Record<string, string>;
  providerConfigs?: Record<string, unknown>;
}
```

### Session Configuration Schema
```typescript
interface SessionConfig {
  // Basic settings
  name: string;
  description?: string;
  workingDirectoryOverride?: string;
  
  // Provider overrides
  provider?: string;
  model?: string;
  
  // Session-specific overrides
  toolPolicies?: ProjectConfig['toolPolicies'];
  tokenBudget?: ProjectConfig['tokenBudget'];
  promptTemplates?: ProjectConfig['promptTemplates'];
  
  // Task management
  taskSettings?: {
    autoCreateTasks?: boolean;
    taskCategories?: string[];
  };
  
  // Agent spawning
  agentDefaults?: {
    maxAgents?: number;
    defaultAgentProvider?: string;
    defaultAgentModel?: string;
  };
}
```

### Agent Configuration Schema
```typescript
interface AgentConfig {
  // Basic metadata
  name: string;
  description?: string;
  
  // Provider override
  provider?: string;
  model?: string;
  
  // Agent-specific settings
  instructions?: string;
  toolRestrictions?: string[];
  tokenLimit?: number;
  temperature?: number;
  
  // Task assignment
  assignedTasks?: string[];
  capabilities?: string[];
}
```

## Architecture Considerations

### Single-User Design
- No authentication required for v1
- Local web UI access only
- Design with future multi-user support in mind
- Project isolation at the data layer

### Concurrency Handling
- Use SQLite transactions for atomic configuration updates
- Better-sqlite3's transaction support for read-modify-write
- Configuration loaded into memory for performance

### Working Directory Management
- Projects define base working directory
- Sessions can override with worktree or temp directory
- Resolution order: session override → project default
- Agents cannot change working directory during execution
- Working directory passed as context to tools

### Provider Management
- Provider selection hierarchy: agent → session → project
- Each level can override the provider/model
- Provider registry remains unchanged
- Configuration merged at runtime

## Web UI Changes

### Navigation
- Hierarchical sidebar: Projects → Sessions → Agents
- Project dropdown/selector at top
- Sessions grouped under projects
- Active/archived filtering at each level
- Project settings accessible from UI

### Project Management
- Create/edit/archive projects
- Configure project defaults
- Set working directory
- Manage tool policies

### Session Management  
- Create sessions within selected project
- Sessions inherit project configuration
- Override project defaults as needed
- Session-specific task management

### Agent Management
- View agent configuration
- See inherited vs overridden settings
- Monitor agent-specific metrics

## API Changes

### Existing Endpoints (Current State)
```typescript
// Sessions
GET    /api/sessions                    // List all sessions
POST   /api/sessions                    // Create session (name only)
GET    /api/sessions/:id                // Get session info

// Agents  
POST   /api/sessions/:id/agents         // Spawn agent (name, provider, model)

// Tasks (shows update pattern)
PATCH  /api/tasks/:id                   // Update task - good pattern to follow
```

### Missing Endpoints (Need to Add)
```typescript
// Session updates (to be moved under projects)
PATCH  /api/projects/:projectId/sessions/:sessionId                // Update session
PUT    /api/projects/:projectId/sessions/:sessionId/config         // Update session configuration

// Agent updates  
PATCH  /api/projects/:projectId/sessions/:sessionId/agents/:agentId         // Update agent
PUT    /api/projects/:projectId/sessions/:sessionId/agents/:agentId/config  // Update agent configuration
```

### New Endpoints for Projects
```typescript
// Project management
GET    /api/projects                    // List all projects
POST   /api/projects                    // Create new project
GET    /api/projects/:id                // Get project details
PATCH  /api/projects/:id                // Update project metadata
DELETE /api/projects/:id                // Archive project
PUT    /api/projects/:id/config         // Update project configuration

// Session management (nested under projects)
GET    /api/projects/:projectId/sessions                          // List project sessions
POST   /api/projects/:projectId/sessions                          // Create session in project
GET    /api/projects/:projectId/sessions/:sessionId               // Get session details
DELETE /api/projects/:projectId/sessions/:sessionId               // Archive session

// Agent management (nested under project/session)
GET    /api/projects/:projectId/sessions/:sessionId/agents        // List session agents
POST   /api/projects/:projectId/sessions/:sessionId/agents        // Create agent in session
GET    /api/projects/:projectId/sessions/:sessionId/agents/:agentId  // Get agent details
DELETE /api/projects/:projectId/sessions/:sessionId/agents/:agentId  // Remove agent
```


### Implementation Notes
- Core already has `updateThreadMetadata()` method - just needs API exposure
- Follow task update pattern with Zod schemas for validation
- Session/agent updates should use the existing thread metadata system
- Configuration stored as JSON in thread metadata

## Implementation Priorities

### Phase 1 (MVP)
1. Add projects table and update schema
2. Implement project CRUD operations
3. Update session creation to require project
4. Migrate existing data to Historical project
5. Update web UI with project navigation

### Phase 2
1. Implement project configuration system
2. Add tool restrictions/approvals at project level
3. Support working directory overrides
4. Add project/session archiving

### Phase 3 (Future)
1. Multi-user support
2. Per-project API keys
3. Custom event hooks
4. Advanced project templates

## Design Principles

- **YAGNI**: Start simple, extend as needed
- **Backward Compatible**: Existing data migrates cleanly
- **Future-Proof**: Architecture supports multi-user extension
- **Type-Safe**: Zod validation for all configurations
- **Transaction-Safe**: Atomic updates prevent data conflicts