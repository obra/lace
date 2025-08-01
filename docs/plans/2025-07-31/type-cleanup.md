# Type Organization Cleanup Implementation Plan

**Date**: 2025-07-31  
**Status**: Ready for Implementation  
**Estimated Time**: 3-5 days  
**Risk Level**: Medium (touches many files, but mostly type-only changes)

## Overview

This plan addresses the chaotic type organization in `packages/web/` where types are duplicated, shadowed, and imported through multiple circuitous paths. The core `src/` types are well-organized, but the web package has created a maze of redundant type definitions and confusing import strategies.

## Problem Summary

- **Type Shadowing**: `ApprovalDecision` and `ThreadId` redefined in web package
- **Import Confusion**: 4 different ways to import the same core types
- **Duplicated Logic**: Thread validation logic copied instead of imported
- **File Proliferation**: Multiple import files with overlapping purposes
- **Mixed Concerns**: API, UI, and event types scattered across files

## Success Criteria

- Single source of truth for all types
- Clear, consistent import paths throughout web package
- Zero type shadowing or duplication
- All tests passing
- TypeScript compilation successful with strict mode
- Proper separation of client-safe vs server-only types

## Prerequisites & Context

### Our Codebase Architecture
- **Core (`src/`)**: Main business logic, uses `~/*` path aliases
- **Web Package (`packages/web/`)**: Next.js web interface, uses `@/*` path aliases
- **Event-Sourcing**: All state changes go through immutable events
- **Type Safety**: Strict TypeScript, zero `any` types allowed
- **Testing**: TDD approach, real codepaths over mocks

### Key Type Concepts
- **ThreadId**: Branded string type (`lace_YYYYMMDD_randomId` format)
- **Events**: Discriminated unions for type safety
- **Tools**: Schema-based validation with Zod
- **Client/Server Boundary**: Types must respect Next.js boundaries

### TypeScript Rules
- **Never use `any`** - Use `unknown` with type guards instead
- **Branded types** - Use `string & { __brand: 'Type' }` for IDs
- **Discriminated unions** - Use `type` field for event type safety
- **Type guards** - Write `is` functions for runtime type checking

### Testing Rules
- **TDD**: Write failing test first, implement to pass
- **Real codepaths**: Never mock the functionality under test
- **Co-location**: Test files next to source files (`file.ts` → `file.test.ts`)
- **Type safety**: Tests must be fully typed, no `any`

## Implementation Tasks

### Phase 1: Audit and Prepare (Day 1)

#### Task 1.1: Create backup branch and setup
**Files**: Git operations
```bash
# Create feature branch
git checkout -b f/type-cleanup

# Ensure clean state
git status
npm run build
npm run lint
npm test
```

#### Task 1.2: Document current import usage
**Files**: `docs/type-audit.md` (create)
**Purpose**: Catalog all current type imports before changes
```bash
# Search for all ThreadId imports
grep -r "ThreadId" packages/web --include="*.ts" --include="*.tsx" > docs/type-audit.md

# Search for all ApprovalDecision imports  
grep -r "ApprovalDecision" packages/web --include="*.ts" --include="*.tsx" >> docs/type-audit.md

# Search for core type imports
grep -r "from '@/lib/.*core" packages/web --include="*.ts" --include="*.tsx" >> docs/type-audit.md
```

#### Task 1.3: Create test to verify no regressions
**Files**: `packages/web/lib/type-integrity.test.ts` (create)
**Purpose**: Ensure all type exports work correctly throughout cleanup
```typescript
// ABOUTME: Integration test ensuring type imports work correctly
// ABOUTME: Prevents regressions during type cleanup refactoring

import { describe, it, expect } from 'vitest';

// Test that all key types can be imported and used
describe('Type Integrity', () => {
  it('should import ThreadId from all current paths', () => {
    // Import from each current path
    const imports = [
      () => import('@/types/api').then(m => m.ThreadId),
      () => import('@/lib/server/core-types').then(m => m.ThreadId),
      () => import('@/lib/server/lace-imports').then(m => m.ThreadId),
      () => import('@/lib/core-types-import').then(m => m.ThreadId)
    ];
    
    // Verify all imports resolve
    expect(imports).toHaveLength(4);
  });

  it('should import ApprovalDecision from all current paths', () => {
    const imports = [
      () => import('@/types/api').then(m => m.ApprovalDecision),
      () => import('@/lib/server/core-types').then(m => m.ApprovalDecision)
    ];
    
    expect(imports).toHaveLength(2);
  });
});
```

