# Task Management UI Implementation Plan

## Overview
This document outlines the implementation of two key improvements to the task management system:

1. **Safe Internal Tool Annotation System** - Mark task tools as never needing user approval
2. **Custom Task Tool Renderers** - Replace generic JSON output with clean, readable UI components

## Context Reading

Before starting, read these documents to understand the codebase:
- `docs/architecture.md` - Overall system architecture
- `docs/development.md` - Development setup and workflow
- `docs/design/tools.md` - Tool system design and patterns
- `docs/coding.md` - Code style and quality standards

## Current System Analysis

### Tool Approval Flow
- **Location**: `src/tools/policy-wrapper.ts`
- **How it works**: Global policy wrapper checks CLI options, then delegates to interface callback
- **Current annotations**: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
- **Decision flow**: Session cache → disabled checks → guardrails → auto-approve → tool hints → user prompt

### Tool Renderer System
- **Location**: `src/interfaces/terminal/components/events/tool-renderers/`
- **Pattern**: Each tool has optional custom renderer (e.g., `BashToolRenderer.tsx`)
- **Discovery**: `getToolRenderer.ts` uses naming convention to find renderers
- **Fallback**: `GenericToolRenderer.tsx` shows raw JSON with `[GENERIC]` indicator
- **Base Component**: All renderers use `TimelineEntry` component with status indicators

### Task Management Tools
- **Location**: `src/tools/implementations/task-manager/tools.ts`
- **Tools**: `TaskCreateTool`, `TaskListTool`, `TaskViewTool`, `TaskUpdateTool`, `TaskAddNoteTool`, `TaskCompleteTool`
- **Output**: Currently uses generic JSON rendering
- **Formatter**: `formatter.ts` has CLI-friendly formatting utilities

## Implementation Tasks

### Task 1: Add Safe Internal Tool Annotation System

**Goal**: Enable tools to bypass all approval prompts

**Files to modify**:
- `src/tools/types.ts` - Add `safeInternal` to `ToolAnnotations`
- `src/tools/policy-wrapper.ts` - Add safe internal check
- `src/tools/implementations/task-manager/tools.ts` - Add annotation to all task tools

**TDD Steps**:
1. Write failing test that verifies `safeInternal` annotation bypasses approval
2. Add `safeInternal?: boolean` to `ToolAnnotations` interface
3. Run test to confirm it fails
4. Add safe internal check to policy wrapper (step 1.5 in decision flow)
5. Run test to confirm it passes
6. Add `safeInternal: true` to all task management tool classes

**Test file**: `src/tools/__tests__/policy-wrapper.test.ts`

**Implementation details**:
```typescript
// In src/tools/types.ts
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  safeInternal?: boolean;  // NEW: Always approved, never needs user consent
}

// In src/tools/policy-wrapper.ts (add after step 1, before step 2)
// 1.5. Check if tool is marked as safe internal
const tool = toolExecutor.getTool(toolName);
if (tool?.annotations?.safeInternal === true) {
  return ApprovalDecision.ALLOW_ONCE;
}

// In each task tool class
annotations = {
  safeInternal: true,
};
```

**Commit**: `feat: add safe internal tool annotation system`

### Task 2: Create Task Add Renderer

**Goal**: Replace generic JSON with detailed task creation confirmation

**Files to create**:
- `src/interfaces/terminal/components/events/tool-renderers/TaskAddToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/TaskAddToolRenderer.test.tsx`

**Design specification**:
```
✓ task_add: Created task "Test task management suite"
  → task_20250705_b9qers [high priority]
  → assigned to: new:anthropic/claude-3-5-sonnet
  → prompt: Systematically test all task management tools...
```

**TDD Steps**:
1. Write failing test for successful task creation rendering
2. Create `TaskAddToolRenderer.tsx` with minimal implementation
3. Run test to confirm it fails
4. Implement detailed success rendering
5. Run test to confirm it passes
6. Add test for error handling
7. Implement error rendering
8. Add test for optional fields (assignedTo, description)

**Test patterns**: Follow `BashToolRenderer.test.tsx` structure using `ink-testing-library`

**Implementation details**:
- Parse task creation arguments from `item.call.arguments`
- Extract task ID from result content
- Show priority with color coding
- Show assignee if provided
- Show truncated prompt (max 80 characters)
- Handle creation errors gracefully

