# TypeScript Type System Repair Plan

## Overview

This document provides a comprehensive, phased approach to resolving the critical type system issues identified in the type audit. The plan prioritizes **safety** and **incremental progress** to avoid breaking existing functionality while systematically improving type organization.

## Execution Strategy 

**Guiding Principles:**
- ✅ **Incremental Changes** - Small, testable modifications
- ✅ **Backwards Compatibility** - Maintain existing API contracts during transition
- ✅ **Test-Driven** - Every change verified by tests
- ✅ **Single Source of Truth** - Eliminate duplication systematically  
- ✅ **Clear Ownership** - Each type has one authoritative definition

---

## Phase 1: Critical Safety Fixes (Week 1)

### 🔴 CRITICAL: Resolve EventType Name Collision

**Problem**: Two different `EventType` definitions cause import confusion and potential runtime errors.

**Solution**: Rename conflicting types to be domain-specific.

**Implementation:**

1. **Rename Core Events EventType** → `ThreadEventType`
   ```typescript
   // src/threads/types.ts (BEFORE)
   export type EventType = (typeof EVENT_TYPES)[number];
   
   // src/threads/types.ts (AFTER)  
   export type ThreadEventType = (typeof EVENT_TYPES)[number];
   
   // Keep legacy export for transition
   /** @deprecated Use ThreadEventType instead */
   export type EventType = ThreadEventType;
   ```

2. **Rename Streaming EventType** → `StreamEventCategory`
   ```typescript
   // src/events/types.ts (BEFORE)
   export type EventType = 'session' | 'task' | 'project' | 'global';
   
   // src/events/types.ts (AFTER)
   export type StreamEventCategory = 'session' | 'task' | 'project' | 'global';
   
   // Keep legacy export for transition
   /** @deprecated Use StreamEventCategory instead */
   export type EventType = StreamEventCategory;
   ```

3. **Update Core Imports Incrementally**
   - Update `StreamEvent` interface to use `StreamEventCategory`
   - Update `ThreadEvent` references to use `ThreadEventType`
   - Run tests after each file change

4. **Update Web Package Imports**
   - Update `/packages/web/lib/core.ts` exports
   - Update all web package imports to use new names
   - Test web UI functionality

**Testing Strategy:**
```bash
# After each change
npm run test:unit src/threads/
npm run test:unit src/events/  
npm run test:unit packages/web/
npm run build  # Ensure TypeScript compilation
```

**Rollback Plan**: If issues arise, the legacy exports allow immediate rollback.

**Estimated Time**: 2-3 days

---

## Phase 2: Web Package Consolidation (Week 1-2)

### 🟠 HIGH: Eliminate Web Package Type Duplication

**Problem**: Identical interfaces duplicated across `types/events.ts` and `types/api.ts`.

**Solution**: Merge into single authoritative file with clear domain separation.

**Implementation:**

1. **Create New Unified Types File**
   ```bash
   # New file structure
   packages/web/types/
   ├── core.ts          # Re-exports from ~/src
   ├── web-api.ts       # Web-specific API types  
   ├── web-events.ts    # Web-specific event extensions
   └── index.ts         # Public exports
   ```

2. **Move Shared Event Data to `web-events.ts`**
   ```typescript
   // packages/web/types/web-events.ts
   import type { ThreadEventType } from '@/types/core';
   
   // Event data structures used by both API and UI
   export interface UserMessageEventData {
     content: string;
   }
   
   export interface ToolCallEventData {
     id: string;
     name: string;
     arguments?: unknown;
   }
   
   // ... all other shared event data interfaces
   ```

3. **Move API-Specific Types to `web-api.ts`**
   ```typescript
   // packages/web/types/web-api.ts
   import type { ThreadId } from '@/types/core';
   import type { UserMessageEventData } from './web-events';
   
   // API request/response types only
   export interface CreateSessionRequest {
     name?: string;
   }
   
   export interface SessionResponse {
     session: Session;
   }
   ```

4. **Update All Imports**
   - Replace dual imports with single source
   - Update component imports to use new structure
   - Update test imports

