# CODE-MAP: Actual File Structure and Key Locations

## 🎯 Quick Reference

| What You Need | Actual Location | Key Files |
|--------------|----------------|-----------|
| Main agent engine | `src/agents/` | `agent.ts` (1000+ lines) |
| Tool implementations | `src/tools/implementations/` | `bash.ts`, `file-*.ts`, `delegate.ts` |
| Event types | `src/threads/` | `types.ts` (all LaceEvent types) |
| Database operations | `src/persistence/` | `database.ts` (SQLite wrapper) |
| AI providers | `src/providers/` | `base-provider.ts`, individual providers |
| Session management | `src/sessions/` | `session.ts` (creates agents) |
| Web API routes | `packages/web/app/api/` | `*/route.ts` files |
| Token management | `src/token-management/` | Token counting and limits |

## 📂 Actual Source Structure (`src/`)

```
src/
├── agents/
│   ├── agent.ts                    # Main Agent class (state machine, event emitter)
│   ├── types.ts                     # Agent-specific types
│   └── agent.test.ts                # Agent tests
│
├── threads/
│   ├── thread-manager.ts            # Thread operations, event management
│   ├── types.ts                     # LaceEvent types and helpers
│   ├── token-aggregation.ts         # Token counting for events
│   └── compaction/                  # Compaction strategies
│       └── types.ts                 # Compaction interfaces
│
├── tools/
│   ├── tool.ts                      # Base Tool class (all tools extend this)
│   ├── executor.ts                  # ToolExecutor class
│   ├── types.ts                     # ToolCall, ToolResult types
│   ├── approval-types.ts            # Approval flow types
│   ├── schemas/
│   │   └── common.ts                # Shared Zod schemas (FilePath, etc.)
│   └── implementations/
│       ├── bash.ts                  # Execute shell commands
│       ├── file-read.ts             # Read files with line ranges
│       ├── file-write.ts            # Write files
│       ├── file-edit.ts             # Edit specific lines
│       ├── file-insert.ts           # Insert at line number
│       ├── file-list.ts             # List directory contents
│       ├── file-find.ts             # Find files by pattern
│       ├── ripgrep-search.ts        # Search file contents
│       ├── url-fetch.ts             # Fetch URLs
│       ├── delegate.ts              # Spawn sub-agents
│       └── task-manager/            # Task management tools
│           ├── types.ts             # Task, TaskNote types
│           └── (multiple tools)     # Task CRUD operations
│
├── providers/
│   ├── base-provider.ts             # Abstract AIProvider class
│   ├── registry.ts                  # ProviderRegistry for discovery
│   ├── instance/
│   │   └── manager.ts               # ProviderInstanceManager
│   └── (individual providers)       # Anthropic, OpenAI, etc.
│
├── persistence/
│   ├── database.ts                  # SQLite operations, schema
│   └── sql-profiler.ts              # SQL query profiling
│
├── sessions/
│   ├── session.ts                   # Session class (manages agents)
│   ├── session-config.ts            # Configuration types
│   └── session.test.ts              # Session tests
│
├── token-management/
│   ├── types.ts                     # Token usage types
│   ├── stop-reason-handler.ts       # Handle completion reasons
│   └── token-counter.ts             # Token estimation
│
├── tasks/
│   ├── task-manager.ts              # TaskManager class
│   ├── types.ts                     # Task types
│   └── task-status.ts               # Task status enum
│
├── projects/
│   ├── project.ts                   # Project class
│   └── types.ts                     # Project types
│
├── utils/
│   ├── logger.ts                    # Logging utility
│   ├── token-estimation.ts          # Estimate token counts
│   └── test-utils.ts                # Test helpers
│
├── config/
│   ├── prompts.ts                   # Prompt configuration
│   ├── env-loader.ts                # Environment variables
│   └── lace-dir.ts                  # LACE_DIR path handling
│
├── interfaces/
│   └── terminal/                    # CLI interface (if running CLI)
│       └── terminal-interface.ts    # Terminal UI
│
└── types/
    └── (various type files)         # Shared types
```

## 🌐 Web Package Structure (`packages/web/`)

