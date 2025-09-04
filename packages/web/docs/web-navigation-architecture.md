# Web Navigation Architecture

## React Router v7 Concurrent Rendering

This project uses React Router v7, which introduces important behavioral changes
around component rendering during navigation that developers need to understand.

### Key Behavior: Multiple Component Instances During Navigation

React Router v7 uses React's `startTransition` feature for navigation, which
means:

1. **Multiple route components can render simultaneously** during navigation
   transitions
2. **Both the "old" and "new" route components may be mounted** briefly during
   navigation
3. **This is intentional behavior** for better perceived performance (concurrent
   rendering)
4. **Components should not assume they are the only instance** at any given time

### Common Issues and Solutions

#### 1. Duplicate React Keys

**Problem**: Multiple component instances rendering the same data can create
duplicate React keys, causing warnings and rendering issues.

**Example Error**:

```
Warning: Encountered two children with the same key, `1756958145667-94`.
Keys should be unique so that components maintain their identity across updates.
```

**Solution**: Include component instance IDs in keys to ensure uniqueness across
instances:

```tsx
export function MyComponent() {
  // Generate unique instance ID
  const instanceId = useRef(
    `comp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
  );

  return (
    <div>
      {items.map((item, index) => (
        <div
          key={item.id || `${instanceId.current}-${item.timestamp}-${index}`}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
```

#### 2. State Bleeding Between Routes

**Problem**: Components showing stale data from previously selected entities
(agents, sessions, etc.) during navigation.

**Solution**: Add keys to components that depend on URL parameters to force
remounting:

```tsx
// In route component
<MyComponent key={paramThatChanged} />;

// In parent component
{
  selectedAgent && (
    <AgentSpecificComponent
      key={`${sessionId}-${selectedAgent}`}
      agentId={selectedAgent}
    />
  );
}
```

#### 3. Visual Highlighting Conflicts

**Problem**: Selection highlighting (borders, backgrounds) appearing on wrong
items during navigation.

**Root Cause**: Multiple component instances with different selection states
rendering simultaneously.

**Solution**: Force component remounting when selection changes:

```tsx
// Force remount when selection-dependent props change
<SelectableList key={`${contextId}-${selectedItem}`} />
```

### Implementation Examples

The following components were fixed using these patterns:

- **AgentsSection**: Added key based on sessionId + selectedAgent to prevent
  highlight flashing
- **Chat/TimelineView**: Added instance IDs to prevent duplicate React keys
  during navigation
- **EventStreamProvider**: Added key based on agentId to prevent data mixing

### Development Guidelines

When building components that:

1. **Display selection state** (highlighting, borders, active states)
2. **Render lists with dynamic keys**
3. **Depend on URL parameters**

Always consider React Router v7's concurrent rendering and:

- ✅ **Use unique instance IDs in React keys**
- ✅ **Add component keys based on critical props** that should trigger
  remounting
- ✅ **Test navigation flows** to ensure no stale state or visual conflicts
- ❌ **Don't assume your component is the only instance**
- ❌ **Don't rely on component unmounting immediately** after navigation

### Combined with React.StrictMode

In development, React.StrictMode intentionally double-renders components, which
compounds the concurrent rendering behavior. This is normal and helps catch side
effects, but means you may see even more component instances during development.

### Debugging Tips

Add instance tracking to components during development:

```tsx
const instanceId = useRef(
  `comp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
);
console.log(`[ComponentName-${instanceId.current}] RENDER`);
```

This helps identify when multiple instances are active and causing conflicts.
