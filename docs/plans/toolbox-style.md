# Timeline Entry Toolbox-Style Visual Enhancement

## Overview

This document specifies the implementation of enhanced visual styling for timeline entries that displays tool execution status through custom side markers, replacing the current border-based approach with character-based rendering.

## Current State

### Existing Components
- `TimelineEntryCollapsibleBox.tsx`: Wrapper with standardized padding
- `CollapsibleBox.tsx`: Uses Ink's `borderStyle` system for full borders
- Tool renderers: Display status via icons (`✔`, `✘`, `⧖`) in content area

### Current Visual System
```
┌─────────────────────┐
│ ▶ Tool: bash        │
│   Command output... │
│                     │
└─────────────────────┘
```

### Limitations
1. Ink borders draw complete boxes (all 4 sides)
2. Single-line entries forced to 3+ lines due to border padding
3. No visual connection between side markers and tool execution status
4. Status only shown via content-area icons

## Requirements

### Visual Design Goals
Based on the provided screenshot reference, implement custom side markers that:

1. **Replace full borders** with left-side character markers only
2. **Show tool execution status** through color-coded side markers
3. **Optimize single-line display** with compact character choice
4. **Maintain expansion/collapse** functionality

### Character Selection Rules

| Content Height | Character Pattern | Example |
|---------------|-------------------|---------|
| 1 line | `⊂` | `⊂ Tool completed successfully` |
| 2 lines | `╭` (top) + `╰` (bottom) | `╭ Tool: bash`<br>`╰ exit code: 0` |
| 3+ lines | `╭` (top) + `│` (middle) + `╰` (bottom) | `╭ Tool: bash`<br>`│ line 1 output`<br>`│ line 2 output`<br>`╰ exit code: 0` |

### Color Scheme

| Status | Unfocused (Dark) | Focused (Bright) | Use Case |
|--------|------------------|------------------|----------|
| `none` | `gray` | `white` | Non-tool timeline items |
| `pending` | `yellow` | `yellow` (bright) | Tool currently executing |
| `success` | `green` | `green` (bright) | Tool completed successfully |
| `error` | `red` | `red` (bright) | Tool failed with error |

## Technical Design

### Component Architecture

```
TimelineEntryCollapsibleBox (modified)
├── SideMarkerRenderer
│   ├── Status detection logic
│   ├── Height measurement
│   ├── Character selection
│   └── Color application
├── Content Area (existing)
└── Expansion Management (existing)
```

### API Design

#### Enhanced TimelineEntryCollapsibleBox Props
```typescript
interface TimelineEntryCollapsibleBoxProps {
  // Existing props
  children: React.ReactNode;
  label?: string | React.ReactNode;
  summary?: React.ReactNode;
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  maxHeight?: number;
  isSelected?: boolean;
  isFocused?: boolean;
  onToggle?: () => void;
  
  // New props
  status?: 'none' | 'pending' | 'success' | 'error';
  contentHeight?: number; // Override automatic height detection
}
```

#### Internal SideMarkerRenderer Component
```typescript
interface SideMarkerRendererProps {
  status: 'none' | 'pending' | 'success' | 'error';
  isSelected: boolean;
  contentHeight: number;
  children: React.ReactNode;
}
```

### Implementation Strategy

#### 1. Theme System Extension
Extend `src/interfaces/terminal/theme.ts`:
```typescript
export const UI_SYMBOLS = {
  // ... existing symbols
  
  // Toolbox markers
  TOOLBOX_SINGLE: '⊂',
  TOOLBOX_TOP: '╭',
  TOOLBOX_MIDDLE: '│',
  TOOLBOX_BOTTOM: '╰',
};

export const UI_COLORS = {
  // ... existing colors
  
  // Toolbox status colors (unfocused)
  TOOLBOX_NONE: 'gray',
  TOOLBOX_PENDING: 'yellow',
  TOOLBOX_SUCCESS: 'green', 
  TOOLBOX_ERROR: 'red',
  
  // Toolbox status colors (focused/bright)
  TOOLBOX_NONE_BRIGHT: 'white',
  TOOLBOX_PENDING_BRIGHT: 'yellowBright',
  TOOLBOX_SUCCESS_BRIGHT: 'greenBright',
  TOOLBOX_ERROR_BRIGHT: 'redBright',
};
```

#### 2. Height Detection Logic
```typescript
function detectContentHeight(children: React.ReactNode): number {
  // Use existing measurement system from timeline viewport
  // Or provide manual override via contentHeight prop
  // Return: 1 for single line, 2+ for multi-line
}
```

#### 3. Character Selection Logic
```typescript
function getMarkerCharacters(height: number): {
  top?: string;
  middle?: string;
  bottom?: string;
  single?: string;
} {
  if (height === 1) {
    return { single: UI_SYMBOLS.TOOLBOX_SINGLE };
  } else if (height === 2) {
    return { 
      top: UI_SYMBOLS.TOOLBOX_TOP, 
      bottom: UI_SYMBOLS.TOOLBOX_BOTTOM 
    };
  } else {
    return {
      top: UI_SYMBOLS.TOOLBOX_TOP,
      middle: UI_SYMBOLS.TOOLBOX_MIDDLE,
      bottom: UI_SYMBOLS.TOOLBOX_BOTTOM
    };
  }
}
```

