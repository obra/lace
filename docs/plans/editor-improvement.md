# Shell Input Editor Improvement Plan

## Problem Statement

The current `src/interfaces/terminal/components/shell-input.tsx` has several usability issues:
- Cursor gets stuck on the top line during text overflow
- Pasting doesn't work
- Generally less robust than the original implementation

## Analysis

After comparing the current implementation with the original at `/Users/jesse/git/lace/src/ui/components/ShellInput.tsx`, several key differences explain the problems:

### Original Implementation Strengths
1. **Better key handling**: Proper debug logging (`bufferOps.addDebug`) and cleaner key event processing
2. **More comprehensive completion system**: Uses a full `CompletionManager` with proper context and item types
3. **Viewport scrolling**: Has proper completion scrolling with viewport management
4. **Better state management**: More sophisticated completion state with proper prefix tracking

### Current Implementation Problems
1. **Backwards key mappings** (lines 257-263): `delete` mapped to backward and `backspace` mapped to forward - backwards from normal expectations
2. **Missing paste support**: No clipboard handling code
3. **Simpler autocomplete**: Uses basic file scanning vs comprehensive completion system
4. **No debug capabilities**: Missing the `addDebug` functionality that helps with development
5. **Less robust text rendering**: The `TextRenderer` is being passed fewer props

## Root Causes

- **Cursor getting stuck**: Likely related to text buffer implementation differences and cursor positioning during text wrapping
- **Paste not working**: Original has better input handling and may have clipboard integration that current version lacks

## Implementation Plan

### Phase 1: Fix Critical Key Mappings
- [ ] Swap delete/backspace key mappings (lines 257-263)
- [ ] Verify arrow key behavior matches expectations

### Phase 2: Restore Debug Capabilities
- [ ] Add back `addDebug` functionality to buffer operations
- [ ] Ensure debug logging works for key event troubleshooting

### Phase 3: Import Robust Completion System
- [ ] Import the sophisticated `CompletionManager` system from original
- [ ] Implement viewport scrolling for completions
- [ ] Add proper completion context and item type handling

### Phase 4: Text Buffer Improvements
- [ ] Compare `useTextBuffer` implementations
- [ ] Fix cursor positioning during text wrapping
- [ ] Ensure proper multi-line text handling

### Phase 5: Add Paste Support
- [ ] Investigate original's clipboard integration
- [ ] Implement paste functionality
- [ ] Test with various clipboard content types

### Phase 6: TextRenderer Enhancement
- [ ] Ensure all necessary props are passed to TextRenderer
- [ ] Verify text rendering matches original behavior
- [ ] Test edge cases like long lines and multi-line content

## Success Criteria

- [ ] Cursor moves correctly during text overflow
- [ ] Paste functionality works reliably
- [ ] Autocomplete behaves like the original
- [ ] No regression in existing functionality
- [ ] Debug capabilities available for future troubleshooting

## Testing Strategy

1. **Manual testing**: Type long lines, test cursor movement, paste content
2. **Comparison testing**: Side-by-side behavior comparison with original
3. **Edge case testing**: Very long inputs, multi-line content, special characters
4. **Autocomplete testing**: File completion, command completion, navigation

## Notes

The original implementation is significantly more mature and robust. Rather than trying to fix individual issues, consider selectively importing the working patterns from the original while maintaining compatibility with the current architecture.