5. **Remove Duplicate Files**
   - Delete `types/events.ts` 
   - Delete `types/api.ts`
   - Update any remaining references

**Testing Strategy:**
```bash
# Comprehensive testing required
npm run test:unit packages/web/
npm run test:integration packages/web/
npm run build packages/web/
```

**Estimated Time**: 3-4 days

---

## Phase 3: Tool Approval Type Unification (Week 2)

### 🟠 HIGH: Consolidate Tool Approval Types

**Problem**: `ToolApprovalRequestData` defined 3+ times with different structures.

**Solution**: Create single authoritative definition with proper inheritance.

**Implementation:**

1. **Define Core Tool Approval Types**
   ```typescript
   // src/tools/approval-types.ts (ENHANCED)
   
   // Minimal core data (what core system needs)
   export interface BaseToolApprovalRequest {
     toolCallId: string;
     toolName: string;
     input: unknown;
   }
   
   // Extended data for UI (inherits from base)  
   export interface UIToolApprovalRequest extends BaseToolApprovalRequest {
     requestId: string;
     isReadOnly: boolean;
     toolDescription?: string;
     toolAnnotations?: ToolAnnotations;
     riskLevel: 'safe' | 'moderate' | 'destructive';
   }
   ```

2. **Update Core Thread Types**
   ```typescript
   // src/threads/types.ts
   import type { BaseToolApprovalRequest } from '~/tools/approval-types';
   
   export interface ToolApprovalRequestData extends BaseToolApprovalRequest {
     // Core can use base type directly
   }
   ```

3. **Update Web Package Types**
   ```typescript
   // packages/web/types/web-api.ts
   import type { UIToolApprovalRequest } from '~/tools/approval-types';
   
   export interface ToolApprovalRequestData extends UIToolApprovalRequest {
     // Web uses extended type with UI fields
   }
   ```

4. **Create Type Converters**
   ```typescript
   // src/tools/approval-converters.ts
   
   export function toUIApprovalRequest(
     base: BaseToolApprovalRequest,
     uiData: Omit<UIToolApprovalRequest, keyof BaseToolApprovalRequest>
   ): UIToolApprovalRequest {
     return { ...base, ...uiData };
   }
   
   export function toCoreApprovalRequest(
     ui: UIToolApprovalRequest
   ): BaseToolApprovalRequest {
     const { requestId, isReadOnly, toolDescription, toolAnnotations, riskLevel, ...core } = ui;
     return core;
   }
   ```

**Testing Strategy:**
- Test all tool approval flows end-to-end
- Verify UI displays correct information
- Test approval decision persistence

**Estimated Time**: 2-3 days

---

## Phase 4: Event System Architecture (Week 3)

### 🟠 HIGH: Unify Event Systems

**Problem**: Three parallel event systems with overlapping responsibilities.

**Solution**: Create unified event architecture with clear layer separation.

**Implementation:**

1. **Define Event Layer Architecture**
   ```
   Core Events (src/events/)
   ├── Domain Events (task:created, agent:spawned)
   ├── Thread Events (USER_MESSAGE, TOOL_CALL) 
   └── Stream Events (real-time transport)
   
   Web Events (packages/web/types/)
   ├── UI Events (extends core events with UI data)
   └── Client Events (browser-specific)
   ```

2. **Create Unified Core Event System**
   ```typescript
   // src/events/unified-types.ts
   
   import type { ThreadEventType } from '~/threads/types';
   
   // Base event structure
   export interface BaseEvent {
     id: string;
     timestamp: string; // ISO string for serialization consistency
     threadId?: ThreadId;
   }
   
   // Domain events (business logic)
   export type DomainEvent = 
     | TaskCreatedEvent
     | AgentSpawnedEvent
     | ProjectUpdatedEvent;
   
   // Thread events (conversation)  
   export type ThreadEvent = BaseEvent & {
     type: ThreadEventType;
     data: ThreadEventData;
   };
   
   // Stream events (transport)
   export type StreamEvent = BaseEvent & {
     category: StreamEventCategory;
     scope: EventScope;
     data: DomainEvent | ThreadEvent;
   };
   ```

