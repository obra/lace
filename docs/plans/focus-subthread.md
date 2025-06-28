# Focus Into Delegate Thread - Simple Approach

## YAGNI Implementation

Just expand DelegationBox in place when Enter is pressed. No new components, no mode switching, no position tracking.

## User Experience

1. User navigates to a collapsed DelegationBox 
2. User presses **Enter** → DelegationBox expands and gains focus
3. Arrow keys navigate within the expanded delegate timeline
4. User presses **Escape** → focus returns to main timeline navigation

That's it.

## Implementation

### Minimal Changes Required

**DelegationBox.tsx**
```typescript
// Add keyboard handler
useKeyboardShortcut('Enter', () => {
  if (isSelected) {
    setExpanded(true);
    // Focus moves into the TimelineDisplay inside this box
  }
});
```

**TimelineDisplay.tsx** 
```typescript
// When TimelineDisplay inside DelegationBox has focus:
useKeyboardShortcut('Escape', () => {
  if (isInsideDelegationBox) {
    // Return focus to parent timeline
    onEscapeToParent();
  }
});
```

## What This Gives Us

- ✅ Enter expands delegate content with focus
- ✅ Escape returns to main navigation  
- ✅ Uses existing expand/collapse UI
- ✅ Zero new components
- ✅ Zero state management complexity
- ✅ Works with existing focus system

## What We Don't Build (Yet)

- ❌ Full-screen delegate view
- ❌ Breadcrumbs
- ❌ Position restoration  
- ❌ Nested delegate navigation
- ❌ Transition animations

## Implementation Effort

**1 hour** - Add Enter/Escape key handlers to existing components.

We can always add the fancy stuff later if users actually want it.