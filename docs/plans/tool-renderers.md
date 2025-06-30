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

### FileSearchToolRenderer

**Collapsed**: `Search: "useState" in /src - 12 matches across 5 files`

**Expanded**:
- Grouped by file path
- Line numbers with content
- Search term highlighting

**Implementation**:
- Parse "Found X matches" format
- Group matches by file
- Extract line numbers and content

### FileWriteToolRenderer

**Collapsed**: `Write: /path/to/file.txt - 247 characters`

**Expanded**:
- File path with context
- Character count details
- Content preview (first 3 lines)

**Implementation**:
- Extract path and character count from success message
- Handle creation vs overwrite indication

### FileEditToolRenderer

**Collapsed**: `Edit: /path/to/file.ts - 1 replacement (45 → 47 lines)`

**Expanded**:
- Line count comparison
- Text change preview
- Replacement context

**Implementation**:
- Parse line count changes from output
- Show before/after text context
- Handle single replacement requirement

## House Style for Collapsed/Expanded Views

### Label Structure
Always use React.Fragment for inline elements in labels:
```typescript
const fancyLabel = (
  <React.Fragment>
    <Text color={UI_COLORS.TOOL}>Tool Name: </Text>
    <Text color="white">{primaryInfo}</Text>
    <Text color="gray">{secondaryInfo}</Text>
    <Text color="gray">  </Text>
    <Text color={success ? UI_COLORS.SUCCESS : UI_COLORS.ERROR}>
      {statusIcon}
    </Text>
    {streaming && <Text color="gray"> (action...)</Text>}
  </React.Fragment>
);
```

### Collapsed Summary
Show preview content with marginTop={1}, no marginLeft:
```typescript
const compactSummary = result && success && (
  <Box marginTop={1}>
    <Text color="gray">{statsOrCounts}</Text>
    {previewLines.map((line, i) => (
      <Text key={i} color="gray">{line}</Text>
    ))}
    {truncated && <Text color="gray">... and X more lines</Text>}
  </Box>
);
```

### Expanded Content
Start with marginTop={1} for spacing, then show full content:
```typescript
const expandedContent = (
  <Box flexDirection="column">
    <Box marginTop={1}>
      <Text color={UI_COLORS.SUCCESS}>{statsOrSummary}</Text>
    </Box>
    <Text>{fullOutput}</Text>
  </Box>
);
```

### Key Rules
- **No header duplication**: Expanded content never repeats label info
- **Spacing**: marginTop={1} before stats, no extra margins for raw output
- **Colors**: UI_COLORS.TOOL (cyan), SUCCESS (green), ERROR (red)
- **Streaming states**: Show "(action...)" in gray for active operations

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

## Implementation Order

1. **FileListToolRenderer** - Most complex tree parsing
2. **FileSearchToolRenderer** - Grouped output handling  
3. **FileWriteToolRenderer** - Simplest success message parsing
4. **FileEditToolRenderer** - Line count and replacement display

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