3. **Update Web Event Extensions**
   ```typescript
   // packages/web/types/web-events.ts
   
   import type { ThreadEvent, StreamEvent } from '~/events/unified-types';
   
   // Web adds UI-specific data to core events
   export interface UIThreadEvent extends ThreadEvent {
     uiMetadata?: {
       displayName?: string;
       iconType?: string;
       highlighted?: boolean;
     };
   }
   ```

4. **Create Event Converters**
   ```typescript
   // src/events/converters.ts
   
   export function threadEventToStreamEvent(
     threadEvent: ThreadEvent,
     scope: EventScope
   ): StreamEvent {
     return {
       ...threadEvent,
       category: 'session',
       scope,
       data: threadEvent,
     };
   }
   ```

**Migration Strategy:**
- Introduce new types alongside existing ones
- Gradually migrate consumers to new architecture
- Remove old types once migration complete

**Estimated Time**: 5-6 days

---

## Phase 5: Naming Convention Standardization (Week 4)

### 🟡 MEDIUM: Fix Naming Violations

**Problem**: Inconsistent naming patterns and historical references.

**Solution**: Establish and enforce clear naming conventions.

**Implementation:**

1. **Define Naming Conventions**
   ```typescript
   // Type Suffix Conventions:
   
   // Data structures (pure data)
   interface UserData { name: string; email: string; }
   
   // Configuration objects  
   interface DatabaseConfig { host: string; port: number; }
   
   // API request/response (when context unclear)
   interface CreateUserRequest { userData: UserData; }
   interface UserListResponse { users: UserData[]; }
   
   // Events (things that happened)
   interface UserCreatedEvent { user: UserData; timestamp: string; }
   
   // Services/managers (avoid generic "Manager" suffix)
   class UserRepository { } // not UserManager
   class TokenValidator { } // not TokenHandler
   ```

2. **Rename Historical References**
   ```typescript
   // BEFORE: src/threads/types.ts
   export type NewAgentSpec = string & { readonly __brand: 'NewAgentSpec' };
   
   // AFTER: src/threads/types.ts  
   export type AgentSpec = string & { readonly __brand: 'AgentSpec' };
   
   // Keep legacy export during transition
   /** @deprecated Use AgentSpec instead */
   export type NewAgentSpec = AgentSpec;
   ```

3. **Standardize Manager Classes**
   ```typescript
   // BEFORE
   class ThreadManager { }
   class TokenBudgetManager { }
   
   // AFTER  
   class ThreadRepository { }
   class TokenBudgetTracker { }
   ```

4. **Update Import References**
   - Update all files importing renamed types
   - Use IDE refactoring tools where possible
   - Update documentation and comments

**Testing Strategy:**
- Verify all imports resolve correctly
- Run full test suite to catch any missed references
- Check that build process completes successfully

**Estimated Time**: 3-4 days

---

## Phase 6: Timestamp Standardization (Week 4)

### 🟡 MEDIUM: Unify Timestamp Handling

**Problem**: Mixed Date objects and ISO strings cause serialization issues.

**Solution**: Standardize on ISO strings with utility functions for Date operations.

**Implementation:**

1. **Create Timestamp Utilities**
   ```typescript
   // src/utils/timestamps.ts
   
   export type Timestamp = string; // ISO string
   
   export const TimestampUtils = {
     now(): Timestamp {
       return new Date().toISOString();
     },
     
     fromDate(date: Date): Timestamp {
       return date.toISOString();
     },
     
     toDate(timestamp: Timestamp): Date {
       return new Date(timestamp);
     },
     
     isValid(timestamp: Timestamp): boolean {
       return !isNaN(Date.parse(timestamp));
     }
   };
   ```

2. **Update Core Event Types**
   ```typescript
   // src/threads/types.ts (BEFORE)
   interface BaseThreadEvent {
     timestamp: Date;
   }
   
   // src/threads/types.ts (AFTER)
   import type { Timestamp } from '~/utils/timestamps';
   
   interface BaseThreadEvent {
     timestamp: Timestamp;
   }
   ```