**Test**: `npm test type-integrity.test.ts`
**Expected**: Test passes, documenting current state
**Commit**: `test: add type integrity test for cleanup safety`

### Phase 2: Create New Import Structure (Day 1-2)

#### Task 2.1: Create unified core types file
**Files**: `packages/web/lib/core.ts` (create)
**Purpose**: Single source for all core type imports
```typescript
// ABOUTME: Unified core type imports for web package
// ABOUTME: Single source of truth for all core types, replaces multiple import files

// Re-export all core types that web package needs
export type { 
  ThreadId, 
  AssigneeId, 
  EventType,
  ThreadEvent,
  Thread
} from '~/threads/types';

export type {
  ToolCall,
  ToolResult,
  ToolContext,
  ToolAnnotations
} from '~/tools/types';

export type {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority
} from '~/tasks/types';

export type {
  AgentState
} from '~/agents/agent';

export type {
  ProviderInfo,
  ModelInfo
} from '~/providers/base-provider';

export { 
  ApprovalDecision 
} from '~/tools/approval-types';

export type {
  ProjectInfo
} from '~/projects/project';

// Re-export utility functions
export {
  asThreadId,
  createThreadId,
  isThreadId,
  asNewAgentSpec,
  createNewAgentSpec,
  EVENT_TYPES
} from '~/threads/types';
```

**Test**: Create `packages/web/lib/core.test.ts`
```typescript
// ABOUTME: Test unified core type imports
// ABOUTME: Ensures all expected types and functions are exported correctly

import { describe, it, expect } from 'vitest';
import type { ThreadId, ApprovalDecision, Task } from './core';
import { isThreadId, asThreadId, EVENT_TYPES } from './core';

describe('Core Type Imports', () => {
  it('should export ThreadId type correctly', () => {
    const validId = 'lace_20250731_abc123';
    expect(isThreadId(validId)).toBe(true);
    
    const threadId: ThreadId = asThreadId(validId);
    expect(threadId).toBe(validId);
  });

  it('should export ApprovalDecision enum', () => {
    expect(ApprovalDecision.ALLOW_ONCE).toBe('allow_once');
    expect(ApprovalDecision.ALLOW_SESSION).toBe('allow_session');
    expect(ApprovalDecision.DENY).toBe('deny');
  });

  it('should export EVENT_TYPES constant', () => {
    expect(EVENT_TYPES).toContain('USER_MESSAGE');
    expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
    expect(EVENT_TYPES).toContain('TOOL_CALL');
  });

  it('should export Task types', () => {
    // This test verifies the type exists by using it
    const task: Partial<Task> = {
      title: 'Test task',
      status: 'pending'
    };
    expect(task.title).toBe('Test task');
  });
});
```

**Test**: `npm test core.test.ts`
**Expected**: All imports work correctly
**Commit**: `feat: add unified core type imports`

