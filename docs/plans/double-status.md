# Enhanced Status Bar with Project Context

## Overview

Add a second row to the terminal status bar displaying current working directory and git repository information. This helps users understand their current project context when using Lace.

## Current State

The status bar (`src/interfaces/terminal/components/status-bar.tsx`) currently shows:
```
[Provider:Model] • [ThreadID] • [Messages] • [Tokens] • [Status]
```

## Target State

Two-row status bar:
```
Row 1: [Provider:Model] • [ThreadID] • [Messages] • [Tokens] • [Status]
Row 2: [/path/to/current/directory] • [branch-name] • [3 modified; 1 untracked]
```

## Requirements

- **Path display**: Show full path, truncated to ~40 characters from the right (e.g., `.../long/path/to/project`)
- **Home directory**: Replace home with `~` (e.g., `~/Documents/project`)
- **Git branch**: Show current branch name if in git repository
- **Working copy status**: Show counts like `3 modified; 6 deleted; 1 untracked; 2 staged` (only non-zero counts)
- **Non-git directories**: Show only path, no git info
- **Unicode characters**: Use traditional unicode (no emoji due to Ink measurement issues)
- **Update timing**: Only refresh on focus changes or command completion, not real-time
- **Performance**: Cache results, avoid blocking UI during git operations

## Implementation Plan

### Phase 1: Create Project Context Hook

**File**: `src/interfaces/terminal/hooks/use-project-context.ts`

Create a React hook that:
1. Gets current working directory with `process.cwd()`
2. Formats path for display (truncate, replace home with `~`)
3. Checks if directory is git repo with `git rev-parse --git-dir`
4. Gets branch name with `git branch --show-current`
5. Parses `git status --porcelain` output into counts
6. Caches results and provides refresh function
7. Handles all git command failures gracefully

**Interface**:
```typescript
interface GitStatus {
  branch?: string;
  modified: number;
  deleted: number;
  untracked: number;
  staged: number;
}

interface ProjectContext {
  cwd: string;
  displayPath: string;
  isGitRepo: boolean;
  gitStatus?: GitStatus;
}

function useProjectContext(): {
  context: ProjectContext;
  refreshContext: () => Promise<void>;
  isRefreshing: boolean;
}
```

**Git Status Parsing Logic**:
- `git status --porcelain` format: `XY filename`
- X = index status, Y = working tree status
- Count `M` in Y position as modified
- Count `D` in Y position as deleted  
- Count `??` as untracked
- Count `A`, `M`, `D` in X position as staged

**Tests**: Write comprehensive tests for:
- Path formatting (long paths, home directory replacement)
- Git status parsing (various combinations of file states)
- Non-git directory handling
- Command execution failures

### Phase 2: Update Status Bar Component

**File**: `src/interfaces/terminal/components/status-bar.tsx`

Modify StatusBar component to:
1. Add new props for project context
2. Render two rows instead of one
3. Format git status counts (only show non-zero counts)
4. Handle responsive layout for very narrow terminals

**New Props**:
```typescript
interface StatusBarProps {
  // ... existing props
  projectContext?: ProjectContext;
}
```

**Display Logic**:
- Row 1: Keep existing content unchanged
- Row 2: `[displayPath] • [branch] • [status counts]`
- Use unicode characters: `┃` `•` `±` `+` `-` `?` etc.
- Git status format: `3±` (modified), `2+` (staged), `1-` (deleted), `2?` (untracked)
- Only show non-zero counts, separated by spaces

**Tests**: Update existing tests and add new ones for:
- Two-row rendering
- Git status formatting
- Non-git directory display
- Edge cases (very long paths, no git info)

### Phase 3: Integrate with Terminal Interface

**File**: `src/interfaces/terminal/terminal-interface.tsx`

1. Import and use `useProjectContext` hook
2. Pass project context to StatusBar component
3. Trigger refresh on appropriate events:
   - After tool execution completes
   - On focus changes (if detectable)
   - Initial mount

**Integration points**:
- Add hook call near other state management
- Pass data to StatusBar in render
- Call `refreshContext()` after agent message processing completes

**Command completion trigger**: Look for existing patterns where tool execution completes and add refresh call there.

### Phase 4: Add Unicode Characters to Theme

**File**: `src/interfaces/terminal/theme.ts`

Add new unicode symbols to the existing `UI_SYMBOLS` object:
```typescript
export const UI_SYMBOLS = {
  // ... existing symbols
  FOLDER: '📁',  // Wait, spec says no emoji...
  BRANCH: '⎇',   // Git branch symbol
  MODIFIED: '±',  // Modified files
  STAGED: '+',    // Staged files  
  DELETED: '-',   // Deleted files
  UNTRACKED: '?', // Untracked files
  PATH_SEPARATOR: '•',
} as const;
```

Research appropriate unicode characters that work well in terminals and measure correctly with Ink.

### Phase 5: Testing Strategy

**Test Files to Create/Update**:
- `src/interfaces/terminal/hooks/__tests__/use-project-context.test.ts`
- `src/interfaces/terminal/__tests__/status-bar.test.tsx` (update existing)

**Test Coverage**:
1. **Hook tests**: Mock `execSync`, test all git scenarios, path formatting
2. **Component tests**: Snapshot tests for different layouts, prop combinations
3. **Integration tests**: Full terminal interface with project context

**Test-First Development**:
1. Write failing tests for hook functionality
2. Implement hook to make tests pass
3. Write failing tests for component changes
4. Update component to make tests pass
5. Write integration tests and implement terminal changes

### Phase 6: Error Handling & Edge Cases

Handle gracefully:
- Git commands fail (not in repo, git not installed, corrupted repo)
- Very long paths or branch names
- Narrow terminal windows
- Permission issues reading git info
- Non-ASCII characters in paths/branch names

### Phase 7: Performance Considerations

- Cache git results to avoid repeated executions
- Use async operations to avoid blocking UI
- Implement debouncing if refresh is called frequently
- Consider adding loading states for slow git operations

## Files to Touch

1. **New files**:
   - `src/interfaces/terminal/hooks/use-project-context.ts`
   - `src/interfaces/terminal/hooks/__tests__/use-project-context.test.ts`

2. **Modified files**:
   - `src/interfaces/terminal/components/status-bar.tsx`
   - `src/interfaces/terminal/__tests__/status-bar.test.tsx`
   - `src/interfaces/terminal/terminal-interface.tsx`
   - `src/interfaces/terminal/theme.ts`

3. **Possibly modified**:
   - `package.json` (if new dependencies needed)

## Dependencies

Uses existing dependencies:
- React hooks (useState, useEffect, useCallback)
- Node.js built-ins (child_process.execSync, path, os)
- Ink components (Box, Text)

## Implementation Notes

- Follow existing code patterns in the project
- Use the same error handling style as other components
- Match the existing theme and styling approach
- Maintain backwards compatibility (component should work without project context)
- Follow the project's test conventions and structure

## Success Criteria

1. Status bar shows two rows with project information
2. Git information updates appropriately and handles all edge cases
3. Performance doesn't degrade (no blocking operations)
4. All tests pass and coverage is maintained
5. Works correctly in non-git directories
6. Responsive to terminal width changes
7. Matches existing UI patterns and themes