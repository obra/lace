# Terminal UI Focus System Overhaul Implementation Plan

## Overview

This plan outlines the complete overhaul of the terminal interface focus system, moving from a prop-drilling, manually-managed approach to a clean, context-based focus stack pattern.

## Goals

1. **Eliminate prop drilling** - Remove all focus-related props (`focusId`, `parentFocusId`, `currentFocusId`, `isFocused`)
2. **Centralize focus management** - Use a focus stack pattern with context
3. **Simplify component code** - Components should be self-contained without focus hierarchy knowledge
4. **Clean up dead code** - Remove all redundant focus management code
5. **Maintain Ink compatibility** - Work with Ink's focus system, not against it

## Architecture Overview

```
┌─────────────────────────────────────┐
│      LaceFocusProvider              │
│  ┌─────────────────────────────┐    │
│  │      Focus Stack            │    │
│  │  ['shell-input', 'timeline']│    │
│  └─────────────────────────────┘    │
│                                     │
│  Global Escape Handler              │
│  Wraps Ink's useFocusManager()     │
└─────────────────────────────────────┘
            │
            ├── ShellInput (uses useLaceFocus)
            ├── Timeline (uses useLaceFocus)
            ├── DelegationBox (uses useLaceFocus)
            └── Modals (uses useLaceFocus)
```

## Phase 1: Create Core Infrastructure

### 1.1 Create Focus Stack Implementation
**File**: `src/interfaces/terminal/focus/focus-stack.ts`

```typescript
export class FocusStack {
  private stack: string[] = ['shell-input'];
  
  push(focusId: string): string
  pop(): string | undefined
  current(): string
  clear(): void
  contains(focusId: string): boolean
  size(): number
}
```

### 1.2 Define Focus Regions
**File**: `src/interfaces/terminal/focus/focus-regions.ts`

```typescript
export const FocusRegions = {
  shell: 'shell-input',
  timeline: 'timeline',
  modal: (type: string) => `modal-${type}`,
  delegate: (threadId: string) => `delegate-${threadId}`,
  autocomplete: 'autocomplete',
} as const;
```

### 1.3 Create Focus Context and Provider
**File**: `src/interfaces/terminal/focus/focus-provider.tsx`

- Create `LaceFocusContext` with focus stack state
- Implement `LaceFocusProvider` component
- Add global escape key handler
- Wrap Ink's `useFocusManager`

### 1.4 Create Custom Focus Hook
**File**: `src/interfaces/terminal/focus/use-lace-focus.ts`

```typescript
export function useLaceFocus(
  id: string, 
  options?: { autoFocus?: boolean }
): {
  isFocused: boolean;
  takeFocus: () => void;
}
```

### 1.5 Create Modal Wrapper
**File**: `src/interfaces/terminal/focus/modal-wrapper.tsx`

- Auto-push/pop focus for modal lifecycle
- Handle cleanup on unmount

## Phase 2: Update Core Components

### 2.1 Update TerminalInterface
**File**: `src/interfaces/terminal/terminal-interface.tsx`

- Wrap with `LaceFocusProvider`
- Remove focus management code (lines 213-252)
- Remove `focusNext` usage (line 245)
- Remove hardcoded `focus('shell-input')` (line 275)
- Keep `disableFocus()` call

### 2.2 Update ShellInput
**File**: `src/interfaces/terminal/components/shell-input.tsx`

- Remove `focusId` prop (lines 67, 78)
- Replace with `useLaceFocus(FocusRegions.shell)`
- Remove complex focus handling logic (lines 84-95)
- Update autocomplete to use focus stack

### 2.3 Update TimelineViewport
**File**: `src/interfaces/terminal/components/events/TimelineViewport.tsx`

- Remove all focus props (lines 13-14, 35-36, 41)
- Remove escape key handling (lines 81-97)
- Replace with `useLaceFocus`
- Remove hardcoded focus calls

### 2.4 Update TimelineDisplay
**File**: `src/interfaces/terminal/components/events/TimelineDisplay.tsx`

- Remove all focus props (lines 13-14, 20-21, 24)
- Remove prop passing to TimelineViewport (lines 44-46, 56)
- Simplify to just pass timeline data

### 2.5 Update DelegationBox
**File**: `src/interfaces/terminal/components/events/DelegationBox.tsx`

- Remove `parentFocusId` prop (line 15)
- Use dynamic focus ID with `useLaceFocus(FocusRegions.delegate(threadId))`
- Add `takeFocus()` when expanding

### 2.6 Update FileAutocomplete
**File**: `src/interfaces/terminal/components/file-autocomplete.tsx`

