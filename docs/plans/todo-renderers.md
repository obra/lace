# Task Management Tool Renderers Implementation Plan

## Overview

This plan implements custom terminal UI renderers for task management tools to replace the generic JSON renderer with clean, readable output. The task management tools are internal-only operations that should be marked as safe (no user approval required).

## Prerequisites

Read these docs first:
- `docs/design/tools.md` - Tool system architecture
- `docs/coding.md` - Code style and standards
- `docs/development.md` - Development workflow
- `docs/architecture.md` - System architecture

## Key Files to Understand

### Tool Renderer System
- `src/cli/components/tool-renderer/` - Main renderer components
- `src/cli/components/tool-renderer/ToolRenderer.tsx` - Entry point that routes to specific renderers
- `src/cli/components/tool-renderer/GenericToolRenderer.tsx` - Default fallback renderer
- `src/cli/components/tool-renderer/TimelineEntry.tsx` - Base component for all tool outputs

### Task Management Tools
- `src/tools/implementations/task-manager/` - All task tool implementations
- `src/tools/implementations/task-manager/formatter.ts` - Existing task formatting utilities
- `src/tools/tool.ts` - Tool interface definitions and annotations

### Configuration
- `src/tools/policy-wrapper.ts` - Tool approval system
- `src/cli/options.ts` - CLI configuration options

## Design Specifications

### Task Add Renderer
```
✓ task_add: Created task "Test task management suite"
  → task_20250705_b9qers [high priority]
  → assigned to: new:anthropic/claude-3-5-sonnet
  
  Prompt: Systematically test all task management tools and report back
  with findings on functionality and user experience.
```

### Task List Renderer
```
✓ task_list: 3 tasks found (filter: thread)
  ○ task_20250705_b9qers [high] Test task management suite
  ◐ task_20250705_wpd92m [medium] Create sample bug fix task  
  ⊗ task_20250705_xyz123 [low] Blocked dependency task
```

### Task View Renderer
```
✓ task_view: task_20250705_b9qers
  
  Test task management suite [high] ○ pending
  
  Description: Testing the upgraded task management system
  
  Prompt: Systematically test all task management tools...
  
  Notes (1):
    • [lace_20250705_2opxkw] 7/5/2025, 9:07:10 AM
      Started investigation - checking current timeout
```

### Task Update Renderer
```
✓ task_update: Updated task "Create sample bug fix task"
  • Status changed: pending → in_progress
  • Description updated
```

### Task Add Note Renderer
```
✓ task_add_note: Added note to task_20250705_wpd92m
  💬 "Started investigation - checking current timeout..."
```

### Task Complete Renderer
```
✓ task_complete: task_20250705_b9qers completed
```

## Implementation Tasks

### Task 1: Add Safe Internal Tool Annotation
**Goal:** Mark task tools as never needing user approval

**Files:**
- `src/tools/tool.ts` - Add `safeInternal` to `ToolAnnotations` interface
- `src/tools/policy-wrapper.ts` - Add approval bypass logic
- `src/cli/options.ts` - Add `allowSafeInternalTools` option (default true)

**Implementation:**
1. Write failing test for safe internal tool bypass
2. Add `safeInternal?: boolean` to `ToolAnnotations` interface
3. Add logic to policy wrapper to check annotation and skip approval
4. Add CLI option to disable feature if needed

**Test:**
```bash
npm test -- --grep "safe internal tools"
```

**Commit:** `feat: add safe internal tool annotation system`

### Task 2: Create Task Add Renderer
**Goal:** Custom renderer for task_add tool showing creation details and prompt

**Files:**
- `src/cli/components/tool-renderer/TaskAddToolRenderer.tsx` - New renderer component
- `src/cli/components/tool-renderer/ToolRenderer.tsx` - Register new renderer

**Implementation:**
1. Write test for TaskAddToolRenderer component
2. Create component using TimelineEntry wrapper
3. Extract task details from tool result
4. Format with title, ID, priority, assignment, and prompt
5. Register renderer in ToolRenderer mapping

**Test:**
```bash
npm test -- --grep "TaskAddToolRenderer"
```

**Commit:** `feat: add task_add tool renderer`

### Task 3: Create Task List Renderer
**Goal:** Compact list view showing tasks with status icons and priorities

**Files:**
- `src/cli/components/tool-renderer/TaskListToolRenderer.tsx`
- Update `src/cli/components/tool-renderer/ToolRenderer.tsx`

**Implementation:**
1. Write test for TaskListToolRenderer component
2. Create component that formats task list compactly
3. Use status icons: ○ pending, ◐ in_progress, ✓ completed, ⊗ blocked
4. Show priority in brackets: [high], [medium], [low]
5. Include task count and filter info

**Test:**
```bash
npm test -- --grep "TaskListToolRenderer"
```

**Commit:** `feat: add task_list tool renderer`

### Task 4: Create Task View Renderer
**Goal:** Clean detailed view without created line

**Files:**
- `src/cli/components/tool-renderer/TaskViewToolRenderer.tsx`
- Update `src/cli/components/tool-renderer/ToolRenderer.tsx`

