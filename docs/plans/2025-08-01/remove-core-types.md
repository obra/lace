# Remove core-types.ts Migration Plan

## Step 1: Add missing type to core.ts
- Add `TaskFilters` export to `packages/web/types/core.ts`

## Step 2: Remove duplicate TaskFilters from task-api.ts
- Delete `TaskFilters` interface from `packages/web/lib/client/task-api.ts` (lines 6-11)
- Update import in `packages/web/lib/client/task-api.ts` to include `TaskFilters` from `@/types/core`

## Step 3: Update hooks to use core TaskFilters
- Update import in `packages/web/hooks/useTaskManager.ts` from `@/lib/client/task-api` to include `TaskFilters` from `@/types/core`

## Step 4: Update API routes (10 files)
- `packages/web/app/api/providers/route.ts`
- `packages/web/app/api/providers/route.test.ts`
- `packages/web/app/api/threads/[threadId]/message/route.ts`
- `packages/web/app/api/threads/[threadId]/message/route.test.ts`
- `packages/web/app/api/sessions/[sessionId]/history/route.ts`
- `packages/web/app/api/sessions/[sessionId]/history/route.test.ts`
- `packages/web/app/api/sessions/[sessionId]/agents/route.ts`
- `packages/web/app/api/sessions/[sessionId]/configuration/route.ts`
- `packages/web/app/api/agents/[agentId]/route.ts`
- `packages/web/app/api/projects/[projectId]/sessions/[sessionId]/tasks/route.ts`

## Step 5: Update server-side code (3 files)
- `packages/web/lib/server/session-service.ts`
- `packages/web/lib/server/agent-utils.ts`
- `packages/web/lib/server/agent-utils.test.ts`

## Step 6: Update test files (10 files)
- `packages/web/e2e/api-endpoints.test.ts`
- `packages/web/e2e/sse-integration.test.ts`
- `packages/web/lib/type-integrity.test.ts`
- `packages/web/lib/timeline-converter.test.ts`
- `packages/web/lib/client/task-api.test.ts`
- `packages/web/lib/server/session-spawn-agent.test.ts`
- `packages/web/app/tool-approval-flow-new.test.ts`
- `packages/web/app/api/sessions/[sessionId]/route.test.ts`
- `packages/web/hooks/useTaskManager.test.tsx`
- `packages/web/components/TaskBoardModal.test.tsx`
- `packages/web/components/modals/__tests__/TaskBoardModal.test.tsx`

## Step 7: Update component files (6 files)
- `packages/web/hooks/useHashRouter.ts`
- `packages/web/components/pages/AnimatedLaceApp.tsx`
- `packages/web/components/pages/AnimatedLaceApp.stories.tsx`
- `packages/web/components/layout/Sidebar.stories.tsx`
- `packages/web/components/layout/MobileSidebar.stories.tsx`
- `packages/web/components/modals/TaskBoardModal.stories.tsx`

## Step 8: Delete core-types.ts
- Delete `packages/web/lib/server/core-types.ts`

All imports change from `@/lib/server/core-types` to `@/types/core`