3. **Create Migration Helpers**
   ```typescript
   // src/utils/timestamp-migration.ts
   
   export function migrateEventTimestamps<T extends { timestamp: Date | string }>(
     events: T[]
   ): Array<T & { timestamp: Timestamp }> {
     return events.map(event => ({
       ...event,
       timestamp: typeof event.timestamp === 'string' 
         ? event.timestamp 
         : TimestampUtils.fromDate(event.timestamp)
     }));
   }
   ```

4. **Update Database Layer**
   - Modify event persistence to handle timestamp conversion
   - Add migration for existing data if needed
   - Test serialization/deserialization

**Testing Strategy:**
- Test timestamp utilities thoroughly
- Verify event serialization works correctly  
- Test web UI displays timestamps properly
- Check database persistence

**Estimated Time**: 2-3 days

---

## Phase 7: Validation Schema Centralization (Week 5)

### 🟠 HIGH: Consolidate Zod Schemas

**Problem**: Repetitive schema definitions across 20+ API routes.

**Solution**: Create centralized schema registry with reusable validators.

**Implementation:**

1. **Create Schema Registry**
   ```typescript
   // packages/web/lib/validation/schema-registry.ts
   
   import { z } from 'zod';
   
   // Base schemas (building blocks)
   export const BaseSchemas = {
     threadId: z
       .string()
       .refine(isValidThreadId, 'Invalid thread ID format'),
       
     nonEmptyString: z
       .string()
       .min(1, 'Cannot be empty'),
       
     timestamp: z
       .string()
       .datetime('Invalid ISO timestamp'),
   };
   
   // Composite schemas (domain objects)
   export const DomainSchemas = {
     createTask: z.object({
       title: BaseSchemas.nonEmptyString.max(200),
       description: z.string().max(1000).optional(),
       prompt: BaseSchemas.nonEmptyString.max(5000),
       priority: z.enum(['high', 'medium', 'low']).default('medium'),
       assignedTo: BaseSchemas.threadId.optional(),
     }),
     
     updateTask: z.object({
       title: BaseSchemas.nonEmptyString.max(200).optional(),
       description: z.string().max(1000).optional(),
       status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
       // ... other fields
     }),
   };
   
   // API endpoint schemas (specific to routes)
   export const APISchemas = {
     'POST /api/tasks': DomainSchemas.createTask,
     'PATCH /api/tasks/:id': DomainSchemas.updateTask,
     // ... other endpoints
   };
   ```

2. **Create Validation Middleware**
   ```typescript
   // packages/web/lib/validation/middleware.ts
   
   import { NextRequest } from 'next/server';
   import { APISchemas } from './schema-registry';
   
   export async function validateRequest<T>(
     request: NextRequest,
     endpoint: keyof typeof APISchemas
   ): Promise<{ success: true; data: T } | { success: false; error: string }> {
     try {
       const body = await request.json();
       const schema = APISchemas[endpoint];
       const data = schema.parse(body);
       return { success: true, data };
     } catch (error) {
       return { 
         success: false, 
         error: error instanceof Error ? error.message : 'Validation failed' 
       };
     }
   }
   ```

3. **Update API Routes**
   ```typescript
   // packages/web/app/api/tasks/route.ts (BEFORE)
   const CreateTaskSchema = z.object({
     title: z.string().min(1).max(200),
     // ... duplicated schema definition
   });
   
   // packages/web/app/api/tasks/route.ts (AFTER)  
   import { validateRequest } from '@/lib/validation/middleware';
   
   export async function POST(request: NextRequest) {
     const validation = await validateRequest(request, 'POST /api/tasks');
     if (!validation.success) {
       return NextResponse.json({ error: validation.error }, { status: 400 });
     }
     
     const taskData = validation.data;
     // ... rest of handler
   }
   ```

4. **Remove Duplicate Schemas**
   - Remove schema definitions from individual route files
   - Update imports to use centralized schemas
   - Test all API endpoints

**Testing Strategy:**
- Test validation middleware with valid/invalid inputs
- Verify all API routes still work correctly
- Test error messages are user-friendly

**Estimated Time**: 4-5 days

---

## Phase 8: Long-Term Architecture (Week 6+)

### 🔵 LOW: Strategic Improvements

