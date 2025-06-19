# Terminal Messages Architecture Redesign

## Overview

This plan outlines the redesign of the terminal interface message display system to support specialized event components and hierarchical subagent conversations. The goal is to move from the current flat message display to a rich, structured event-based rendering system.

## Current Architecture Issues

### Flattened Event Display
- Thread events (TOOL_CALL, TOOL_RESULT) are converted to simple text messages
- Structured data is lost in the conversion to UIMessage
- No specialized rendering for different event types
- Tool calls and results display as generic "🔧 Running: toolName" messages

### No Subagent Support
- Current architecture assumes linear conversation flow
- No visual hierarchy for agent delegation
- Subagent conversations would be indistinguishable from main conversation

## Target Architecture: Event-Component Mapping

### Core Design Principles

1. **Direct Event Rendering**: Map thread events directly to specialized Ink components
2. **Hierarchical Display**: Support nested conversation contexts for subagent delegation
3. **Structured Data Preservation**: Maintain rich event data throughout the rendering pipeline
4. **Extensible Component System**: Easy to add new event types and display modes

### Event Type Extensions

```typescript
interface ThreadEvent {
  id: string;
  threadId: string;
  parentEventId?: string;    // NEW: Links to parent event for nesting
  agentContext?: {           // NEW: Agent hierarchy tracking
    agentId: string;
    parentAgentId?: string;
    depth: number;
  };
  type: EventType;
  timestamp: Date;
  data: EventData;
}

// NEW: Subagent delegation event
type EventType = 'USER_MESSAGE' | 'AGENT_MESSAGE' | 'TOOL_CALL' | 'TOOL_RESULT' | 
                 'LOCAL_SYSTEM_MESSAGE' | 'SUBAGENT_DELEGATION';

interface SubagentDelegationData {
  parentAgentId: string;
  subagentId: string;
  task: string;
  subthreadId: string;
}
```

## Implementation Plan

### Phase 1: Specialized Event Components

#### 1.1 Core Event Display Infrastructure

Create new component system in `src/interfaces/terminal/components/events/`:

```
src/interfaces/terminal/components/events/
├── EventDisplay.tsx          # Main event router component
├── ToolCallDisplay.tsx       # Rich tool call visualization  
├── ToolResultDisplay.tsx     # Rich tool result visualization
├── UserMessageDisplay.tsx    # User message component
├── AgentMessageDisplay.tsx   # Agent message component
├── SystemMessageDisplay.tsx  # System message component
└── SubagentDisplay.tsx       # Subagent delegation component
```

#### 1.2 Event Component Mapping

```typescript
// EventDisplay.tsx
import { Box } from 'ink';

const eventComponentMap = {
  'TOOL_CALL': ToolCallDisplay,
  'TOOL_RESULT': ToolResultDisplay, 
  'USER_MESSAGE': UserMessageDisplay,
  'AGENT_MESSAGE': AgentMessageDisplay,
  'LOCAL_SYSTEM_MESSAGE': SystemMessageDisplay,
  'SUBAGENT_DELEGATION': SubagentDisplay,
} as const;

interface EventDisplayProps {
  event: ThreadEvent;
  isStreaming?: boolean;
}

export function EventDisplay({ event, isStreaming }: EventDisplayProps) {
  const Component = eventComponentMap[event.type];
  
  return (
    <Box flexDirection="column">
      <Component event={event} isStreaming={isStreaming} />
    </Box>
  );
}
```

#### 1.3 Specialized Component Examples

```typescript
// ToolCallDisplay.tsx
import { Box, Text } from 'ink';
import { CollapsibleBox } from '../ui/CollapsibleBox.js';

interface ToolCallDisplayProps {
  event: ThreadEvent<ToolCallData>;
  isStreaming?: boolean;
}

export function ToolCallDisplay({ event }: ToolCallDisplayProps) {
  const { toolName, input, callId } = event.data;
  
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="yellow">🔧 </Text>
        <Text color="yellow" bold>{toolName}</Text>
        <Text color="gray"> #{callId.slice(-6)}</Text>
      </Box>
      
      <CollapsibleBox 
        label="Input Parameters"
        defaultExpanded={false}
        maxHeight={10}
      >
        <Text>{JSON.stringify(input, null, 2)}</Text>
      </CollapsibleBox>
    </Box>
  );
}

// ToolResultDisplay.tsx  
import { Box, Text } from 'ink';

interface ToolResultDisplayProps {
  event: ThreadEvent<ToolResultData>;
}

export function ToolResultDisplay({ event }: ToolResultDisplayProps) {
  const { callId, output, success, error } = event.data;
  const color = success ? 'green' : 'red';
  const icon = success ? '✅' : '❌';
  
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={color}>{icon} Tool Result </Text>
        <Text color="gray">#{callId.slice(-6)}</Text>
      </Box>
      
      <Box marginLeft={2}>
        {success ? (
          <Text wrap="wrap">{output}</Text>
        ) : (
          <Text color="red">{error}</Text>
        )}
      </Box>
    </Box>
  );
}
```

### Phase 2: Hierarchical Conversation Display

#### 2.1 Conversation Tree Structure

```typescript
// src/interfaces/terminal/components/ConversationDisplay.tsx
import { Box } from 'ink';

interface ConversationTreeNode {
  id: string;
  agentContext?: AgentContext;
  events: ThreadEvent[];
  children: ConversationTreeNode[];
}

interface ConversationDisplayProps {
  events: ThreadEvent[];
}

export function ConversationDisplay({ events }: ConversationDisplayProps) {
  const conversationTree = buildConversationTree(events);
  
  return (
    <Box flexDirection="column">
      {conversationTree.map(node => (
        <ConversationNode key={node.id} node={node} />
      ))}
    </Box>
  );
}
```