**Implementation:**
1. Write test for TaskViewToolRenderer component
2. Create component showing task details cleanly
3. Include title, status, priority, description, prompt
4. Format notes with bullets and timestamps
5. Omit creation timestamp as specified

**Test:**
```bash
npm test -- --grep "TaskViewToolRenderer"
```

**Commit:** `feat: add task_view tool renderer`

### Task 5: Create Task Update Renderer
**Goal:** Show what changed in task update

**Files:**
- `src/cli/components/tool-renderer/TaskUpdateToolRenderer.tsx`
- Update `src/cli/components/tool-renderer/ToolRenderer.tsx`

**Implementation:**
1. Write test for TaskUpdateToolRenderer component
2. Create component that shows changed fields
3. Compare old vs new values where available
4. Format as bullet list of changes
5. Omit last modified timestamp

**Test:**
```bash
npm test -- --grep "TaskUpdateToolRenderer"
```

**Commit:** `feat: add task_update tool renderer`

### Task 6: Create Task Note Renderer
**Goal:** Show the note that was added

**Files:**
- `src/cli/components/tool-renderer/TaskAddNoteToolRenderer.tsx`
- Update `src/cli/components/tool-renderer/ToolRenderer.tsx`

**Implementation:**
1. Write test for TaskAddNoteToolRenderer component
2. Create component that shows note content
3. Include task ID and note preview
4. Use chat/comment emoji for visual indicator

**Test:**
```bash
npm test -- --grep "TaskAddNoteToolRenderer"
```

**Commit:** `feat: add task_add_note tool renderer`

### Task 7: Create Task Complete Renderer
**Goal:** Simple success message

**Files:**
- `src/cli/components/tool-renderer/TaskCompleteToolRenderer.tsx`
- Update `src/cli/components/tool-renderer/ToolRenderer.tsx`

**Implementation:**
1. Write test for TaskCompleteToolRenderer component
2. Create minimal component showing completion
3. Include task ID and confirmation message
4. Keep it simple as specified

**Test:**
```bash
npm test -- --grep "TaskCompleteToolRenderer"
```

**Commit:** `feat: add task_complete tool renderer`

### Task 8: Mark Task Tools as Safe Internal
**Goal:** Apply safe internal annotation to all task management tools

**Files:**
- All files in `src/tools/implementations/task-manager/`

**Implementation:**
1. Add `safeInternal: true` to annotations for all task tools
2. Test that tools no longer require approval
3. Verify in CLI that task operations are seamless

**Test:**
```bash
# Manual test - task operations should not prompt for approval
npm run dev
```

**Commit:** `feat: mark task management tools as safe internal`

### Task 9: Integration Testing
**Goal:** End-to-end testing of all renderers

**Files:**
- `src/cli/components/tool-renderer/__tests__/task-renderers.test.tsx`

**Implementation:**
1. Write integration tests for all task renderers
2. Test with real task tool outputs
3. Verify proper routing from ToolRenderer
4. Test edge cases (empty lists, long content, etc.)

**Test:**
```bash
npm test -- --grep "task renderers integration"
```

**Commit:** `test: add integration tests for task tool renderers`

## Testing Strategy

### Unit Tests
- Each renderer component should have isolated tests
- Mock tool outputs and verify rendered content
- Test edge cases and error states
- Use React Testing Library for component testing

### Integration Tests
- Test renderer routing through ToolRenderer
- Test with actual task tool implementations
- Verify approval bypass works correctly
- Test in actual CLI environment

### Manual Testing
```bash
# Start CLI and test each tool
npm run dev

# In CLI, test each tool type:
# task_add - verify detailed output with prompt
# task_list - verify compact list format
# task_view - verify clean view without created line
# task_update - verify change summary
# task_add_note - verify note display
# task_complete - verify simple success
```

## Development Workflow

1. **Each task = one commit** - Keep changes focused and atomic
2. **TDD required** - Write failing tests before implementation
3. **Test after each change** - Verify nothing breaks
4. **Follow existing patterns** - Study other tool renderers first
5. **Use TypeScript strictly** - No `any` types, proper interfaces

## Key Concepts for React Developers

### Ink Framework
- React-like framework for terminal UIs
- Uses `<Text>`, `<Box>` components instead of HTML
- Styling with props, not CSS
- Study existing renderers for patterns

### Tool System
- Tools are functions that agents can call
- Each tool has input/output types
- Renderers format the output for display
- Tools can be marked with annotations

### Agentic System
- Agents execute tools based on conversation
- Tool outputs are shown in timeline format
- Renderers make outputs human-readable
- Approval system controls tool execution

## Success Criteria

- [ ] All task management tools have custom renderers
- [ ] Task tools marked as safe internal (no approval prompts)
- [ ] Renderers match design specifications exactly
- [ ] All tests pass (unit + integration)
- [ ] Manual testing confirms clean UI
- [ ] Code follows project standards
- [ ] Documentation updated if needed

## Resources

- Ink Documentation: https://github.com/vadimdemedes/ink
- Existing tool renderers in `src/cli/components/tool-renderer/`
- Task formatter utilities in `src/tools/implementations/task-manager/formatter.ts`
- React Testing Library docs for component testing