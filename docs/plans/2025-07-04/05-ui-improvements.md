# Multi-Agent UI Implementation Specification

## Overview
Add a tmux/screen-style interface for switching between agents, showing agent status, and managing multi-agent sessions. This builds on the existing Ink/React terminal UI.

## Background for Engineers

### Current UI
- Single conversation view
- React-based using Ink (terminal renderer)
- Located in `src/interfaces/terminal-interface.tsx`
- Tool approval modals
- Thinking indicators

### What We're Building
- Status bar showing all agents
- Keyboard shortcuts for switching
- Visual agent state indicators
- Task dashboard view
- Queue status display

### Key Files to Understand
- `src/interfaces/terminal-interface.tsx` - Main UI component
- `src/interfaces/components/` - UI components
- `src/interfaces/tool-renderers/` - Tool-specific displays
- `ink` - React renderer for terminal (npm package)

## Ink/React Primer for Terminal UI

### Ink Basics
```typescript
// Regular React, but renders to terminal
import { Box, Text, useInput, useApp } from 'ink';

// Box = div-like container
// Text = text content
// No CSS - use props for styling

<Box flexDirection="column" borderStyle="single">
  <Text bold color="green">Hello</Text>
  <Text dim>World</Text>
</Box>
```

### Key Differences from Web React
- No onClick - use useInput hook for keyboard
- No CSS - style via props (color, bold, dim, etc)
- Layout via flexbox props on Box
- Limited to terminal capabilities
- Must handle terminal resize

## Implementation Plan

### Phase 1: Agent Status Bar

**Task 1.1: Create AgentStatusBar component**

File: `src/interfaces/components/agent-status-bar.tsx` (new)

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { AgentMetadata } from '../../sessions/types.js';

interface AgentStatusBarProps {
  agents: AgentMetadata[];
  activeAgentId?: string;
  queueCounts?: Record<string, number>;
}

export const AgentStatusBar: React.FC<AgentStatusBarProps> = ({
  agents,
  activeAgentId,
  queueCounts = {}
}) => {
  return (
    <Box 
      borderStyle="single" 
      borderTop={false} 
      borderLeft={false} 
      borderRight={false}
      paddingX={1}
    >
      {agents.map((agent, index) => (
        <AgentTab
          key={agent.id}
          agent={agent}
          isActive={agent.id === activeAgentId}
          queueCount={queueCounts[agent.id] || 0}
          shortcut={index + 1}
        />
      ))}
      <Box marginLeft={1}>
        <Text dim>[+New]</Text>
      </Box>
    </Box>
  );
};

const AgentTab: React.FC<{
  agent: AgentMetadata;
  isActive: boolean;
  queueCount: number;
  shortcut: number;
}> = ({ agent, isActive, queueCount, shortcut }) => {
  const getStatusIcon = () => {
    switch (agent.state) {
      case 'active': return agent.currentTask ? '◐' : '';
      case 'suspended': return '⏸';
      case 'completed': return '✓';
      default: return '';
    }
  };
  
  return (
    <Box marginRight={1}>
      <Text 
        bold={isActive}
        color={isActive ? 'cyan' : undefined}
        dimColor={agent.state === 'suspended'}
      >
        [{shortcut}:{agent.name}
        {isActive && '*'}
        {getStatusIcon()}
        {queueCount > 0 && `(${queueCount})`}
        {agent.currentTask && `:${agent.currentTask.slice(0, 20)}`}]
      </Text>
    </Box>
  );
};
```

Tests:
- Test renders all agents
- Test active agent highlighted
- Test status icons correct
- Test queue counts shown

**Commit**: "feat: add agent status bar component"

**Task 1.2: Integrate status bar into main UI**

File: `src/interfaces/terminal-interface.tsx`

Add status bar to layout:
```typescript
return (
  <Box flexDirection="column" height="100%">
    {/* Existing header */}
    <Header />
    
    {/* Main content area */}
    <Box flexGrow={1} flexDirection="column">
      <MessageList messages={displayMessages} />
      <InputArea />
    </Box>
    
    {/* New status bar - always at bottom */}
    <AgentStatusBar 
      agents={visibleAgents}
      activeAgentId={currentAgent?.id}
      queueCounts={queueCounts}
    />
  </Box>
);
```

Note: Filter agents to hide completed ephemeral ones.

Tests:
- Test status bar positioning
- Test updates with agent changes

**Commit**: "feat: integrate agent status bar"

### Phase 2: Keyboard Navigation

**Task 2.1: Add keyboard shortcuts**

File: `src/interfaces/hooks/use-agent-shortcuts.ts` (new)

```typescript
import { useInput } from 'ink';
import { useState, useCallback } from 'react';