- Remove `focusId` prop (lines 12, 23, 28, 34, 36)
- Remove escape handling (lines 43-48)
- Remove hardcoded focus calls (lines 45, 54)
- Use `useLaceFocus` with auto-focus when visible

### 2.7 Update ToolApprovalModal
**File**: `src/interfaces/terminal/components/tool-approval-modal.tsx`

- Wrap with `ModalWrapper`
- Use `useLaceFocus` for focus management
- Remove manual focus handling

## Phase 3: Clean Up Downstream Components

### 3.1 Update TimelineContent
**File**: `src/interfaces/terminal/components/events/TimelineContent.tsx`

- Remove `currentFocusId` prop (lines 24, 32, 57)
- Remove focus prop passing to child components

### 3.2 Update TimelineItem
**File**: `src/interfaces/terminal/components/events/TimelineItem.tsx`

- Remove `currentFocusId` prop (lines 26, 119)
- Remove `isFocused` prop (lines 21, 31, 53, etc.)
- Focus state now comes from context if needed

### 3.3 Update EventDisplay
**File**: `src/interfaces/terminal/components/events/EventDisplay.tsx`

- Remove `isFocused` prop (lines 18, 28, 62-63)
- Simplify rendering logic

### 3.4 Update Tool Renderers
**Files**: Various files in `src/interfaces/terminal/components/events/tool-renderers/`

- Remove `isFocused` props from all renderers
- Update DelegateToolRenderer to not pass `parentFocusId`

## Phase 4: Testing Updates

### 4.1 Update Component Tests
- Remove focus-related prop mocking
- Add focus context wrapper for tests
- Update test assertions for new behavior

### 4.2 Create Focus System Tests
**File**: `src/interfaces/terminal/focus/__tests__/focus-stack.test.ts`
**File**: `src/interfaces/terminal/focus/__tests__/focus-provider.test.tsx`

- Test focus stack operations
- Test context provider behavior
- Test escape key handling
- Test modal focus restoration

## Phase 5: Code Cleanup

### 5.1 Remove Dead Code
Based on the analysis, remove:

1. **Props**: All `focusId`, `parentFocusId`, `currentFocusId`, `isFocused` props
2. **Escape handlers**: Individual component escape key handlers
3. **Focus calls**: Hardcoded `focus('shell-input')` and similar
4. **Complex logic**: Manual focus hierarchy management
5. **Prop drilling**: All focus prop passing through component trees

### 5.2 Update TypeScript Interfaces
- Remove focus-related props from component interfaces
- Update test mocks and stubs

### 5.3 Lint and Format
- Run ESLint with auto-fix
- Run Prettier
- Ensure no unused imports remain

## Phase 6: Documentation

### 6.1 Create Design Document
**File**: `docs/design/terminal-ui-focus.md`
- Document the new focus system architecture
- Explain the focus stack pattern
- Provide usage examples

### 6.2 Update Component Documentation
- Update TSDoc comments to reflect new focus behavior
- Remove references to old focus props

## Migration Checklist

- [ ] Phase 1: Core Infrastructure (4-6 hours)
  - [ ] Focus stack implementation
  - [ ] Focus regions constants
  - [ ] Context and provider
  - [ ] Custom hook
  - [ ] Modal wrapper

- [ ] Phase 2: Core Components (6-8 hours)
  - [ ] TerminalInterface
  - [ ] ShellInput
  - [ ] TimelineViewport
  - [ ] TimelineDisplay
  - [ ] DelegationBox
  - [ ] FileAutocomplete
  - [ ] ToolApprovalModal

- [ ] Phase 3: Downstream Components (3-4 hours)
  - [ ] TimelineContent
  - [ ] TimelineItem
  - [ ] EventDisplay
  - [ ] Tool renderers

- [ ] Phase 4: Testing (4-5 hours)
  - [ ] Update existing tests
  - [ ] Create new focus system tests
  - [ ] Integration testing

- [ ] Phase 5: Cleanup (2-3 hours)
  - [ ] Remove dead code
  - [ ] Update TypeScript interfaces
  - [ ] Lint and format

- [ ] Phase 6: Documentation (2 hours)
  - [ ] Design document
  - [ ] Component documentation

**Total Estimated Time**: 21-28 hours

## Success Criteria

1. No focus-related props in any component
2. All focus navigation works through the focus stack
3. Escape key consistently moves up the focus hierarchy
4. Modal focus is automatically restored
5. All tests pass
6. No regression in user experience

## Rollback Plan

If issues arise:
1. The old system can coexist temporarily
2. Components can be migrated one at a time
3. Git history preserves the old implementation

## Future Enhancements

1. Focus history navigation (forward/back)
2. Focus shortcuts (e.g., Cmd+1 for shell, Cmd+2 for timeline)
3. Visual focus indicators
4. Focus state persistence across sessions