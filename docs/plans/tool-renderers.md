# File Tool Renderers Implementation Plan

## Overview

Implement custom tool renderers for file-list, file-search, file-write, and file-edit tools to replace generic JSON display with specialized UI.

## Design Principles

- **Progressive Disclosure**: Essential info collapsed, full details expanded
- **Visual Hierarchy**: Clear success/error states, prominent file paths
- **Consistent Patterns**: All use TimelineEntryCollapsibleBox, React.Fragment labels
- **Smart Truncation**: Large outputs truncated with count indicators

## Tool Analysis

### file-list
- **Input**: path, pattern, recursive options
- **Output**: Tree structure with sizes, directory summaries
- **Success**: Directory listing with file/folder counts
- **Errors**: Unreadable directories, invalid paths

### file-search (ripgrep)
- **Input**: pattern, path, case options, file filters
- **Output**: Grouped matches by file with line numbers
- **Success**: "Found X matches" with file/line details
- **Errors**: ripgrep not found, no matches, invalid regex

### file-write
- **Input**: path, content, createDirs option
- **Output**: Simple success message with character count
- **Success**: "Successfully wrote X characters to path"
- **Errors**: Permission denied, invalid path, filesystem errors

### file-edit
- **Input**: path, old_text, new_text
- **Output**: Success with line count changes
- **Success**: "Successfully replaced text (X lines → Y lines)"
- **Errors**: Text not found, multiple matches, file not accessible

## Renderer Specifications

### FileListToolRenderer ✅ COMPLETED

**Collapsed**: `File List: current directory  ✓`
```
12 files, 6 directories
./
├ dist/
├ docs/
... and 15 more lines
```

**Expanded**: 
```
12 files, 6 directories

./
├ dist/
├ docs/
├ node_modules/
├ src/
... (full tree output)
```

**Implementation Learnings**:
- Tool output is raw tree text with file sizes in bytes
- Count files/dirs by scanning for "(bytes)" vs "/" patterns
- Handle "current directory" vs actual path display
- Parameter summary shows recursive, hidden, pattern, depth options
- Expanded view: marginTop={1} before stats, then raw output
- No duplication of header info in expanded content

### FileSearchToolRenderer ✅ COMPLETED

**Collapsed**: `Search: "useState" in current directory  ✓`
```
12 matches across 5 files
src/components/Button.tsx:
  15: const [state, setState] = useState(false);
... and more
```

**Implementation Learnings**:
- Parse "Found X match(es)" pattern for statistics
- Count unique files by filtering file path lines
- Preview shows first few result lines without "Found" header
- Handle "No matches found" empty state
- Parameters: case-sensitive, whole words, include/exclude patterns

### FileWriteToolRenderer ✅ COMPLETED

**Collapsed**: `Write: /path/to/file.txt  ✓`
```
247 characters
const hello = "world";
console.log(hello);
... and more
```

**Implementation Learnings**:
- Parse "Successfully wrote X characters to path" message
- Format character counts with K/M suffixes for large files
- Preview shows first 2 lines of written content
- Expanded view shows 5 lines with truncation count
- Content preview from input, not output parsing

### FileEditToolRenderer ✅ COMPLETED

**Collapsed**: `Edit: /path/to/file.ts  ✓`
```
1 replacement (45 → 47 lines)
- const old = "value";
... and more
```

**Implementation Learnings**:
- Parse "Successfully replaced text in path (X lines → Y lines)"
- Preview shows removed text with red "- " prefix
- Expanded view shows full diff with +/- indicators
- Line count changes clearly displayed
- Uses input old_text/new_text for diff display

## Standardized Tool Renderer Architecture

### useToolRenderer Hook ✅ IMPLEMENTED

All tool renderers now use the standardized `useToolRenderer` hook to eliminate boilerplate and ensure consistency:

```typescript
import { useToolRenderer, ToolRendererProps } from './useToolRenderer.js';

export function MyToolRenderer({ item, isStreaming, isSelected, onToggle }: ToolRendererProps) {
  const { timelineEntry } = useToolRenderer(
    item,
    {
      toolName: 'My Tool',
      streamingAction: 'processing...',
      getPrimaryInfo: (input) => input.primaryField as string,
      getSecondaryInfo: (input) => input.options ? `(${input.options})` : '',
      parseOutput: (result, input) => {
        // Tool-specific parsing logic
        return {
          success: boolean,
          isEmpty?: boolean,
          stats?: string,
          previewContent?: React.ReactNode,
          mainContent?: React.ReactNode,
          errorMessage?: string
        };
      }
    },
    isStreaming,
    isSelected,
    onToggle
  );

  return timelineEntry;
}
```

### Configuration Interface
```typescript
interface ToolRendererConfig {
  toolName: string;                    // Display name in label
  streamingAction: string;             // Text shown during streaming
  getPrimaryInfo: (input) => string;   // Main info (file path, command, etc.)
  getSecondaryInfo?: (input) => string; // Optional secondary info (params, flags)
  parseOutput: (result, input) => ToolOutputData; // Tool-specific parsing
}
```

### Standardized Patterns
- **Label Structure**: Automatic generation with consistent colors and spacing
- **Expansion Management**: Shared state management via useTimelineItemExpansion
- **Error Handling**: Consistent error display with red styling
- **Preview/Main Content**: Structured separation between collapsed and expanded views
- **Empty State Handling**: Standardized "No results" display

### House Style Rules
- **No header duplication**: Expanded content never repeats label info
- **Spacing**: marginTop={1} before stats, no extra margins for raw output
- **Colors**: UI_COLORS.TOOL (cyan), SUCCESS (green), ERROR (red)
- **Streaming states**: Show "(action...)" in gray for active operations
- **Empty states**: Graceful handling with isEmpty flag

## Common Patterns

### Status Determination
```typescript
const toolSuccess = result ? !result.isError : true;
const operationSuccess = /* tool-specific logic */;
const success = toolSuccess && operationSuccess;
```

### Output Parsing
```typescript
function parseToolResult<T>(result: ToolResult): T | null {
  try {
    const content = result?.content?.[0]?.text;
    return content ? /* parse logic */ : null;
  } catch {
    return null;
  }
}
```

### Smart Truncation
```typescript
function limitLines(text: string, maxLines: number) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { lines, truncated: false };
  return { 
    lines: lines.slice(0, maxLines), 
    truncated: true,
    remaining: lines.length - maxLines
  };
}
```

## Implementation Status

1. **FileListToolRenderer** ✅ - Most complex tree parsing
2. **FileSearchToolRenderer** ✅ - Grouped output handling  
3. **FileWriteToolRenderer** ✅ - Simplest success message parsing
4. **FileEditToolRenderer** ✅ - Line count and replacement display
5. **BashToolRenderer** ✅ - Refactored to use standardized hook
6. **useToolRenderer Hook** ✅ - Standardized architecture implemented

### Renderers Not Migrated
- **DelegateToolRenderer** - Complex delegation handling, kept original implementation

## File Structure

```
src/interfaces/terminal/components/events/tool-renderers/
├── FileListToolRenderer.tsx
├── FileListToolRenderer.test.tsx
├── FileSearchToolRenderer.tsx
├── FileSearchToolRenderer.test.tsx
├── FileWriteToolRenderer.tsx
├── FileWriteToolRenderer.test.tsx
├── FileEditToolRenderer.tsx
└── FileEditToolRenderer.test.tsx
```

## Testing Requirements

Each renderer must test:
- Success case parsing and display
- Tool error handling
- Malformed output graceful fallback
- Empty/no results handling
- Large output truncation
- Expanded/collapsed states