export const useAgentShortcuts = (
  agents: AgentMetadata[],
  onSwitch: (agentId: string) => void,
  onCreate: () => void
) => {
  const [isCtrlA, setIsCtrlA] = useState(false);
  
  useInput((input, key) => {
    // Ctrl+A activates command mode
    if (key.ctrl && input === 'a') {
      setIsCtrlA(true);
      setTimeout(() => setIsCtrlA(false), 2000); // timeout
      return;
    }
    
    if (isCtrlA) {
      // Number keys switch agents
      const num = parseInt(input);
      if (num >= 1 && num <= 9 && agents[num - 1]) {
        onSwitch(agents[num - 1].id);
        setIsCtrlA(false);
      }
      
      // 'c' creates new agent
      if (input === 'c') {
        onCreate();
        setIsCtrlA(false);
      }
      
      // 'n' next agent, 'p' previous
      if (input === 'n' || input === 'p') {
        // Implementation
      }
    }
  });
  
  return { isCommandMode: isCtrlA };
};
```

Tests:
- Test Ctrl+A activation
- Test number switching
- Test create shortcut
- Test timeout

**Commit**: "feat: add agent keyboard shortcuts"

**Task 2.2: Add help overlay**

File: `src/interfaces/components/help-overlay.tsx` (new)

Show available commands when in command mode:

```typescript
export const HelpOverlay: React.FC<{ isVisible: boolean }> = ({ isVisible }) => {
  if (!isVisible) return null;
  
  return (
    <Box
      position="absolute"
      bottom={2}
      left={2}
      borderStyle="round"
      padding={1}
    >
      <Box flexDirection="column">
        <Text bold>Agent Commands:</Text>
        <Text>1-9  Switch to agent</Text>
        <Text>c    Create new agent</Text>
        <Text>n/p  Next/previous agent</Text>
        <Text>d    Task dashboard</Text>
        <Text>?    Show this help</Text>
      </Box>
    </Box>
  );
};
```

**Commit**: "feat: add command help overlay"

### Phase 3: Task Dashboard View

**Task 3.1: Create TaskDashboard component**

File: `src/interfaces/components/task-dashboard.tsx` (new)

```typescript
interface TaskDashboardProps {
  tasks: Task[];
  agents: AgentMetadata[];
  onClose: () => void;
}

export const TaskDashboard: React.FC<TaskDashboardProps> = ({
  tasks,
  agents,
  onClose
}) => {
  useInput((input) => {
    if (input === 'q' || input === '\x1B') { // q or ESC
      onClose();
    }
  });
  
  const groupedTasks = groupTasksByStatus(tasks);
  
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Task Dashboard</Text>
        <Text dim> (Press q to close)</Text>
      </Box>
      
      <TaskSection title="ACTIVE" tasks={groupedTasks.active} />
      <TaskSection title="BLOCKED" tasks={groupedTasks.blocked} />
      <TaskSection title="COMPLETED" tasks={groupedTasks.completed} />
    </Box>
  );
};

