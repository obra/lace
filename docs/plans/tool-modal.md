# Enhanced Tool Approval Modal Plan

## Current State Analysis

The current tool approval modal (`src/interfaces/terminal/components/tool-approval-modal.tsx`) has several limitations that make it difficult for users to properly review tool actions before approval:

### Current Limitations
1. **Limited content display**: Parameters are truncated at 150 characters and complex objects are collapsed
2. **No scrolling capability**: Long content like file contents can't be fully reviewed
3. **No tab navigation**: Users can't navigate between different parts of the modal content
4. **Poor formatting**: Tool parameters are displayed in a flattened, hard-to-read format
5. **No expandable sections**: Users can't see the full content when needed

### Current Structure
- Simple single-screen modal with truncated parameter display
- Basic keyboard navigation (y/n/s for approval options, ↑↓ for option selection)
- Risk level indicator (READ-ONLY vs DESTRUCTIVE)
- Fixed-height display with no scrolling

## Requirements

Based on the screenshot (`/Users/jesse/Documents/Screenshots/SCR-20250623-iutd.png`), the tool approval modal needs to:

1. **Expand to show full content** of proposed actions
2. **Provide scrollable areas** for long content (especially file write operations)
3. **Enable tab navigation** between content sections and approval options
4. **Show complete parameter values** rather than truncated versions
5. **Maintain usability** while providing comprehensive information

## Technical Considerations