#### Task 2.2: Create clean web-specific types file
**Files**: `packages/web/types/web.ts` (create)
**Purpose**: Web-only types that don't exist in core
```typescript
// ABOUTME: Web-specific type definitions for API endpoints and UI
// ABOUTME: Contains only types unique to web package, imports core types from @/lib/core

import type { 
  ThreadId, 
  AssigneeId, 
  AgentState, 
  ToolResult,
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
  ApprovalDecision
} from '@/lib/core';

// API request/response types
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

// Re-export core types for convenience
export type { 
  ThreadId, 
  AssigneeId, 
  AgentState,
  Task, 
  TaskNote, 
  TaskStatus, 
  TaskPriority,
  ApprovalDecision,
  ToolResult
};

// API request/response interfaces
export interface MessageRequest {
  message: string;
}

export interface CreateSessionRequest {
  name?: string;
}

export interface CreateAgentRequest {
  name?: string;
  provider?: string;
  model?: string;
}

export interface MessageResponse {
  status: 'accepted';
  threadId: ThreadId;
  messageId: string;
}

// Tool approval types
export interface ToolApprovalRequestData {
  requestId: string;
  toolName: string;
  input: unknown;
  isReadOnly: boolean;
  toolDescription?: string;
  toolAnnotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    safeInternal?: boolean;
  };
  riskLevel: 'safe' | 'moderate' | 'destructive';
}

export interface PendingApproval {
  toolCallId: string;
  toolCall: {
    name: string;
    arguments: unknown;
  };
  requestedAt: Date;
  requestData: ToolApprovalRequestData;
}

export interface ToolApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  reason?: string;
}

// Generic API response types
export interface ApiSuccessResponse<T> {
  data?: T;
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Type guards
export function isApiError(response: unknown): response is ApiErrorResponse {
  return typeof response === 'object' && response !== null && 'error' in response;
}

export function isApiSuccess<T>(response: unknown): response is ApiSuccessResponse<T> {
  return typeof response === 'object' && response !== null && !('error' in response);
}
```

**Test**: Create `packages/web/types/web.test.ts`
```typescript
// ABOUTME: Test web-specific type definitions
// ABOUTME: Verifies API types and type guards work correctly

import { describe, it, expect } from 'vitest';
import type { Session, Agent, MessageRequest } from './web';
import { isApiError, isApiSuccess } from './web';
import { asThreadId } from '@/lib/core';

describe('Web Types', () => {
  it('should create valid Session type', () => {
    const session: Session = {
      id: asThreadId('lace_20250731_test123'),
      name: 'Test Session',
      createdAt: '2025-07-31T10:00:00Z'
    };
    
    expect(session.name).toBe('Test Session');
    expect(session.id).toBe('lace_20250731_test123');
  });

  it('should validate API error responses', () => {
    const errorResponse = { error: 'Something went wrong' };
    const successResponse = { data: { result: 'success' } };
    
    expect(isApiError(errorResponse)).toBe(true);
    expect(isApiError(successResponse)).toBe(false);
    expect(isApiSuccess(successResponse)).toBe(true);
    expect(isApiSuccess(errorResponse)).toBe(false);
  });

  it('should create valid MessageRequest', () => {
    const request: MessageRequest = {
      message: 'Hello world'
    };
    
    expect(request.message).toBe('Hello world');
  });
});
```

**Test**: `npm test web.test.ts`
**Commit**: `feat: add clean web-specific types`

#### Task 2.3: Create combined events file
**Files**: `packages/web/types/events.ts` (create)
**Purpose**: All event-related types in one place
```typescript
// ABOUTME: Combined event type definitions for web interface
// ABOUTME: Consolidates events and event constants into single file

import type { EventType, ThreadId, ToolResult } from '@/lib/core';
import { EVENT_TYPES } from '@/lib/core';

// Re-export core event types
export { EVENT_TYPES, type EventType };

// UI-only event types (not persisted)
export const UI_EVENT_TYPES = [
  'TOOL_APPROVAL_REQUEST',
  'AGENT_TOKEN',
  'AGENT_STREAMING',
] as const;

export type UIEventType = (typeof UI_EVENT_TYPES)[number];

// Combined event types for SSE streaming
export type SessionEventType = EventType | UIEventType;

// Event data interfaces
export interface UserMessageEventData {
  content: string;
}

export interface AgentMessageEventData {
  content: string;
}

export interface ToolCallEventData {
  toolName: string;
  input: unknown;
}

export interface ToolAggregatedEventData {
  call: ToolCallEventData;
  result?: ToolResult;
  toolName: string;
  toolId?: string;
  arguments?: unknown;
}

// Discriminated union for session events
export type SessionEvent =
  | {
      type: 'USER_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: UserMessageEventData;
    }
  | {
      type: 'AGENT_MESSAGE';
      threadId: ThreadId;
      timestamp: Date;
      data: AgentMessageEventData;
    }
  | {
      type: 'TOOL_CALL';
      threadId: ThreadId;
      timestamp: Date;
      data: ToolCallEventData;
    }
  | {
      type: 'TOOL_RESULT';
      threadId: ThreadId;
      timestamp: Date;
      data: ToolResult;
    }
  | {
      type: 'AGENT_TOKEN';
      threadId: ThreadId;
      timestamp: Date;
      data: { token: string };
    }
  | {
      type: 'AGENT_STREAMING';
      threadId: ThreadId;
      timestamp: Date;  
      data: { content: string };
    };

// Utility functions
export function getAllEventTypes(): SessionEventType[] {
  return [...EVENT_TYPES, ...UI_EVENT_TYPES];
}

export function isPersistedEvent(type: SessionEventType): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}
```

