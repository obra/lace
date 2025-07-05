# Tool Renderer Simplification Spec

## Overview

Eliminate abstraction layers. Each tool renderer directly composes small, focused components. No central data extraction. No prop drilling. Just simple composition.

## Core Principles

1. **YAGNI** - Don't abstract until you have 3+ real use cases
2. **DRY** - Only extract when you're actually repeating yourself
3. **Inline** - Put the code where it's used, not in a separate file
4. **Simple** - If you need to explain it, it's too complex

## Architecture

### Shared Components (keep minimal)

```typescript
// src/interfaces/terminal/components/events/tool-renderers/components/shared.tsx

// Standard header with icon, title, and status indicator
export function ToolHeader({ 
  icon = '🔧', 
  status, // 'pending' | 'success' | 'error'
  children 
}: Props) {
  const statusIcon = status === 'pending' ? '⏳' : status === 'success' ? '✓' : '✗';
  const statusColor = status === 'pending' ? 'gray' : status === 'success' ? 'green' : 'red';
  
  return (
    <Box>
      <Text color="yellow">{icon} </Text>
      {children}
      <Text color={statusColor}> {statusIcon}</Text>
    </Box>
  );
}

// Collapsed preview styling
export function ToolPreview({ children }: Props) {
  return (
    <Box marginLeft={2} marginTop={1}>
      <Text dimColor>{children}</Text>
    </Box>
  );
}

// Expanded content container
export function ToolContent({ children }: Props) {
  return (
    <Box marginLeft={2} marginTop={1} flexDirection="column">
      {children}
    </Box>
  );
}

// The ONLY shared hook - for expansion state
export function useToolExpansion(isSelected: boolean, onToggle?: () => void) {
  const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(isSelected, onToggle);
  
  return {
    isExpanded,
    toggle: () => isExpanded ? onCollapse() : onExpand()
  };
}
```

### Example Tool Renderer

```typescript
// src/interfaces/terminal/components/events/tool-renderers/BashToolRenderer.tsx

import { ToolHeader, ToolPreview, ToolContent, useToolExpansion } from './components/shared.js';

export function BashToolRenderer({ item, isSelected, onToggle }: Props) {
  const { isExpanded } = useToolExpansion(isSelected, onToggle);
  
  // Extract data directly - no abstraction needed
  const { command, description } = item.call.arguments;
  const output = item.result?.content?.[0]?.text || '';
  const hasError = item.result?.isError;
  const isRunning = !item.result;
  
  // Determine status
  const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
  
  return (
    <Box flexDirection="column">
      <ToolHeader status={status}>
        <Text bold>bash</Text>
        <Text> $ {command}</Text>
        {description && <Text dim> - {description}</Text>}
      </ToolHeader>
      
      {!isExpanded && output && (
        <ToolPreview>
          <Text numberOfLines={2}>{output}</Text>
        </ToolPreview>
      )}
      
      {isExpanded && output && (
        <ToolContent>
          <Box borderStyle="round" borderColor="gray">
            <Text>{output}</Text>
          </Box>
        </ToolContent>
      )}
    </Box>
  );
}
```

## Implementation Tasks

### 1. Create shared components file
- [ ] Create `src/interfaces/terminal/components/events/tool-renderers/components/shared.tsx`
- [ ] Implement ToolHeader, ToolPreview, ToolContent
- [ ] Implement useToolExpansion hook
- [ ] NO OTHER ABSTRACTIONS - resist the urge

### 2. Migrate each tool renderer
Order matters - start simple, build confidence:

- [ ] BashToolRenderer - simplest, good template
- [ ] FileReadToolRenderer - similar pattern
- [ ] FileWriteToolRenderer - has character count in output
- [ ] FileEditToolRenderer - has line count changes
- [ ] FileListToolRenderer - already custom, minor updates
- [ ] FileSearchToolRenderer - has match counting
- [ ] GenericToolRenderer - fallback for unknown tools
- [ ] DelegateToolRenderer - special case, keep custom logic

### 3. Remove old abstractions
- [ ] Delete `useToolData.ts` - completely unnecessary
- [ ] Delete `useToolState.ts` - replaced by simpler useToolExpansion
- [ ] Delete `ToolDisplay.tsx` - replaced by composition
- [ ] Delete `useDelegateToolData.ts` - move logic inline
- [ ] Delete `useDelegateToolState.ts` - move logic inline