const TaskSection: React.FC<{
  title: string;
  tasks: Task[];
}> = ({ title, tasks }) => {
  if (tasks.length === 0) return null;
  
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="yellow">{title}</Text>
      {tasks.map(task => (
        <TaskRow key={task.id} task={task} />
      ))}
    </Box>
  );
};
```

Tests:
- Test task grouping
- Test keyboard navigation
- Test empty sections hidden

**Commit**: "feat: add task dashboard view"

### Phase 4: Visual Enhancements

**Task 4.1: Add agent state indicators**

File: `src/interfaces/components/agent-indicator.tsx` (new)

Visual representation of agent activity:

```typescript
export const AgentIndicator: React.FC<{
  agent: AgentMetadata;
  isThinking: boolean;
  toolsRunning: number;
}> = ({ agent, isThinking, toolsRunning }) => {
  const getStateColor = () => {
    if (isThinking) return 'yellow';
    if (toolsRunning > 0) return 'blue';
    if (agent.state === 'suspended') return 'gray';
    return 'green';
  };
  
  return (
    <Box>
      <Text color={getStateColor()}>
        {isThinking && '🤔 '}
        {toolsRunning > 0 && `🔧×${toolsRunning} `}
        {agent.name}
      </Text>
    </Box>
  );
};
```

**Commit**: "feat: add visual agent indicators"

**Task 4.2: Add notification toast**

File: `src/interfaces/components/notification-toast.tsx` (new)

Show temporary notifications:

```typescript
export const NotificationToast: React.FC<{
  message: string;
  type: 'info' | 'success' | 'warning';
  duration?: number;
}> = ({ message, type, duration = 3000 }) => {
  const [isVisible, setIsVisible] = useState(true);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(false), duration);
    return () => clearTimeout(timer);
  }, [duration]);
  
  if (!isVisible) return null;
  
  const colors = {
    info: 'blue',
    success: 'green',
    warning: 'yellow'
  };
  
  return (
    <Box
      position="absolute"
      top={1}
      right={1}
      borderStyle="round"
      padding={1}
    >
      <Text color={colors[type]}>{message}</Text>
    </Box>
  );
};
```

Use for:
- Agent switched
- Task completed
- Message queued

**Commit**: "feat: add notification toasts"

### Phase 5: Polish & Integration

**Task 5.1: Add smooth transitions**

Since terminal UI can't animate, use visual feedback:

```typescript
// Flash effect when switching agents
const FlashBox: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [flash, setFlash] = useState(false);
  
  useEffect(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 200);
  }, []);
  
  return (
    <Box borderStyle={flash ? 'double' : 'single'}>
      {children}
    </Box>
  );
};
```

**Commit**: "feat: add visual feedback for actions"

**Task 5.2: Responsive layout**

Handle terminal resize:

```typescript
import { useStdout } from 'ink';

const useTerminalSize = () => {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout.columns,
    rows: stdout.rows
  });
  
  useEffect(() => {
    const handler = () => setSize({
      columns: stdout.columns,
      rows: stdout.rows
    });
    
    stdout.on('resize', handler);
    return () => stdout.off('resize', handler);
  }, [stdout]);
  
  return size;
};
```

Adjust layout based on size:
- Hide task descriptions if narrow
- Abbreviate agent names if needed
- Stack vs inline layouts

**Commit**: "feat: add responsive terminal layout"

## Testing Strategy

### Component Tests
- Use React Testing Library
- Test keyboard interactions
- Test state updates
- Mock Ink components

### Visual Tests
- Manual testing crucial
- Test in different terminal sizes
- Test with many agents
- Test color schemes

### Integration Tests
- Test with real agent switching
- Test task updates
- Test notification flow

## Ink/React Best Practices

### Performance
- Minimize re-renders
- Use React.memo for static content
- Avoid deep component trees
- Profile with React DevTools

### Accessibility
- Provide keyboard shortcuts
- Show help text
- Use clear visual indicators
- Support monochrome terminals

### Common Patterns
```typescript
// Conditional rendering
{isVisible && <Component />}

// Lists with keys
{items.map(item => (
  <Item key={item.id} {...item} />
))}

// Input handling
useInput((input, key) => {
  // key has: ctrl, shift, meta, escape, etc
});
```

## Error Handling

- Graceful degradation if terminal too small
- Handle missing agent data
- Catch rendering errors
- Provide fallback UI

## Future Enhancements

- Split pane view (multiple agents)
- Agent communication visualization
- Task timeline view
- Performance metrics display

## Rollout

1. Feature flag new UI components
2. Test with power users
3. Gather feedback on shortcuts
4. Progressive enhancement