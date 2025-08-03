# Type Import Audit - Current State (2025-07-31)

## Overview

This document catalogs all current type imports in the web package before the type cleanup refactoring. This serves as a baseline to ensure no functionality is lost during the reorganization.

## ThreadId Import Patterns

### Pattern 1: From @/lib/server/core-types (GOOD - should be standard)
- Files: 43 occurrences
- Examples:
  - `import { asThreadId, type ThreadId } from '@/lib/server/core-types';`
  - `import { ThreadId } from '@/lib/server/core-types';`

### Pattern 2: From @/types/api (DUPLICATE - needs migration)
- Files: 38 occurrences  
- Examples:
  - `import type { ThreadId, Session, Agent } from '@/types/api';`
  - `import { ThreadId, ApiErrorResponse } from '@/types/api';`

### Pattern 3: From @/lib/validation/schemas (TYPE SHADOWING - needs fix)
- Files: 1 occurrence
- Problem: `export type ThreadId = z.infer<typeof ThreadIdSchema>;` shadows core ThreadId

### Pattern 4: From @/lib/core-types-import (REDUNDANT - needs removal)
- Files: 2 occurrences
- Examples:
  - `export type { ThreadEvent, Thread, ThreadId, AssigneeId } from '~/threads/types';`

## ApprovalDecision Import Patterns

### Pattern 1: From @/types/api (DUPLICATE - needs fix)
- Files: 7 occurrences
- Problem: Local redefinition instead of core import
- Code: `export const ApprovalDecision = { ALLOW_ONCE: 'allow_once', ... }`

### Pattern 2: From @/lib/server/core-types (GOOD - should be standard)  
- Files: 2 occurrences
- Examples:
  - `export { ApprovalDecision } from '~/tools/approval-types';`

## Core Type Import Patterns

### Pattern 1: From @/lib/server/core-types (GOOD)
- Most common pattern for server-side code
- Properly imports from core via `~/` aliases

### Pattern 2: From @/lib/core-types-import (REDUNDANT)
- Unnecessary wrapper file
- Should be consolidated

### Pattern 3: From @/types/api (MIXED - needs cleanup)
- Contains mix of core re-exports and web-specific types
- Causes confusion about source of truth

## Problem Summary

1. **4 different import paths** for same core types:
   - @/lib/server/core-types (correct)
   - @/types/api (duplicate)
   - @/lib/validation/schemas (shadowing)
   - @/lib/core-types-import (redundant)

2. **Type shadowing**:
   - ThreadId redefined in validation schemas
   - ApprovalDecision redefined in api types

3. **Import inconsistency**:
   - Same type imported from different paths in different files
   - No clear convention for web package

## Cleanup Plan

1. Create unified @/lib/core for all core type imports
2. Create clean @/types/web for web-specific types only
3. Remove duplicate definitions
4. Migrate all imports to consistent paths
5. Remove redundant import files

## Files Requiring Migration

### High Priority (Many ThreadId usages)
- packages/web/types/api.ts (18+ occurrences)
- packages/web/app/api/sessions/[sessionId]/agents/route.test.ts (30+ occurrences)
- packages/web/components/pages/LaceApp.tsx (7 occurrences)
- packages/web/hooks/useSessionAPI.test.ts (15+ occurrences)

### Medium Priority (Core functionality)
- All API route handlers
- All component test files
- All hook implementations

### Low Priority (Stories and isolated tests)
- Storybook stories
- E2E tests
- Isolated component tests

This audit provides the baseline for systematic migration to the new unified type structure.