#### 4. Color Selection Logic
```typescript
function getMarkerColor(status: Status, isSelected: boolean): string {
  const colorMap = {
    none: isSelected ? UI_COLORS.TOOLBOX_NONE_BRIGHT : UI_COLORS.TOOLBOX_NONE,
    pending: isSelected ? UI_COLORS.TOOLBOX_PENDING_BRIGHT : UI_COLORS.TOOLBOX_PENDING,
    success: isSelected ? UI_COLORS.TOOLBOX_SUCCESS_BRIGHT : UI_COLORS.TOOLBOX_SUCCESS,
    error: isSelected ? UI_COLORS.TOOLBOX_ERROR_BRIGHT : UI_COLORS.TOOLBOX_ERROR,
  };
  return colorMap[status];
}
```

### Rendering Strategy

#### Replace Border-Based Approach
```typescript
// OLD: CollapsibleBox with borders
<CollapsibleBox borderStyle="single" borderColor="gray">
  {children}
</CollapsibleBox>

// NEW: Custom side marker rendering
<Box flexDirection="row">
  <SideMarkerRenderer 
    status={status} 
    isSelected={isSelected}
    contentHeight={contentHeight}
  >
    {children}
  </SideMarkerRenderer>
</Box>
```

#### SideMarkerRenderer Implementation
```typescript
function SideMarkerRenderer({ status, isSelected, contentHeight, children }: Props) {
  const markers = getMarkerCharacters(contentHeight);
  const color = getMarkerColor(status, isSelected);
  
  if (markers.single) {
    // Single line layout
    return (
      <Box flexDirection="row">
        <Text color={color}>{markers.single} </Text>
        <Box flexDirection="column" flexGrow={1}>
          {children}
        </Box>
      </Box>
    );
  }
  
  // Multi-line layout with positioned markers
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" marginRight={1}>
        <Text color={color}>{markers.top}</Text>
        {Array.from({ length: contentHeight - 2 }, (_, i) => (
          <Text key={i} color={color}>{markers.middle}</Text>
        ))}
        <Text color={color}>{markers.bottom}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
```

## Integration Points

### 1. Status Propagation
Update tool renderers to pass status information:
```typescript
// In tool renderer components
<TimelineEntryCollapsibleBox
  status={getToolStatus(result, isStreaming)}
  // ... other props
>
```

### 2. Height Coordination
Leverage existing measurement system from `useTimelineViewport`:
```typescript
// Use existing itemRefs and measureElement system
// Or provide manual height hints for known content types
```

### 3. Non-Tool Timeline Items
For user messages, system messages, etc., use `status="none"` to maintain current visual behavior with grey markers.

## Implementation Steps

### Phase 1: Core Infrastructure
1. **Extend theme system** with new symbols and colors
2. **Create SideMarkerRenderer component** with basic character/color logic
3. **Add unit tests** for character selection and color logic

### Phase 2: Integration
4. **Modify TimelineEntryCollapsibleBox** to use SideMarkerRenderer
5. **Update tool renderers** to pass status information
6. **Add height detection** integration with measurement system

### Phase 3: Polish & Testing
7. **Test with various content heights** and status combinations
8. **Verify accessibility** with different terminal color schemes
9. **Performance testing** to ensure no rendering regressions
10. **Update documentation** and visual examples

## Testing Strategy

### Unit Tests
- Character selection logic for different heights
- Color selection logic for different status/selection combinations
- Height detection accuracy
- Props validation and defaults

### Integration Tests
- Rendering with different tool execution states
- Expansion/collapse behavior preservation
- Focus state visual changes
- Non-tool timeline item appearance

### Visual Tests
- Screenshot comparisons for different status states
- Terminal compatibility testing (different color schemes)
- Character rendering in various terminal emulators

## Backwards Compatibility

### Graceful Degradation
- **Missing status prop**: Default to `status="none"`
- **Height detection failure**: Fallback to 3-line bracket style
- **Color support**: Graceful fallback for terminals without color support

### Migration Path
1. **Phase 1**: Add new props as optional, maintain existing behavior
2. **Phase 2**: Update tool renderers to provide status information
3. **Phase 3**: Remove old border-based rendering code

## Success Criteria

1. **Visual Improvement**: Timeline entries show clear tool execution status
2. **Space Efficiency**: Single-line entries use minimal vertical space
3. **Performance**: No measurable rendering performance regression
4. **Functionality**: All existing expansion/collapse behavior preserved
5. **Consistency**: Visual design aligns with provided screenshot reference

## Future Enhancements

### Potential Extensions
1. **Animation**: Subtle transitions for status changes
2. **Progress Indicators**: Enhanced pending state with progress bars
3. **Nested Status**: Support for nested tool execution status
4. **Customization**: User-configurable color schemes and characters

### Accessibility Considerations
1. **High Contrast**: Alternative color schemes for accessibility
2. **Character Alternatives**: ASCII fallbacks for limited terminal support
3. **Screen Readers**: Proper ARIA-like annotations for terminal readers