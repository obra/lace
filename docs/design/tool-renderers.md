# Tool-Specific Renderers

## Overview

Lace supports specialized tool renderers that provide custom UI for specific tools, replacing the generic JSON input/output display with tool-optimized interfaces. The system uses dynamic discovery to automatically load tool-specific renderers when available, with graceful fallback to the generic renderer.

## Architecture

### Dynamic Discovery System

**File**: `src/interfaces/terminal/components/events/tool-renderers/getToolRenderer.ts`

The system uses a naming convention to dynamically discover tool renderers:

```typescript
// Tool name → Component name → File name
'bash' → 'BashToolRenderer' → './BashToolRenderer.js'
'file-read' → 'FileReadToolRenderer' → './FileReadToolRenderer.js'
'delegate' → 'DelegateToolRenderer' → './DelegateToolRenderer.js'
```

**Key Features:**
- **Async Loading**: Uses ES module dynamic imports for on-demand loading
- **Graceful Fallback**: Returns `null` if renderer not found, triggering generic renderer
- **Error Resilience**: Catches import failures and falls back gracefully
- **Compiled Output**: Looks for `.js` files in the compiled `dist/` directory

### Integration Points

**File**: `src/interfaces/terminal/components/events/TimelineItem.tsx`

1. **DynamicToolRenderer Component**: Manages async loading and state
2. **ToolRendererErrorBoundary**: Catches renderer errors and falls back to generic
3. **TimelineEntryCollapsibleBox**: Provides consistent UI wrapper for all renderers

## Renderer Interface

### Required Interface

All tool renderers must implement this interface:

```typescript
interface ToolRendererProps {
  item: ToolExecutionItem;
  isStreaming?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
}

type ToolExecutionItem = {
  type: 'tool_execution';
  call: ToolCall;
  result?: ToolResult;
  timestamp: Date;
  callId: string;
};
```

### Export Requirements

Tool renderers must be exported as **named exports** (not default exports):

```typescript
// ✅ Correct
export function BashToolRenderer({ item, isSelected, onToggle }: Props) {
  // ...
}

// ❌ Incorrect  
export default function BashToolRenderer({ item, isSelected, onToggle }: Props) {
  // ...
}
```

## UI Architecture

### TimelineEntryCollapsibleBox

All tool renderers should use `TimelineEntryCollapsibleBox` for consistent behavior:

```typescript
import { TimelineEntryCollapsibleBox } from '../../ui/TimelineEntryCollapsibleBox.js';

return (
  <TimelineEntryCollapsibleBox
    label={fancyLabel}           // React.ReactNode | string
    summary={compactSummary}     // React.ReactNode (collapsed view)
    isExpanded={isExpanded}
    onExpandedChange={handleExpandedChange}
    isSelected={isSelected}
    onToggle={onToggle}
  >
    {expandedContent}            {/* Full detail view */}
  </TimelineEntryCollapsibleBox>
);
```

### Label vs Summary

- **Label**: Shows with expand/collapse arrow (`▶` or `▽`) - always visible
- **Summary**: Content shown when collapsed - should be output preview
- **Children**: Content shown when expanded - should be full details

### Expansion Management

Use the shared expansion hook for consistent behavior:

```typescript
import { useTimelineItemExpansion } from '../hooks/useTimelineExpansionToggle.js';

const { isExpanded, onExpand, onCollapse } = useTimelineItemExpansion(
  isSelected,
  (expanded) => onToggle?.()
);
```

## BashToolRenderer Case Study

### Implementation Details

**File**: `src/interfaces/terminal/components/events/tool-renderers/BashToolRenderer.tsx`

The BashToolRenderer demonstrates best practices for tool-specific rendering:

### Input/Output Processing

```typescript
// Parse tool result to extract structured output
interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function parseBashResult(result: ToolResult): BashOutput | null {
  try {
    const content = result?.content?.[0]?.text;
    if (!content) return null;
    const parsed = JSON.parse(content);
    // Validate structure...
    return parsed as BashOutput;
  } catch {
    return null;
  }
}
```

### Fancy Label with React Components

```typescript
const fancyLabel = (
  <React.Fragment>
    <Text color={UI_COLORS.TOOL}>Bash Tool: </Text>
    <Text color="white">$ {command}</Text>
    <Text color="gray">  </Text>
    <Text color={success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
      {statusIcon}
    </Text>
    {exitCodeDisplay && (
      <React.Fragment>
        <Text color="gray"> </Text>
        <Text color={UI_COLORS.ERROR}>{exitCodeDisplay}</Text>
      </React.Fragment>
    )}
  </React.Fragment>
);
```

### Smart Output Truncation

```typescript
function limitLines(text: string, maxLines: number): { lines: string[], truncated: boolean } {
  if (!text) return { lines: [], truncated: false };
  
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  
  return { 
    lines: lines.slice(0, maxLines), 
    truncated: true 
  };
}

// Usage in compact view
const { lines, truncated } = limitLines(stdout, 3);
const remainingLines = stdout.split('\n').length - lines.length;

return (
  <Box flexDirection="column">
    <Text>{lines.join('\n')}</Text>
    {truncated && (
      <Text color="gray">(+ {remainingLines} lines)</Text>
    )}
  </Box>
);
```