### Scrolling Implementation
- Reference: [Ink scrolling issue #432](https://github.com/vadimdemedes/ink/issues/432)
- Reference: [ink-scroller library](https://github.com/gnidan/ink-scroller)
- Need to handle scrollable content within Ink's constraint-based layout system
- Consider using `ink-scroller` or implementing custom scrolling solution

### Focus Management
- Ink's `useFocus` system for managing component focus
- Need to handle tab navigation between sections
- Maintain proper focus indicators for accessibility

## Implementation Plan

### Phase 1: Enhanced Modal Structure

**1. Create Multi-Section Modal Layout**
```
┌─────────────────────────────────────┐
│ 🛡️ TOOL APPROVAL REQUEST           │
├─────────────────────────────────────┤
│ Tool: file_write ⚠️ DESTRUCTIVE    │
│ Navigation: Parameters > content    │
├─────────────────────────────────────┤
│ [Parameters] [Schema] [Preview]     │ ← Tab navigation
│ ┌─ Active Section ────────────────┐ │
│ │ (Content area - scrollable)     │ │
│ │                                 │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ [▶ Allow Once] [Allow Session] [Deny] │
├─────────────────────────────────────┤
│ Tab: next section, ↑↓: navigate     │
└─────────────────────────────────────┘
```

**2. Component Architecture**
- Top: Tool information header (tool name, risk level)
- Middle: Tabbed content sections with scrollable areas
- Bottom: Approval options and help text

**3. Content Sections**
- **Parameters Overview**: Collapsed view showing parameter names and types
- **Parameter Details**: Expandable sections for each parameter with full content
- **Tool Schema**: Show the tool's input schema for reference (when helpful)
- **Preview**: For file operations, show file content with syntax highlighting

### Phase 2: Navigation System

**1. Tab-based Navigation**
- Primary tabs: Parameters Overview → Parameter Details → Approval Options
- Within Parameter Details: Navigate between individual parameters
- Breadcrumb-style indicator showing current focus path

**2. Keyboard Controls**
- `Tab/Shift+Tab`: Navigate between main sections
- `↑/↓`: Navigate within sections (parameters, approval options, scroll content)
- `Enter`: Expand/collapse sections or select approval option
- `Space`: Toggle expand/collapse for parameters
- `Esc`: Close modal (deny by default)
- `PageUp/PageDown`: Scroll content areas (when scrollable)

**3. Visual Focus Indicators**
- Clear highlighting of active section
- Breadcrumb navigation path
- Scroll position indicators
- Selection highlights within sections

### Phase 3: Content Display Enhancements

**1. Smart Parameter Formatting**
- **Short strings** (`< 100 chars`): Display inline with quotes
- **Long strings**: Show first 100 chars with "[Expand]" option
- **Objects**: Tree-style display with expand/collapse per property
- **Arrays**: Show length and first few items with expand option
- **File paths**: Show file existence, size, permissions where relevant
- **Commands**: Syntax highlighting where possible

**2. Scrollable Content Areas**
- Each parameter detail section independently scrollable
- Maintain scroll position when navigating between sections
- Visual indicators for scrollable content (scrollbars, "more content" hints)
- Smooth scrolling behavior

**3. Special Handling by Tool Type**

**file_write**:
```
Parameters:
▼ path: "src/components/new-file.tsx"
▼ content: [2,847 characters] ▶ Expand
▼ createDirs: true

Content Preview: (scrollable)
┌─────────────────────────────────────┐
│ // ABOUTME: New component file      │
│ import React from 'react';          │
│ import { Box, Text } from 'ink';    │
│ ...                                 │
│ [Showing lines 1-20 of 89]         │
└─────────────────────────────────────┘
```

**bash**:
```
Parameters:
▼ command: "rm -rf /important/data" ⚠️ DANGEROUS

Command Analysis:
- Uses 'rm -rf' (recursive force delete)
- Targets '/important/data' directory
- ⚠️ WARNING: This will permanently delete files
```

**file_edit**:
```
Parameters:
▼ path: "src/config.ts"
▼ old_text: [45 characters] ▶ Expand  
▼ new_text: [52 characters] ▶ Expand

Diff Preview: (scrollable)
┌─────────────────────────────────────┐
│ - const API_URL = 'localhost:3000'; │
│ + const API_URL = 'api.prod.com';   │
│                                     │
│ [1 change in config.ts]             │
└─────────────────────────────────────┘
```

### Phase 4: Implementation Details

**New Components to Create:**

1. **`EnhancedToolApprovalModal`** - Main modal container
   - Replaces current `ToolApprovalModal`
   - Manages tab navigation and focus
   - Coordinates between sections

2. **`ParameterDetailView`** - Expandable parameter display
   - Smart formatting based on data type
   - Expand/collapse functionality
   - Type-specific rendering

3. **`ScrollableContent`** - Wrapper for scrollable areas
   - Based on `ink-scroller` or custom implementation
   - Handles scroll position and indicators
   - Keyboard scroll controls

4. **`NavigationBreadcrumb`** - Shows current focus context
   - Displays current section and parameter
   - Visual navigation aid

5. **`ToolSchemaView`** - Displays tool input schema
   - Shows expected parameter types
   - Helpful for understanding tool requirements

6. **`FilePreview`** - Special handling for file content
   - Syntax highlighting where possible
   - Line numbers and scroll indicators
   - File metadata display

**State Management:**
```typescript
interface ModalState {
  activeSection: 'parameters' | 'schema' | 'preview';
  expandedParameters: Set<string>;
  scrollPositions: Map<string, number>;
  selectedApprovalOption: number;
}
```

**Enhanced Props Interface:**
```typescript
interface EnhancedToolApprovalModalProps {
  toolName: string;
  input: unknown;
  isReadOnly?: boolean;
  onDecision: (decision: ApprovalDecision) => void;
  isVisible: boolean;
  focusId?: string;
  // New props for enhanced functionality
  toolSchema?: ToolSchema;
  maxContentHeight?: number;
  enablePreview?: boolean;
}
```

### Phase 5: Testing Strategy

**1. Unit Tests**
- Test navigation between sections (tab functionality)
- Test expand/collapse functionality for parameters
- Test keyboard shortcuts and focus management
- Test content formatting for different data types
- Test scrolling behavior in content areas

**2. Visual Tests**
- Test with various tool types and parameter structures
- Test with very long content (file contents, long commands)
- Test responsive behavior with different terminal sizes
- Verify focus indicators and visual hierarchy

**3. Integration Tests**
- Test with real tool invocations
- Test approval flow with enhanced modal
- Test focus return to shell input after modal closes
- Test modal behavior during tool execution

**4. Edge Cases**
- Very large file contents (> 10MB)
- Deeply nested object parameters
- Binary or non-text content
- Network timeouts during content preview
- Terminal resize during modal display

## Migration Strategy

**Phase 1**: Create new enhanced modal alongside existing one
**Phase 2**: Feature flag to switch between old and new modal
**Phase 3**: Test extensively with various tool types
**Phase 4**: Replace old modal and remove feature flag
**Phase 5**: Clean up old modal code

## Dependencies

**Required:**
- `ink-scroller` or custom scrolling solution
- Enhanced focus management utilities
- Syntax highlighting library (optional, for code preview)

**Research Needed:**
- Best practices for scrolling in Ink applications
- Performance considerations for large content display
- Accessibility patterns for terminal-based modals

## Success Criteria

1. **Complete content visibility**: Users can view full content of all tool parameters
2. **Efficient navigation**: Users can quickly navigate between sections using keyboard
3. **Scrollable content**: Long content (especially file writes) can be fully reviewed
4. **Maintains performance**: Modal remains responsive even with large content
5. **Preserves existing UX**: Existing approval shortcuts (y/n/s) continue to work
6. **Enhanced discoverability**: Users can understand what tools will do before approval

## Future Enhancements

- Syntax highlighting for code content
- Diff view for file modifications
- Content search within modal
- Export/save functionality for large content review
- Integration with external diff tools
- Customizable display preferences