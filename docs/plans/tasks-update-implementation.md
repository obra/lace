# Task Management Tool Renderers Implementation Plan

## Overview
This document outlines the comprehensive implementation plan for adding custom terminal UI renderers for task management tools and implementing the safe internal tool annotation system.

## Goals
1. Replace generic JSON output with clean, readable formatting for all task management tools
2. Implement safe internal tool annotation system to bypass approval prompts for task tools
3. Follow existing codebase patterns and maintain consistency with current architecture
4. Ensure comprehensive test coverage using TDD approach

## Current Architecture Analysis

### Tool System Architecture
- **Base Tool Class**: `src/tools/tool.ts` - provides schema validation and result formatting
- **Tool Types**: `src/tools/types.ts` - defines interfaces for tool calls, results, and annotations
- **Task Tools**: `src/tools/implementations/task-manager/` - existing task management tools
- **Tool Renderers**: `src/interfaces/terminal/components/events/tool-renderers/` - custom rendering components

### Existing Patterns
- **Tool Renderers**: React components that render tool execution results with custom formatting
- **Test Structure**: React component tests using `ink-testing-library` with provider wrappers
- **Result Formatting**: Tools return `ToolResult` objects with `content`, `isError`, and optional `metadata`
- **Safe Internal Pattern**: Uses `safeInternal: true` annotation (found in test data)

## Implementation Steps

### Phase 1: Add Safe Internal Tool Annotation System

#### 1.1 Update Tool Type System
- **File**: `src/tools/types.ts`
- **Changes**: Add `safeInternal?: boolean` to `ToolAnnotations` interface
- **Purpose**: Enable tools to bypass approval prompts

#### 1.2 Update Task Management Tools
- **Files**: All task management tool implementations
  - `src/tools/implementations/task-manager/task-add.ts`
  - `src/tools/implementations/task-manager/task-list.ts`
  - `src/tools/implementations/task-manager/task-view.ts`
  - `src/tools/implementations/task-manager/task-update.ts`
  - `src/tools/implementations/task-manager/task-add-note.ts`
  - `src/tools/implementations/task-manager/task-complete.ts`
- **Changes**: Add `annotations: { safeInternal: true }` to each tool class
- **Purpose**: Mark all task tools as safe internal to bypass approval

#### 1.3 Update Tool Processing Logic
- **Files**: Need to identify where tool approval logic exists
- **Changes**: Check for `safeInternal` annotation and skip approval prompts
- **Purpose**: Implement the safe internal behavior

### Phase 2: Implement Task Tool Renderers

#### 2.1 Create Base Task Renderer Components
- **File**: `src/interfaces/terminal/components/events/tool-renderers/TaskToolRenderer.tsx`
- **Purpose**: Shared component for common task rendering patterns
- **Features**:
  - Status indicators (✔, ✘, ⧖)
  - Consistent formatting utilities
  - Error handling patterns

#### 2.2 Create Individual Tool Renderers
Following the existing pattern in `tool-renderers/` directory:

##### 2.2.1 TaskAddRenderer.tsx
- **Input**: `task_add` call arguments (title, prompt, priority, etc.)
- **Output**: Clean form-like display with task creation confirmation
- **Design**: 
  ```
  ✔ task_add: Create new task
  📋 "Fix user authentication bug"
  📝 Investigate and fix the login issue where users...
  🔥 Priority: high
  👤 Assigned to: current thread
  ```

##### 2.2.2 TaskListRenderer.tsx
- **Input**: `task_list` call arguments and result
- **Output**: Formatted table/list of tasks
- **Design**:
  ```
  ✔ task_list: Found 3 tasks
  
  📋 Active Tasks
  ──────────────
  #abc123 🔥 Fix auth bug (assigned to thread-456)
  #def456 📝 Add tests (assigned to current)
  #ghi789 ⚡ Refactor code (assigned to thread-789)
  ```

##### 2.2.3 TaskViewRenderer.tsx
- **Input**: `task_view` call arguments and result
- **Output**: Detailed task information display
- **Design**:
  ```
  ✔ task_view: Task details
  
  📋 Task #abc123: Fix user authentication bug
  ├─ Status: in_progress
  ├─ Priority: high  
  ├─ Created: 2024-01-15 10:30 AM
  ├─ Assigned: thread-456
  └─ Description: Investigate and fix the login issue...
  
  📝 Notes:
  • Initial investigation shows JWT token issue
  • Need to check token expiration logic
  ```

##### 2.2.4 TaskUpdateRenderer.tsx
- **Input**: `task_update` call arguments
- **Output**: Clean confirmation of what was updated
- **Design**:
  ```
  ✔ task_update: Updated task #abc123
  📝 Status: pending → in_progress
  🔥 Priority: medium → high
  👤 Assigned to: thread-456
  ```

##### 2.2.5 TaskAddNoteRenderer.tsx
- **Input**: `task_add_note` call arguments
- **Output**: Note addition confirmation
- **Design**:
  ```
  ✔ task_add_note: Added note to task #abc123
  💬 "Found the root cause in auth middleware"
  ```

##### 2.2.6 TaskCompleteRenderer.tsx
- **Input**: `task_complete` call arguments
- **Output**: Task completion confirmation
- **Design**:
  ```
  ✔ task_complete: Completed task #abc123
  🎉 "Fix user authentication bug" - DONE
  ```

#### 2.3 Update Tool Renderer Registry
- **File**: `src/interfaces/terminal/components/events/tool-renderers/index.ts`
- **Changes**: Add exports for all new task tool renderers
- **Purpose**: Make renderers available to the rendering system