```
packages/web/
├── app/                             # Next.js App Router
│   ├── layout.tsx                   # Root layout
│   ├── page.tsx                     # Home page
│   ├── globals.css                  # Global styles (⚠️ has @plugin "daisyui")
│   └── api/                         # API routes
│       ├── events/
│       │   └── stream/
│       │       └── route.ts         # SSE event streaming
│       ├── agents/
│       │   └── [agentId]/
│       │       ├── route.ts         # Agent operations
│       │       ├── message/
│       │       │   └── route.ts     # Send message to agent
│       │       ├── history/
│       │       │   └── route.ts     # Get agent history
│       │       └── stop/
│       │           └── route.ts     # Stop agent
│       ├── threads/
│       │   └── [threadId]/
│       │       ├── message/
│       │       │   └── route.ts     # Thread messages
│       │       └── approvals/
│       │           └── [toolCallId]/
│       │               └── route.ts # Tool approvals
│       ├── sessions/
│       │   └── [sessionId]/
│       │       ├── route.ts         # Session operations
│       │       ├── agents/
│       │       │   └── route.ts     # Session agents
│       │       └── configuration/
│       │           └── route.ts     # Session config
│       ├── projects/
│       │   ├── route.ts             # Project CRUD
│       │   └── [projectId]/
│       │       ├── route.ts         # Single project
│       │       └── sessions/
│       │           └── route.ts     # Project sessions
│       └── provider/
│           ├── catalog/
│           │   └── route.ts         # Provider catalog
│           └── instances/
│               └── route.ts         # Provider instances
│
├── components/                      # React components
│   └── (UI components)              # Various UI components
│
├── hooks/                           # React hooks
│   └── (custom hooks)               # useSession, etc.
│
└── lib/                             # Libraries and utilities
    ├── client/                      # Client-side code
    └── server/                      # Server-side code
```

## 🔍 Key Files to Understand

### Core Engine
- `src/agents/agent.ts` - The heart of the system. State machine, event emission, message processing.
- `src/threads/types.ts` - All event types and helpers (isTransientEventType, etc.)
- `src/persistence/database.ts` - Database schema and operations

### Tools
- `src/tools/tool.ts` - Base class all tools extend
- `src/tools/executor.ts` - Handles tool execution and approval
- `src/tools/implementations/*.ts` - Individual tool implementations

### Sessions and Configuration
- `src/sessions/session.ts` - Creates and manages agents
- Look for `Session.initializeTools()` method (lines 845-867) to see tool registration

### Web API
- `packages/web/app/api/agents/[agentId]/message/route.ts` - How messages are sent
- `packages/web/app/api/events/stream/route.ts` - SSE streaming

## 📍 Import Patterns

```typescript
// Internal imports use ~/
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { getPersistence } from '~/persistence/database';
import type { LaceEvent, ThreadId } from '~/threads/types';

// Web package uses @/
import { Component } from '@/components/component';
import { useHook } from '@/hooks/hook';
```

## 🏃 Navigation Tips

```bash
# Key directories
cd src/agents           # Agent system
cd src/tools/implementations  # All tools
cd src/threads         # Event management
cd src/persistence     # Database

# Find test files
find . -name "*.test.ts" -o -name "*.test.tsx"

# Find API routes
find packages/web/app/api -name "route.ts"

# Search for a type
grep -r "LaceEvent" src/

# Find where tools are registered
grep -r "new.*Tool()" src/sessions/
```

## 🔧 Configuration Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript config, path aliases (~/) |
| `vitest.config.ts` | Test configuration |
| `packages/web/next.config.js` | Next.js configuration |
| `.env` | Environment variables |
| `CLAUDE.md` | AI agent instructions |

## 🚀 Entry Points

- **CLI**: `src/index.ts` → `src/interfaces/terminal/terminal-interface.ts`
- **Web**: `packages/web/app/page.tsx`
- **Tests**: `npm test` runs vitest

## 📝 Where to Add New Things

| Adding | Location | Notes |
|--------|----------|-------|
| New tool | `src/tools/implementations/` | Extend Tool class, use Zod schema |
| Tool registration | `src/sessions/session.ts` | In `initializeTools()` method |
| New event type | `src/threads/types.ts` | Add to EVENT_TYPES array |
| API endpoint | `packages/web/app/api/` | Create route.ts |
| Database table | `src/persistence/database.ts` | Update schema in `initializeSchema()` |

## ⚠️ Critical Files

These files are central to the system - be very careful when modifying:

1. `src/agents/agent.ts` - Complex state machine
2. `src/threads/types.ts` - Event type definitions
3. `src/persistence/database.ts` - Database schema
4. `packages/web/app/globals.css` - Contains critical @plugin "daisyui" line

## 🔑 Key Patterns

- **Tools extend Tool class** - Never create tools from scratch
- **Events are LaceEvent type** - Discriminated union by type field
- **Tests use .test.ts suffix** - Co-located with source
- **API routes are route.ts** - Next.js App Router convention
- **Zod for validation** - All tools use Zod schemas