**Commit**: `feat: add TaskAddToolRenderer with detailed creation confirmation`

### Task 3: Create Task List Renderer

**Goal**: Replace generic JSON with compact, readable task list

**Files to create**:
- `src/interfaces/terminal/components/events/tool-renderers/TaskListToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/TaskListToolRenderer.test.tsx`

**Design specification**:
```
✓ task_list: 3 tasks found (filter: thread)
  ○ task_20250705_b9qers [high] Test task management suite
  ◐ task_20250705_wpd92m [medium] Create sample bug fix task  
  ⊗ task_20250705_xyz123 [low] Blocked dependency task
```

**TDD Steps**:
1. Write failing test for task list rendering
2. Create `TaskListToolRenderer.tsx` with minimal implementation
3. Run test to confirm it fails
4. Implement compact list rendering
5. Run test to confirm it passes
6. Add tests for empty list, single task, different statuses
7. Implement status icons: ○ pending, ◐ in_progress, ✓ completed, ⊗ blocked
8. Add priority color coding

**Status icons mapping**:
- `pending`: ○
- `in_progress`: ◐  
- `completed`: ✓
- `blocked`: ⊗

**Implementation details**:
- Parse task list from result content
- Extract filter parameters from arguments
- Show task count and filter type
- Use consistent status icons
- Truncate long titles (max 50 characters)
- Handle "No tasks found" case

**Commit**: `feat: add TaskListToolRenderer with compact list display`

### Task 4: Create Task View Renderer

**Goal**: Replace generic JSON with clean, detailed task view

**Files to create**:
- `src/interfaces/terminal/components/events/tool-renderers/TaskViewToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/TaskViewToolRenderer.test.tsx`

**Design specification**:
```
✓ task_view: task_20250705_b9qers
  
  Test task management suite [high] ○ pending
  
  Description: Testing the upgraded task management system
  
  Prompt: Systematically test all task management tools...
  
  Notes (1):
    • [lace_20250705_2opxkw] 7/5/2025, 9:07:10 AM
      Started investigation - checking current timeout
```

**TDD Steps**:
1. Write failing test for task view rendering
2. Create `TaskViewToolRenderer.tsx` with minimal implementation
3. Run test to confirm it fails
4. Implement clean list layout
5. Run test to confirm it passes
6. Add tests for task without description, without notes
7. Implement optional sections (description, notes)
8. Add test for long content truncation

**Implementation details**:
- Parse task details from result content
- Show title, priority, and status on one line
- Skip "Created by" line per specification
- Show description if present
- Show prompt (truncate if very long)
- Format notes with bullet points and timestamps
- Handle tasks without optional fields

**Commit**: `feat: add TaskViewToolRenderer with clean detailed view`

### Task 5: Create Task Update Renderer

**Goal**: Replace generic JSON with detailed change summary

**Files to create**:
- `src/interfaces/terminal/components/events/tool-renderers/TaskUpdateToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/TaskUpdateToolRenderer.test.tsx`

**Design specification**:
```
✓ task_update: Updated task "Create sample bug fix task"
  • Status changed: pending → in_progress
  • Description updated
```

**TDD Steps**:
1. Write failing test for task update rendering
2. Create `TaskUpdateToolRenderer.tsx` with minimal implementation
3. Run test to confirm it fails
4. Implement detailed change summary
5. Run test to confirm it passes
6. Add tests for different update types (status, priority, assignee)
7. Implement change detection from arguments
8. Add test for multiple simultaneous updates

**Implementation details**:
- Parse update arguments to detect changes
- Show task title from result content
- List specific changes with bullet points
- Handle status changes with before/after display
- Show priority, assignee, and field updates
- Skip "last modified" timestamp per specification

**Commit**: `feat: add TaskUpdateToolRenderer with detailed change summary`

### Task 6: Create Task Note Renderer

**Goal**: Replace generic JSON with note preview

**Files to create**:
- `src/interfaces/terminal/components/events/tool-renderers/TaskAddNoteToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/TaskAddNoteToolRenderer.test.tsx`

**Design specification**:
```
✓ task_add_note: Added note to task_20250705_wpd92m
  💬 "Started investigation - checking current timeout..."
```