**These are longer-term improvements that can be implemented as time allows:**

1. **Enhanced Server/Client Type Separation**
   - Stricter enforcement of `'server-only'` boundaries
   - Client-safe type definitions that exclude server internals
   - Runtime validation of server/client boundaries

2. **Type-Safe Event Routing**
   - Compile-time verification of event handler matching
   - Automatic event serialization/deserialization
   - Type-safe event filtering

3. **API Type Generation**
   - Generate TypeScript types from OpenAPI schemas
   - Automatic client type generation from server definitions
   - Runtime API contract validation

---

## Implementation Guidelines

### Development Workflow

1. **Create Feature Branch**
   ```bash
   git checkout -b type-repair/phase-1-event-collision
   ```

2. **Make Incremental Changes**
   - Change one file at a time
   - Run tests after each change
   - Commit frequently with descriptive messages

3. **Test Thoroughly**
   ```bash
   # After each change
   npm run lint
   npm run test:unit
   npm run build
   npm run test:integration  # for larger changes
   ```

4. **Code Review**
   - Focus on type safety improvements
   - Verify backwards compatibility
   - Check for missed import updates

### Rollback Strategy

Each phase includes deprecation warnings and legacy exports to allow safe rollback:

```typescript
// Example rollback-safe change
export type NewTypeName = { /* new definition */ };

/** @deprecated Use NewTypeName instead */
export type OldTypeName = NewTypeName;
```

If issues arise:
1. Revert to previous working state
2. Analyze what went wrong
3. Adjust approach and retry

### Communication Plan

- **Before Each Phase**: Review plan with team
- **During Implementation**: Daily progress updates
- **After Each Phase**: Document changes and learnings
- **At Completion**: Update documentation and create type governance guidelines

---

## Success Metrics

### Quantitative Goals

- **Eliminate 100% of duplicate type definitions**
- **Resolve all critical type name collisions**  
- **Reduce type-related compilation errors by 90%**
- **Consolidate validation schemas into single registry**

### Qualitative Goals

- **Improved Developer Experience**: Clearer type imports, better IDE support
- **Enhanced Type Safety**: Fewer runtime type errors
- **Better Maintainability**: Single source of truth for all types
- **Clearer Architecture**: Well-defined boundaries between layers

### Measurement Methods

- **Before/After Code Analysis**: Count duplicate definitions, naming violations
- **Build Time Metrics**: Measure TypeScript compilation performance  
- **Developer Feedback**: Survey team on type system usability
- **Bug Tracking**: Monitor type-related issues in production

---

## Risk Assessment

### High-Risk Changes

1. **EventType Renaming**: Could break many import statements
   - **Mitigation**: Legacy exports with deprecation warnings
   - **Testing**: Comprehensive unit and integration tests

2. **Event System Unification**: Large architectural change
   - **Mitigation**: Phased approach with parallel systems during transition
   - **Testing**: End-to-end event flow testing

### Medium-Risk Changes  

1. **Timestamp Standardization**: Could affect data serialization
   - **Mitigation**: Migration utilities and thorough testing
   - **Testing**: Database persistence and API serialization tests

2. **Schema Centralization**: Could break existing API contracts
   - **Mitigation**: Careful schema matching and validation
   - **Testing**: API endpoint testing with real requests

### Low-Risk Changes

1. **Naming Convention Updates**: Mostly cosmetic changes
   - **Mitigation**: IDE refactoring tools and search/replace
   - **Testing**: Build verification and import resolution

---

## Conclusion

This repair plan provides a systematic approach to resolving the identified type system issues while maintaining system stability. The phased approach allows for incremental progress and early wins while building toward a more maintainable and type-safe architecture.

**Key Success Factors:**
- **Incremental Implementation** - Small, testable changes
- **Comprehensive Testing** - Verify each change thoroughly  
- **Team Communication** - Keep everyone informed of progress
- **Documentation** - Update all relevant documentation
- **Patience** - Allow sufficient time for thorough implementation

By following this plan, the Lace codebase will achieve a clean, maintainable, and type-safe architecture that supports long-term development and reduces technical debt.