**Test**: Create `packages/web/types/events.test.ts`
```typescript
// ABOUTME: Test event type definitions and utilities
// ABOUTME: Ensures event types are correctly structured and utilities work

import { describe, it, expect } from 'vitest';
import { 
  EVENT_TYPES, 
  UI_EVENT_TYPES, 
  getAllEventTypes, 
  isPersistedEvent,
  type SessionEvent 
} from './events';
import { asThreadId } from '@/lib/core';

describe('Event Types', () => {
  it('should export core EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('USER_MESSAGE');
    expect(EVENT_TYPES).toContain('AGENT_MESSAGE');
    expect(EVENT_TYPES).toContain('TOOL_CALL');
  });

  it('should define UI_EVENT_TYPES', () => {
    expect(UI_EVENT_TYPES).toContain('TOOL_APPROVAL_REQUEST');
    expect(UI_EVENT_TYPES).toContain('AGENT_TOKEN');
    expect(UI_EVENT_TYPES).toContain('AGENT_STREAMING');
  });

  it('should combine all event types', () => {
    const allTypes = getAllEventTypes();
    expect(allTypes).toContain('USER_MESSAGE'); // from core
    expect(allTypes).toContain('AGENT_TOKEN'); // from UI
  });

  it('should identify persisted events', () => {
    expect(isPersistedEvent('USER_MESSAGE')).toBe(true);
    expect(isPersistedEvent('AGENT_TOKEN')).toBe(false);
  });

  it('should create valid SessionEvent', () => {
    const event: SessionEvent = {
      type: 'USER_MESSAGE',
      threadId: asThreadId('lace_20250731_test123'),
      timestamp: new Date(),
      data: { content: 'Hello' }
    };
    
    expect(event.type).toBe('USER_MESSAGE');
    expect(event.data.content).toBe('Hello');
  });
});
```

**Test**: `npm test events.test.ts`
**Commit**: `feat: consolidate event types into single file`

### Phase 3: Update Import Structure (Day 2-3)

#### Task 3.1: Replace duplicate ApprovalDecision
**Files**: `packages/web/types/api.ts` (modify)
**Purpose**: Remove duplicate ApprovalDecision definition

First, write test to capture current behavior:
```bash
# Create test that verifies ApprovalDecision works
npm test -- --grep "ApprovalDecision"
```

Then modify `packages/web/types/api.ts`:
```typescript
// Remove these lines (14-21):
// export const ApprovalDecision = {
//   ALLOW_ONCE: 'allow_once',
//   ALLOW_SESSION: 'allow_session', 
//   DENY: 'deny',
// } as const;
// 
// export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

// Replace with import:
import type { ApprovalDecision } from '@/lib/core';
export type { ApprovalDecision };
```

**Test**: `npm test`
**Expected**: All tests pass, no breaking changes
**Commit**: `refactor: remove duplicate ApprovalDecision, use core import`

#### Task 3.2: Fix ThreadId type shadowing
**Files**: `packages/web/lib/validation/schemas.ts` (modify)
**Purpose**: Use core ThreadId instead of Zod-inferred type

Current problematic code (line 84):
```typescript
export type ThreadId = z.infer<typeof ThreadIdSchema>;
```