#### 2.4 Update Main Tool Renderer
- **File**: Location TBD (need to find where tool renderer selection happens)
- **Changes**: Add mapping from tool names to custom renderers
- **Purpose**: Route task tools to custom renderers instead of generic JSON

### Phase 3: Comprehensive Testing

#### 3.1 Tool Annotation Tests
- **Files**: Add tests to existing tool test files
- **Purpose**: Verify `safeInternal` annotation is properly set
- **Pattern**: Follow existing tool test patterns

#### 3.2 Renderer Component Tests
Following the pattern from `BashToolRenderer.test.tsx`:

##### 3.2.1 TaskAddRenderer.test.tsx
- Test successful task creation display
- Test error handling for invalid inputs
- Test different priority levels
- Test with/without optional fields

##### 3.2.2 TaskListRenderer.test.tsx
- Test empty task list display
- Test single task display
- Test multiple tasks with different statuses
- Test filtered results
- Test pagination if applicable

##### 3.2.3 TaskViewRenderer.test.tsx
- Test complete task details display
- Test task with notes
- Test task without notes
- Test different task statuses
- Test error handling for non-existent tasks

##### 3.2.4 TaskUpdateRenderer.test.tsx
- Test single field updates
- Test multiple field updates
- Test status change rendering
- Test assignment changes

##### 3.2.5 TaskAddNoteRenderer.test.tsx
- Test note addition display
- Test long note truncation if needed
- Test special characters in notes

##### 3.2.6 TaskCompleteRenderer.test.tsx
- Test task completion confirmation
- Test completion of different task types
- Test error handling for already completed tasks

#### 3.3 Integration Tests
- **Purpose**: Ensure tool renderers work with actual tool execution
- **Scope**: Test full tool execution → rendering pipeline
- **Files**: Add to existing integration test suites

#### 3.4 Safe Internal Tool Tests
- **Purpose**: Verify safe internal tools bypass approval prompts
- **Scope**: Test tool execution flow with safe internal annotation
- **Files**: Add to existing tool execution test suites

## Implementation Order

### TDD Approach
For each component, follow strict TDD:
1. Write failing test that validates the desired rendering output
2. Run test to confirm it fails as expected
3. Write minimal code to make test pass
4. Run test to confirm success
5. Refactor if needed while keeping tests green

### Recommended Implementation Order
1. **Phase 1.1**: Update `ToolAnnotations` interface
2. **Phase 1.2**: Add `safeInternal` annotation to all task tools
3. **Phase 1.3**: Implement safe internal logic in tool processing
4. **Phase 2.1**: Create base `TaskToolRenderer` component
5. **Phase 2.2**: Implement individual renderers (start with `TaskAddRenderer`)
6. **Phase 2.3-2.4**: Update renderer registry and routing
7. **Phase 3**: Add comprehensive tests for all components

## Technical Considerations

### Error Handling
- Follow existing error handling patterns from other tool renderers
- Display user-friendly error messages
- Handle malformed tool results gracefully
- Provide fallback to generic renderer if custom renderer fails

### Performance
- Minimize re-renders in React components
- Use React.memo for expensive renderers if needed
- Avoid heavy computations in render methods

### Accessibility
- Use semantic text formatting for screen readers
- Ensure color contrast meets accessibility standards
- Provide text alternatives for emoji/symbols

### Internationalization
- Use text constants for all user-facing strings
- Prepare for future i18n implementation
- Avoid hardcoded English text in components

## Testing Strategy

### Unit Tests
- Test each renderer component in isolation
- Test with various input scenarios
- Test error conditions and edge cases
- Use snapshot testing for complex output

### Integration Tests
- Test tool execution with custom renderers
- Test renderer selection logic
- Test safe internal tool bypass behavior

### Visual Tests
- Manual testing of terminal output
- Screenshot testing if applicable
- Cross-platform terminal compatibility

## Deliverables

1. **Updated Type System**: `ToolAnnotations` interface with `safeInternal` support
2. **Annotated Task Tools**: All task management tools marked as safe internal
3. **Tool Renderer Components**: Six custom renderers for task management tools
4. **Updated Renderer Registry**: Integration with existing tool rendering system
5. **Comprehensive Test Suite**: Full test coverage for all new components
6. **Documentation**: Updated README sections for new renderer system

## Success Criteria

1. All task management tools display clean, readable output instead of JSON
2. Task tools bypass approval prompts when executed
3. All tests pass with >90% code coverage
4. Terminal output matches design specifications exactly
5. No regression in existing tool functionality
6. Performance impact is minimal (<10ms additional render time)

## Risk Mitigation

### Technical Risks
- **Renderer Selection Logic**: Ensure proper fallback to generic renderer
- **React Component Performance**: Profile and optimize heavy renderers
- **Terminal Compatibility**: Test across different terminal environments

### Implementation Risks
- **Breaking Changes**: Maintain backward compatibility with existing tools
- **Test Coverage**: Ensure comprehensive test coverage before deployment
- **Code Quality**: Follow existing code patterns and maintain consistency

## Future Enhancements

1. **Configurable Rendering**: Allow users to toggle between custom and JSON output
2. **Theme Support**: Add support for different terminal color schemes
3. **Interactive Elements**: Add cursor navigation for task lists
4. **Export Capabilities**: Allow exporting rendered output to files
5. **Plugin System**: Enable third-party renderer plugins

## Dependencies

- React and Ink for component rendering
- Existing tool system architecture
- Terminal interface infrastructure
- Test utilities and framework
- Zod for schema validation (existing)

This implementation plan provides a comprehensive roadmap for implementing task management tool renderers while maintaining code quality, test coverage, and architectural consistency.