### Key Design Decisions

1. **Exit Code Display**: Only show non-zero exit codes (errors)
2. **Command Context**: Preserve command in both collapsed and expanded views
3. **Error Prioritization**: Show stderr for failed commands, stdout for successful ones
4. **Visual Hierarchy**: Use colors and icons to indicate success/failure status
5. **Space Efficiency**: Truncate output with line count indicators

## Common Patterns

### Tool Result Parsing

Most tools return JSON-stringified results. Always validate structure:

```typescript
function parseToolResult<T>(result: ToolResult, validator: (obj: any) => obj is T): T | null {
  try {
    const content = result?.content?.[0]?.text;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return validator(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
```

### Status Determination

```typescript
const toolSuccess = result ? !result.isError : true;
const operationSuccess = /* tool-specific success logic */;
const success = toolSuccess && operationSuccess;

const statusIcon = success ? UI_SYMBOLS.SUCCESS : result ? UI_SYMBOLS.ERROR : UI_SYMBOLS.PENDING;
```

### Conditional Content Display

```typescript
// Only show summary if there's actual content
const compactSummary = result && output && (
  <Box marginTop={1}>
    {/* Content preview */}
  </Box>
);
```

## Layout Guidelines

### Indentation Rules

1. **No extra marginLeft in compactSummary**: Content should align naturally
2. **Use marginTop for spacing**: Separate sections vertically
3. **Consistent depth**: All tool renderers should have same indentation level

### React Component Labels

When using React components as labels:

```typescript
// ✅ Use React.Fragment for inline elements
const label = (
  <React.Fragment>
    <Text>...</Text>
    <Text>...</Text>
  </React.Fragment>
);

// ❌ Don't use Box - creates extra indentation
const label = (
  <Box>
    <Text>...</Text>
    <Text>...</Text>
  </Box>
);
```

## Testing

### Unit Tests

Tool renderers should be co-located with their tests:

```
BashToolRenderer.tsx
BashToolRenderer.test.tsx
```

Test scenarios:
- Successful command execution
- Failed command execution (non-zero exit)
- Tool execution errors
- Empty output
- Truncated output
- Streaming states

### Integration Tests

The dynamic discovery system is tested in:
`src/interfaces/terminal/components/events/tool-renderers/__tests__/getToolRenderer.test.ts`

## Development Workflow

### Adding a New Tool Renderer

1. **Create the renderer**: `src/interfaces/terminal/components/events/tool-renderers/YourToolRenderer.tsx`
2. **Follow naming convention**: Tool name `your-tool` → `YourToolRenderer`
3. **Implement required interface**: Match `ToolRendererProps`
4. **Use TimelineEntryCollapsibleBox**: For consistent UI
5. **Handle tool-specific output**: Parse and display appropriately
6. **Add tests**: Co-locate test file
7. **Build and test**: System auto-discovers the new renderer

### Debugging

The system includes comprehensive logging:

```typescript
import { logger } from '../../../../../utils/logger.js';

logger.debug('Tool renderer discovery', {
  toolName,
  componentName,
  fileName,
  action: 'attempting_load'
});
```

Log levels:
- **DEBUG**: Discovery attempts, module loading details
- **INFO**: Successful renderer resolution
- **ERROR**: Discovery failures, renderer errors

## Best Practices

### Performance

1. **Lazy Loading**: Renderers are loaded on-demand
2. **Error Boundaries**: Failed renderers don't crash the UI
3. **Graceful Degradation**: Always falls back to generic renderer

### User Experience

1. **Consistent Patterns**: Use established UI components and patterns
2. **Visual Feedback**: Clear success/error states with colors and icons
3. **Progressive Disclosure**: Show summary when collapsed, details when expanded
4. **Contextual Information**: Preserve important context (like commands) in all views

### Code Quality

1. **Type Safety**: Use proper TypeScript interfaces
2. **Error Handling**: Handle malformed tool results gracefully
3. **Reusable Logic**: Extract common patterns into utility functions
4. **Clean Separation**: Keep parsing logic separate from UI logic

## Future Considerations

### Planned Improvements

1. **Syntax Highlighting**: Enhanced code display for file operations
2. **Interactive Elements**: Clickable elements within tool outputs
3. **Real-time Updates**: Better streaming support for long-running tools
4. **Accessibility**: Improved screen reader support

### Extension Points

1. **Plugin System**: External renderer registration
2. **Theme Support**: Customizable color schemes
3. **Export Functionality**: Save tool outputs to files
4. **History Navigation**: Browse previous tool executions

## Troubleshooting

### Common Issues

1. **Renderer Not Loading**: Check naming convention and file location
2. **Extra Indentation**: Avoid unnecessary Box wrappers, check marginLeft usage
3. **TypeScript Errors**: Ensure proper interface implementation
4. **UI Inconsistency**: Use TimelineEntryCollapsibleBox and established patterns

### Debug Steps

1. Check build output: `dist/interfaces/terminal/components/events/tool-renderers/`
2. Review logs: Look for discovery and loading messages
3. Test fallback: Temporarily rename renderer to test generic fallback
4. Verify exports: Ensure named export matches expected name