Replace with:
```typescript
import type { ThreadId } from '@/lib/core';
// Remove the z.infer line, use imported ThreadId type
```

Update the schema to work with branded type:
```typescript
export const ThreadIdSchema = z
  .string()
  .refine(
    (value) => isValidThreadId(value),
    'Invalid thread ID format. Expected: lace_YYYYMMDD_randomId, UUID, or either with .number suffix'
  )
  .transform((value): ThreadId => {
    // Import from core instead of local function
    const { asThreadId } = await import('@/lib/core');
    return asThreadId(value);
  });
```

**Test**: `npm test schemas.test.ts`
**Expected**: Schema validation works with core ThreadId type
**Commit**: `fix: use core ThreadId type in schemas, remove shadowing`

#### Task 3.2.1: Move other Zod-inferred types to web types
**Files**: `packages/web/lib/validation/schemas.ts` (modify), `packages/web/types/web.ts` (modify)
**Purpose**: Move request/response types to appropriate location, avoid schema file exporting domain types

Remove from `packages/web/lib/validation/schemas.ts` (lines 85-90):
```typescript
// Remove these exports:
// export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
// export type MessageRequest = z.infer<typeof MessageRequestSchema>;
// export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
// export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
// export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
// export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
```

Add to `packages/web/types/web.ts`:
```typescript
// Import schemas for type inference
import { 
  ToolCallIdSchema,
  MessageRequestSchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  CreateSessionRequestSchema,
  SpawnAgentRequestSchema
} from '@/lib/validation/schemas';

// Add these type exports
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
```

Update imports in files that use these types:
```bash
# Find files using these types
grep -r "MessageRequest\|CreateTaskRequest\|CreateSessionRequest" packages/web --include="*.ts" --include="*.tsx"
```

Change imports from:
```typescript
import type { MessageRequest } from '@/lib/validation/schemas';
```

To:
```typescript
import type { MessageRequest } from '@/types/web';
```

**Test**: `npm test && npm run build`
**Expected**: Types available from web types file, not validation schemas
**Commit**: `refactor: move request/response types from schemas to web types`

#### Task 3.3: Update validation to use core functions
**Files**: `packages/web/lib/validation/thread-id-validation.ts` (modify)
**Purpose**: Use core validation instead of duplicated logic

Replace entire file content:
```typescript
// ABOUTME: ThreadId validation using core functions
// ABOUTME: Wrapper around core validation for web package convenience

import { isThreadId, asThreadId } from '@/lib/core';

// Re-export core functions with web-friendly names
export const isValidThreadId = isThreadId;
export const asValidThreadId = asThreadId;
```

**Test**: `npm test thread-id-validation.test.ts`
**Expected**: Validation works identically to before
**Commit**: `refactor: use core ThreadId validation functions`

#### Task 3.4: Migrate files to new import structure (Batch 1)
**Files**: All files importing from `@/lib/server/core-types`
**Purpose**: Switch to unified `@/lib/core` imports

Create script to help with migration:
```bash
# Find all files using old import
grep -r "@/lib/server/core-types" packages/web --include="*.ts" --include="*.tsx" -l
```

For each file found, replace:
```typescript
// Old:
import { ThreadId, AgentState } from '@/lib/server/core-types';

// New:
import type { ThreadId, AgentState } from '@/lib/core';
```

**Important**: Update imports in small batches (5-10 files), test after each batch

Example files to update:
- `packages/web/hooks/useSSEStream.ts`
- `packages/web/hooks/useHashRouter.ts`
- `packages/web/app/api/sessions/[sessionId]/route.ts`

**Test**: After each batch: `npm test && npm run build`
**Commit**: After each batch: `refactor: migrate [file names] to @/lib/core imports`

#### Task 3.5: Migrate files to new import structure (Batch 2)
**Files**: All files importing from `@/types/api`
**Purpose**: Switch to `@/types/web` for web-specific types

Replace:
```typescript
// Old:
import type { Session, Agent, ThreadId } from '@/types/api';

// New:
import type { Session, Agent } from '@/types/web';
import type { ThreadId } from '@/lib/core';
```