### 4. Update tests

Test files that need editing (remove mocks for deleted hooks):
- [ ] `__tests__/FileListToolRenderer.test.tsx` - remove useToolData/useToolState mocks
- [ ] `__tests__/GenericToolRenderer.test.tsx` - remove useToolData/useToolState mocks  
- [ ] `__tests__/DelegateToolRenderer.test.tsx` - remove useToolData/useDelegateToolData/useDelegateToolState mocks

Changes needed:
1. Remove all vi.mock() calls for the deleted hooks
2. Remove imports of deleted hooks
3. Test the actual rendered output instead of mocked return values
4. Tests should be SIMPLER - just render and check output

No test files to delete - the hooks didn't have their own tests.

### 5. Clean up any remaining references
- [ ] Search for imports of deleted files
- [ ] Remove unused imports

## Testing Strategy

Each tool renderer test should:
1. Render the component with mock data
2. Check the header shows correct command/title
3. Check collapsed state shows preview
4. Check expanded state shows full content
5. NO MOCKING OF HOOKS - test the actual component

Example test:
```typescript
it('should show bash command and output', () => {
  const item = {
    call: { name: 'bash', arguments: { command: 'ls -la' } },
    result: { content: [{ text: 'file1.txt\nfile2.txt' }] }
  };
  
  const { lastFrame } = render(<BashToolRenderer item={item} />);
  expect(lastFrame()).toContain('bash $ ls -la');
  expect(lastFrame()).toContain('file1.txt');
});
```

## Pitfalls to Avoid

### 1. Over-abstracting status logic
```typescript
// BAD - unnecessary abstraction
const useToolStatus = (item) => {
  return useMemo(() => computeStatus(item), [item]);
};

// GOOD - just inline it
const status = isRunning ? 'pending' : hasError ? 'error' : 'success';
```

### 2. Creating "data objects"
```typescript
// BAD - pointless intermediate object
const toolData = {
  title: `bash $ ${command}`,
  status: getStatus(item),
  preview: output
};
return <ToolDisplay data={toolData} />;

// GOOD - just use the values directly
return (
  <ToolHeader status={status}>
    <Text>bash $ {command}</Text>
  </ToolHeader>
);
```

### 3. Extracting too early
```typescript
// BAD - extracted after seeing it twice
function formatBashCommand(cmd) { return `$ ${cmd}`; }

// GOOD - wait until you have 3+ uses and it's actually complex
<Text>$ {command}</Text>
```

### 4. Making components too flexible
```typescript
// BAD - too many options
<ToolHeader icon={icon} color={color} size={size} bold={bold}>

// GOOD - just what we actually use
<ToolHeader icon="🔧" status={status}>
```

## Success Criteria

1. **Less code** - We should delete more than we add
2. **Easier to understand** - New dev can understand a tool renderer in 30 seconds
3. **Easier to add tools** - Copy existing renderer, modify the specifics, done
4. **Tests are simpler** - No mocking layers of hooks

## File Naming

- Keep existing tool renderer names (BashToolRenderer.tsx, etc.)
- Shared components in `components/shared.tsx` (not `ToolComponents` or other fancy names)
- No "utils", "helpers", or "common" files - be specific

## Code Style

```typescript
// Clear variable names
const command = item.call.arguments.command;  // GOOD
const cmd = item.call.arguments.command;      // BAD - unclear
const c = item.call.arguments.command;        // BAD - too short

// Status in one line
const status = isRunning ? 'pending' : hasError ? 'error' : 'success';  // GOOD
const status = getComputedStatusForToolExecution(item);                 // BAD - overwrought

// Direct property access
const output = item.result?.content?.[0]?.text || '';  // GOOD
const output = extractOutputFromResult(item.result);   // BAD - unnecessary
```

## Final Checklist

Before marking complete:
- [ ] Can a new developer understand BashToolRenderer in 30 seconds?
- [ ] Is each tool renderer self-contained?
- [ ] Did we delete more code than we added?
- [ ] Are the tests simpler?
- [ ] Did we resist adding "just in case" abstractions?

## Summary

Move from:
```
useToolData (giant switch) → useToolState → ToolDisplay → specific components
```

To:
```
ToolRenderer → composes ToolHeader/Preview/Content directly
```

That's it. No layers. No abstractions. Just components.