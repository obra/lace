# Types and Validation Architecture

This document describes the type system architecture and validation patterns used throughout Lace, focusing on the clean separation between core types, web-specific types, and validation schemas.

## Design Principles

### Single Source of Truth
Each type is defined exactly once in the core (`src/`) and imported elsewhere. No duplication, shadowing, or redefinition is permitted anywhere in the codebase.

### Import Boundaries
Clear separation between different layers of the application:
- **Core types**: Shared business logic types, safe for both client and server
- **Web types**: Web-specific API contracts and UI models  
- **Server classes**: Business logic implementations, restricted to API routes
- **Validation schemas**: Runtime validation, separate from type definitions

### Type Safety Over Convenience
Strict TypeScript with branded types, discriminated unions, and comprehensive type guards. Never use `any` - prefer `unknown` with proper type narrowing.

## Type Organization

### Core Types (`@/lib/core`)
**Location**: `packages/web/lib/core.ts`  
**Purpose**: Re-exports all shared types from `src/` for use throughout the web package

**Exports**:
```typescript
// Thread and event system
export type { ThreadId, AssigneeId, EventType, ThreadEvent, Thread } from '~/threads/types';
export type { CompactionData } from '~/threads/compaction/types';

// Tool system
export type { ToolCall, ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
export { ApprovalDecision } from '~/tools/types';

// Task management
export type { Task, TaskNote, TaskStatus, TaskPriority } from '~/tasks/types';

// Agent and provider system
export type { AgentState } from '~/agents/agent';
export type { ProviderInfo, ModelInfo } from '~/providers/base-provider';

// Project management
export type { ProjectInfo } from '~/projects/project';

// Utility functions
export { asThreadId, createThreadId, isThreadId, EVENT_TYPES } from '~/threads/types';
```

**Usage**: Import for any type that exists in the core business logic
```typescript
import type { ThreadId, Task, ToolResult } from '@/lib/core';
```

### Web-Specific Types (`@/types/web`) 
**Location**: `packages/web/types/web.ts`  
**Purpose**: Types unique to the web interface - API contracts, UI models, request/response shapes

**Key Types**:
```typescript
// API Models
export interface Session {
  id: ThreadId;
  name: string;
  createdAt: string;
  agentCount?: number;
  agents?: Agent[];
}

export interface Agent {
  threadId: ThreadId;
  name: string;
  provider: string;
  model: string;
  status: AgentState;
  createdAt: string;
}

// Request/Response Types (inferred from Zod schemas)
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

// Tool Approval Flow
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input: unknown;
  isReadOnly: boolean;
  riskLevel: 'safe' | 'moderate' | 'destructive';
}

export interface PendingApproval {
  toolCallId: string;
  toolCall: { name: string; arguments: unknown };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
}

// Generic API Response Wrapper
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
```

**Usage**: Import for web-specific models and API contracts
```typescript
import type { Session, Agent, MessageRequest } from '@/types/web';
```

### Event Types (`@/types/events`)
**Location**: `packages/web/types/events.ts`  
**Purpose**: All event-related types consolidated in one place

**Event Classification**:
```typescript
// Persisted events (stored in database)
export { EVENT_TYPES, type EventType } from '@/lib/core';

// UI-only events (ephemeral, not persisted) 
export const UI_EVENT_TYPES = [
  'TOOL_APPROVAL_REQUEST',
  'AGENT_TOKEN', 
  'AGENT_STREAMING',
] as const;

// Combined type for SSE streaming
export type SessionEventType = EventType | UIEventType;
```

**Discriminated Union Pattern**:
```typescript
export type SessionEvent =
  | { type: 'USER_MESSAGE'; threadId: ThreadId; timestamp: Date; data: UserMessageEventData }
  | { type: 'AGENT_MESSAGE'; threadId: ThreadId; timestamp: Date; data: AgentMessageEventData }
  | { type: 'TOOL_CALL'; threadId: ThreadId; timestamp: Date; data: ToolCallEventData }
  | { type: 'AGENT_TOKEN'; threadId: ThreadId; timestamp: Date; data: { token: string } };
```