#### 2.2 Nested Conversation Rendering

```typescript
// ConversationNode.tsx
import { Box, Text } from 'ink';
import { CollapsibleBox } from '../ui/CollapsibleBox.js';

interface ConversationNodeProps {
  node: ConversationTreeNode;
}

export function ConversationNode({ node }: ConversationNodeProps) {
  const isSubagent = node.agentContext?.parentAgentId;
  const depth = node.agentContext?.depth || 0;
  
  return (
    <Box flexDirection="column" marginLeft={depth * 2}>
      {isSubagent && (
        <SubagentHeader agentContext={node.agentContext} />
      )}
      
      <CollapsibleBox
        defaultExpanded={!isSubagent}
        label={isSubagent ? `Subagent: ${node.agentContext.agentId}` : undefined}
        borderStyle="round"
        borderColor={getDepthColor(depth)}
      >
        <Box flexDirection="column">
          {node.events.map(event => (
            <EventDisplay key={event.id} event={event} />
          ))}
        </Box>
      </CollapsibleBox>
      
      {/* Render child conversations */}
      {node.children.map(child => (
        <ConversationNode key={child.id} node={child} />
      ))}
    </Box>
  );
}

function getDepthColor(depth: number): string {
  const colors = ['blue', 'green', 'magenta', 'cyan', 'yellow'];
  return colors[depth % colors.length];
}
```

### Phase 3: Supporting UI Components

#### 3.1 Collapsible Content Component

```typescript
// src/interfaces/terminal/components/ui/CollapsibleBox.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface CollapsibleBoxProps {
  children: React.ReactNode;
  label?: string;
  defaultExpanded?: boolean;
  maxHeight?: number;
  borderStyle?: 'single' | 'double' | 'round';
  borderColor?: string;
}

export function CollapsibleBox({ 
  children, 
  label, 
  defaultExpanded = true,
  maxHeight,
  borderStyle = 'single',
  borderColor = 'gray'
}: CollapsibleBoxProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  useInput((input, key) => {
    if (key.return && label) {
      setIsExpanded(!isExpanded);
    }
  });
  
  return (
    <Box flexDirection="column">
      {label && (
        <Box>
          <Text color={borderColor}>
            {isExpanded ? '▼' : '▶'} {label}
          </Text>
          <Text color="gray"> (press Enter to toggle)</Text>
        </Box>
      )}
      
      {isExpanded && (
        <Box 
          borderStyle={borderStyle}
          borderColor={borderColor}
          flexDirection="column"
          height={maxHeight}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}
```

#### 3.2 Code Syntax Highlighting

```typescript
// src/interfaces/terminal/components/ui/CodeBlock.tsx
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

interface CodeBlockProps {
  content: string;
  language?: string;
  maxLines?: number;
}

export function CodeBlock({ content, language = 'json', maxLines }: CodeBlockProps) {
  const highlighted = highlight(content, { language });
  const lines = highlighted.split('\n');
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines;
  const truncated = maxLines && lines.length > maxLines;
  
  return (
    <Box flexDirection="column" marginLeft={1}>
      {displayLines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      {truncated && (
        <Text color="gray">... ({lines.length - maxLines} more lines)</Text>
      )}
    </Box>
  );
}
```

## Integration Points

### Terminal Interface Changes

1. **Remove UIMessage conversion**: Skip the current event→UIMessage flattening
2. **Direct event rendering**: Pass ThreadEvent array directly to ConversationDisplay
3. **Event listener updates**: Modify event handlers to preserve structured data
4. **Streaming support**: Ensure streaming cursors work with new component structure

### Thread Manager Extensions

1. **Conversation tree building**: Add utility to construct hierarchical event trees
2. **Agent context tracking**: Store agent hierarchy in events
3. **Subagent event handling**: Support delegation events and subthread linking

## Implementation Considerations

### Ink-Specific Adaptations

- Use Ink's `Box` and `Text` components instead of HTML/CSS
- Leverage `useInput` hook for interactive collapsible sections  
- Consider terminal width constraints for layout
- Use Ink's color system for syntax highlighting

### Performance Optimizations

- Lazy rendering for collapsed sections
- Virtual scrolling for very long conversations
- Efficient re-rendering on event updates
- Memory management for large conversation trees

### Backward Compatibility

- Maintain existing message display as fallback
- Gradual migration path for existing conversations
- Feature flag for new vs old display modes

## Testing Strategy

### Component Testing
- Unit tests for each specialized event component
- Visual regression tests using Ink's test utilities
- Interaction testing for collapsible elements

### Integration Testing  
- End-to-end tests with real conversation flows
- Subagent delegation scenarios
- Tool call/result pairing validation

### Edge Cases
- Very deep subagent nesting
- Large tool outputs and inputs
- Malformed event data handling
- Terminal width constraints

## Migration Timeline

1. **Week 1**: Implement core EventDisplay infrastructure and basic components
2. **Week 2**: Add specialized ToolCall/ToolResult components with collapsible content
3. **Week 3**: Implement hierarchical conversation display for subagents
4. **Week 4**: Integration, testing, and refinement
5. **Week 5**: Migration from old system and cleanup

This architecture provides a solid foundation for rich terminal-based conversation display while supporting the advanced features like subagent delegation that distinguish Lace from simpler AI assistants.