Example files:
- `packages/web/components/pages/LaceApp.tsx`
- `packages/web/hooks/useSessionAPI.ts`
- `packages/web/lib/timeline-converter.ts`

**Test**: After each batch: `npm test && npm run build`
**Commit**: After each batch: `refactor: migrate [file names] to new type imports`

### Phase 4: Clean Up Old Files (Day 3)

#### Task 4.1: Remove redundant import files
**Files**: Delete old import files after migration is complete

Before deletion, verify no references remain:
```bash
# Check each file has no remaining imports
grep -r "@/lib/server/core-types" packages/web --include="*.ts" --include="*.tsx"
grep -r "@/lib/core-types-import" packages/web --include="*.ts" --include="*.tsx"
grep -r "@/types/api" packages/web --include="*.ts" --include="*.tsx"
```

If searches return no results, delete files:
- `packages/web/lib/server/core-types.ts`
- `packages/web/lib/core-types-import.ts`  
- `packages/web/types/api.ts`
- `packages/web/types/events-constants.ts`

Keep:
- `packages/web/lib/server/lace-imports.ts` (needed for business logic classes)

**Test**: `npm test && npm run build`
**Expected**: No import errors, all tests pass
**Commit**: `cleanup: remove redundant type import files`

#### Task 4.1.1: Audit server-only boundary enforcement
**Files**: All client components and hooks
**Purpose**: Ensure no business logic classes leak to client-side code

Verify client components only import types, not classes:
```bash
# Check client components don't import business logic classes
grep -r "Agent\|ThreadManager\|ToolExecutor\|Session\|Project" packages/web/components --include="*.tsx" -A 1 -B 1

# Check hooks don't import business logic classes  
grep -r "Agent\|ThreadManager\|ToolExecutor\|Session\|Project" packages/web/hooks --include="*.ts" -A 1 -B 1

# These should only be imports like:
# import type { Agent } from '@/types/web'; // ✅ OK
# NOT:
# import { Agent } from '@/lib/server/lace-imports'; // ❌ BAD
```

Fix any violations by:
1. Change to type-only imports: `import type { Agent } from '@/types/web'`
2. Move business logic to API routes or server components

**Test**: `npm run build`
**Expected**: No server-only imports in client code
**Commit**: `fix: enforce server-only boundary for business logic classes`

#### Task 4.2: Update main types index
**Files**: `packages/web/types/index.ts` (modify)
**Purpose**: Update to use new file structure

Replace content:
```typescript
// ABOUTME: Main types index for web package
// ABOUTME: Re-exports all type definitions from organized modules

// Core types from main project
export type * from '@/lib/core';

// Web-specific types
export * from './web';

// Event types
export * from './events';

// Design system types (unchanged)
export type {
  Message,
  StreamEvent,
  ChatState,
  GoogleDocAttachment,
  TimelineEntry,
  CarouselItem,
  Timeline,
  RecentFile,
  Theme,
} from './design-system';
```

**Test**: `npm test`
**Commit**: `refactor: update types index for new structure`

### Phase 5: Testing and Validation (Day 4)

#### Task 5.1: Run comprehensive tests
**Commands**:
```bash
# Full test suite
npm test

# Type checking
npm run lint

# Build test
npm run build

# E2E tests if available
npm run test:e2e
```

**Expected**: All tests pass, no TypeScript errors, successful build

#### Task 5.2: Update type integrity test
**Files**: `packages/web/lib/type-integrity.test.ts` (modify)
**Purpose**: Verify new import structure works