**Usage**: Import for all event handling
```typescript
import type { SessionEvent, SessionEventType } from '@/types/events';
import { getAllEventTypes, isPersistedEvent } from '@/types/events';
```

### Server-Only Classes (`@/lib/server/lace-imports`)
**Location**: `packages/web/lib/server/lace-imports.ts`  
**Purpose**: Business logic class imports, restricted to API routes and server components

**Exports**:
```typescript
// Business logic classes
export { Agent, type AgentEvents } from '~/agents/agent';
export { ThreadManager } from '~/threads/thread-manager';
export { ToolExecutor } from '~/tools/executor';
export { Session } from '~/sessions/session';
export { Project } from '~/projects/project';
```

**Restriction**: These imports are marked with `'server-only'` and must never be used in client components or hooks.

## Branded Types

### ThreadId
**Purpose**: Type-safe thread identification with runtime validation
```typescript
export type ThreadId = string & { readonly __brand: 'ThreadId' };

// Type guard
export function isThreadId(value: string): value is ThreadId {
  return /^lace_\d{8}_[a-z0-9]{6}(\.\d+)*$/.test(value);
}

// Safe constructor
export function asThreadId(value: string): ThreadId {
  if (!isThreadId(value)) {
    throw new Error(`Invalid thread ID format: ${value}`);
  }
  return value as ThreadId;
}
```

**Pattern**: `lace_YYYYMMDD_randomId` with optional `.N` suffix for delegate threads
- Session: `lace_20250731_abc123`
- Agent: `lace_20250731_abc123.1`

### AssigneeId  
**Purpose**: Union type for task assignment targets
```typescript
export type AssigneeId = ThreadId | NewAgentSpec | 'human';

export function isAssigneeId(value: string): value is AssigneeId {
  return isThreadId(value) || isNewAgentSpec(value) || value === 'human';
}
```

## Validation Architecture

### Schema Location
**File**: `packages/web/lib/validation/schemas.ts`  
**Purpose**: Zod schemas for runtime validation only - does not export domain types

### Type Location  
**File**: `packages/web/types/web.ts`  
**Purpose**: TypeScript types inferred from schemas, used throughout application

### Pattern
```typescript
// In schemas.ts - validation only
export const MessageRequestSchema = z.object({
  message: z.string().min(1).max(10000),
  metadata: z.object({
    source: z.enum(['web', 'cli', 'api']).optional(),
  }).optional(),
});

// In web.ts - type definition  
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
```

### Key Schemas
```typescript
// Thread validation using core functions
export const ThreadIdSchema = z
  .string()
  .refine(isValidThreadId, 'Invalid thread ID format')
  .transform(asValidThreadId);

// API request validation
export const MessageRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(10000),
});

export const CreateTaskRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  prompt: z.string().min(1).max(5000),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  assignedTo: ThreadIdSchema.optional(),
});
```

## Import Conventions

### ✅ Correct Patterns

**Core Types** (shared business logic):
```typescript
import type { ThreadId, Task, ToolResult, ApprovalDecision } from '@/lib/core';
import { isThreadId, asThreadId, EVENT_TYPES } from '@/lib/core';
```

**Web Types** (API contracts, UI models):
```typescript
import type { Session, Agent, MessageRequest, ToolApprovalRequestData } from '@/types/web';
import { isApiError, isApiSuccess } from '@/types/web';
```

**Event Types** (streaming, UI updates):
```typescript
import type { SessionEvent, SessionEventType } from '@/types/events';
import { getAllEventTypes, isPersistedEvent } from '@/types/events';
```

**Server Classes** (API routes only):
```typescript
import { Agent, ThreadManager, Session } from '@/lib/server/lace-imports';
```