**TDD Steps**:
1. Write failing test for note addition rendering
2. Create `TaskAddNoteToolRenderer.tsx` with minimal implementation
3. Run test to confirm it fails
4. Implement note preview display
5. Run test to confirm it passes
6. Add test for long note truncation
7. Implement note content extraction and truncation
8. Add test for special characters in notes

**Implementation details**:
- Parse note content from arguments
- Extract task ID from arguments
- Show note content with speech bubble emoji
- Truncate long notes (max 100 characters)
- Handle special characters and newlines
- Show confirmation message

**Commit**: `feat: add TaskAddNoteToolRenderer with note preview`

### Task 7: Create Task Complete Renderer

**Goal**: Replace generic JSON with simple success confirmation

**Files to create**:
- `src/interfaces/terminal/components/events/tool-renderers/TaskCompleteToolRenderer.tsx`
- `src/interfaces/terminal/components/events/tool-renderers/TaskCompleteToolRenderer.test.tsx`

**Design specification**:
```
✓ task_complete: task_20250705_b9qers completed
```

**TDD Steps**:
1. Write failing test for task completion rendering
2. Create `TaskCompleteToolRenderer.tsx` with minimal implementation
3. Run test to confirm it fails
4. Implement simple success message
5. Run test to confirm it passes
6. Add test for error handling
7. Implement error case rendering
8. Add test for already completed tasks

**Implementation details**:
- Parse task ID from arguments
- Extract task title from result content
- Show simple completion confirmation
- Handle completion errors gracefully
- Use consistent success icon (✓)
- Keep message brief per specification

**Commit**: `feat: add TaskCompleteToolRenderer with simple success confirmation`

### Task 8: Integration and Testing

**Goal**: Ensure all renderers work together and follow patterns

**Files to verify**:
- `src/interfaces/terminal/components/events/tool-renderers/getToolRenderer.ts`
- Test all renderers with real task operations
- Verify consistent styling and behavior

**Integration tests**:
1. Test tool renderer discovery for all task tools
2. Test fallback to generic renderer if custom renderer fails
3. Test error boundaries and graceful degradation
4. Test consistent status icons and color coding
5. Test expandable/collapsible behavior

**Manual testing**:
```bash
# Test the task management suite
npm run build
npm run lace -- --help

# Create and manipulate tasks to verify rendering
```

**Commit**: `test: add integration tests for task tool renderers`

## Technical Requirements

### Dependencies
- React and Ink for UI components
- `TimelineEntry` component for consistent styling
- `ink-testing-library` for component testing
- Existing task management system

### Code Quality
- Follow existing patterns in `BashToolRenderer.tsx`
- Use TypeScript strict mode
- Handle errors gracefully with fallback to generic renderer
- Maintain consistent spacing and color coding
- Follow TDD approach strictly

### Testing Strategy
- Unit tests for each renderer component
- Integration tests for tool discovery
- Error handling tests for malformed data
- Visual regression tests for UI consistency
- Test with real task operations

### Performance Considerations
- Avoid heavy computations in render methods
- Use React.memo for expensive components
- Minimize re-renders with proper dependencies
- Handle large task lists efficiently

## Success Criteria

1. **Safe Internal Tools**: All task management tools execute without approval prompts
2. **Custom Renderers**: All task tools show custom UI instead of generic JSON
3. **Consistent Design**: All renderers follow the same visual patterns
4. **Error Handling**: Graceful degradation when renderers fail
5. **Test Coverage**: >90% code coverage for all new components
6. **Performance**: No noticeable impact on terminal responsiveness

## Rollback Plan

If issues arise:
1. Disable custom renderers by removing them from `getToolRenderer.ts`
2. Revert to generic JSON rendering
3. Fix issues and re-enable gradually
4. Safe internal annotation can be disabled via CLI option

## Future Enhancements

1. **Interactive Elements**: Add cursor navigation for task lists
2. **Export Capabilities**: Allow exporting rendered output
3. **Theme Support**: Add color scheme customization
4. **Accessibility**: Screen reader support and keyboard navigation
5. **Performance**: Virtualization for large task lists

This plan provides a complete, step-by-step implementation guide following TDD principles with frequent commits and thorough testing.