Replace test content:
```typescript
// ABOUTME: Integration test ensuring new type structure works correctly
// ABOUTME: Validates unified import strategy and no regressions

import { describe, it, expect } from 'vitest';
import type { 
  ThreadId, 
  ApprovalDecision, 
  Task,
  AgentState,
  ToolResult 
} from '@/lib/core';
import type { 
  Session, 
  Agent, 
  MessageRequest 
} from '@/types/web';
import type { 
  SessionEvent,
  SessionEventType 
} from '@/types/events';
import { isThreadId, asThreadId } from '@/lib/core';

describe('Type Integrity - New Structure', () => {
  it('should import all core types correctly', () => {
    const threadId: ThreadId = asThreadId('lace_20250731_test123');
    expect(isThreadId(threadId)).toBe(true);
    
    const decision: ApprovalDecision = 'allow_once';
    expect(decision).toBe('allow_once');
  });

  it('should import web-specific types correctly', () => {
    const session: Session = {
      id: asThreadId('lace_20250731_test123'),
      name: 'Test',
      createdAt: '2025-07-31T10:00:00Z'
    };
    
    expect(session.name).toBe('Test');
  });

  it('should import event types correctly', () => {
    const event: SessionEvent = {
      type: 'USER_MESSAGE',
      threadId: asThreadId('lace_20250731_test123'),
      timestamp: new Date(),
      data: { content: 'Hello' }
    };
    
    expect(event.type).toBe('USER_MESSAGE');
  });

  it('should have no type conflicts or shadowing', () => {
    // This test will fail to compile if there are type conflicts
    const threadId1: ThreadId = asThreadId('lace_20250731_test1');
    const threadId2: import('@/lib/core').ThreadId = asThreadId('lace_20250731_test2');
    
    // These should be the same type
    const same: typeof threadId1 = threadId2;
    expect(same).toBe(threadId2);
  });
});
```

**Test**: `npm test type-integrity.test.ts`
**Expected**: All type imports work correctly
**Commit**: `test: update type integrity test for new structure`

#### Task 5.3: Manual verification checklist
**Purpose**: Ensure web app still functions correctly

1. **Start development server**: `npm run dev`
2. **Open web interface**: Visit `http://localhost:3000`
3. **Test core functionality**:
   - Create new session
   - Send message to agent
   - Verify tool approval modal works
   - Check task management interface
   - Verify no console errors

4. **API endpoint verification**:
   ```bash
   # Test key endpoints respond correctly
   curl http://localhost:3000/api/sessions
   curl http://localhost:3000/api/providers
   ```

**Expected**: All functionality works as before, no runtime errors

#### Task 5.4: Performance check
**Commands**:
```bash
# Check bundle sizes haven't increased significantly
npm run build
ls -la .next/static/chunks/

# Check TypeScript compilation time
time npm run build
```

**Expected**: Similar build times and bundle sizes to before

**Commit**: `test: verify web app functionality after type cleanup`

### Phase 6: Documentation (Day 4)

#### Task 6.1: Update type system documentation
**Files**: `docs/design/types-and-validation.md` (already created)
**Purpose**: Document the cleaned-up type organization and import conventions

This documentation file already exists and describes the end state architecture. Review and update if needed after implementation to ensure it matches the actual implementation.

**Test**: Manual review - documentation accurately reflects new structure
**Commit**: `docs: update type system architecture documentation`

## Final Checklist

Before marking complete, verify:

- [ ] Zero `any` types in codebase
- [ ] All tests passing (`npm test`)
- [ ] TypeScript compilation successful (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Web app functions correctly (manual test)
- [ ] No duplicate type definitions
- [ ] Single import path for each type
- [ ] Clear separation of core vs web-specific types
- [ ] Documentation updated

## Rollback Plan

If issues arise during implementation:

1. **Revert to backup branch**: `git checkout main && git branch -D f/type-cleanup`
2. **Identify specific problem**: Check failing tests and TypeScript errors
3. **Fix individual issue**: Address one problem at a time
4. **Alternative approach**: If structural issues, consider smaller incremental changes

## Post-Implementation

After successful completion:

1. **Update team documentation**: Document new import conventions
2. **Create ESLint rules**: Prevent future type duplication
3. **Team communication**: Share new import patterns with team
4. **Monitor for regressions**: Watch for new type duplication in PRs

## Notes for Implementation

- **Commit frequently**: After each task completion
- **Test incrementally**: Don't accumulate changes without testing
- **Check TypeScript errors carefully**: Strict mode catches type issues early
- **Use type assertions sparingly**: Prefer type guards over `as` casting
- **Document any deviations**: If implementation differs from plan, document why