**Validation** (runtime checking):
```typescript
import { MessageRequestSchema, ThreadIdSchema } from '@/lib/validation/schemas';
```

### ❌ Forbidden Patterns

**Multiple import paths for same type**:
```typescript
// Don't do this - creates confusion and potential conflicts
import { ThreadId } from '@/lib/server/core-types'; // OLD PATH
import { ThreadId } from '@/types/api'; // OLD PATH  
import { ThreadId } from '@/lib/core-types-import'; // OLD PATH
```

**Business logic in client components**:
```typescript
// Don't do this - violates server-only boundary
import { Agent, ThreadManager } from '@/lib/server/lace-imports'; // Server-only!
```

**Type duplication**:
```typescript
// Don't do this - creates shadowing
export const ApprovalDecision = { ALLOW_ONCE: 'allow_once' }; // Use core import instead
export type ThreadId = z.infer<typeof ThreadIdSchema>; // Use branded type instead
```

**Domain types from validation files**:
```typescript
// Don't do this - schemas are for validation, not type definitions  
import type { MessageRequest } from '@/lib/validation/schemas'; // Use @/types/web instead
```

## File Organization

```
packages/web/
├── lib/
│   ├── core.ts                 # All core type re-exports
│   ├── server/
│   │   └── lace-imports.ts     # Server-only business logic classes
│   └── validation/
│       └── schemas.ts          # Zod schemas (no type exports)
├── types/
│   ├── web.ts                  # Web-specific types and API contracts  
│   ├── events.ts               # All event types consolidated
│   ├── design-system.ts        # UI component types (unchanged)
│   └── index.ts                # Main types barrel export
└── components/                 # Use type imports only, never classes
    hooks/                      # Use type imports only, never classes  
    app/api/                    # Can import server classes
```

## Runtime Type Safety

### Type Guards
Always provide runtime validation for external data:
```typescript
export function isApiError(response: unknown): response is ApiErrorResponse {
  return typeof response === 'object' && response !== null && 'error' in response;
}

export function isSessionEvent(event: unknown): event is SessionEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    'threadId' in event &&
    'timestamp' in event
  );
}
```

### Schema Validation
Use Zod schemas at API boundaries:
```typescript
// API route validation
export async function POST(request: Request) {
  const body = await request.json();
  const validatedData = MessageRequestSchema.parse(body); // Throws on invalid data
  // validatedData is now typed as MessageRequest
}
```

### Error Handling
Structured error types, never plain strings:
```typescript
export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public receivedValue: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

## Testing Patterns

### Type Testing
Verify types work correctly without runtime tests:
```typescript
// This test will fail to compile if types are wrong
describe('Type Safety', () => {
  it('should enforce ThreadId branding', () => {
    const threadId: ThreadId = asThreadId('lace_20250731_test123');
    const regularString: string = threadId; // ✅ OK - ThreadId is assignable to string
    const backToThreadId: ThreadId = regularString; // ❌ Compilation error - good!
  });
});
```

### Integration Testing
Test the full type flow from schema to usage:
```typescript
describe('Message API', () => {
  it('should validate and type message requests correctly', () => {
    const validRequest = { message: 'Hello world' };
    const parsed = MessageRequestSchema.parse(validRequest);
    
    // parsed is now typed as MessageRequest
    expect(parsed.message).toBe('Hello world');
    expect(parsed.message.length).toBeGreaterThan(0); // TypeScript knows it's a string
  });
});
```

## Migration Notes

This architecture represents the cleaned-up end state after eliminating:
- Type shadowing (ApprovalDecision, ThreadId redefinitions)
- Circuitous import paths (4 different ways to import ThreadId)  
- Mixed concerns (API types scattered across files)
- Validation/type confusion (domain types exported from schema files)
- Client/server boundary violations (business logic in components)

The result is a clear, maintainable type system with single sources of truth and proper separation of concerns.