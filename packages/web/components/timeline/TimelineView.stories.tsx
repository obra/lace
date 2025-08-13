// ABOUTME: Storybook story for TimelineView.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { TimelineView } from './TimelineView';
import type { LaceEvent, AgentInfo } from '~/types/core';
import { asThreadId } from '~/types/core';

const meta: Meta<typeof TimelineView> = {
  title: 'Organisms/TimelineView',
  component: TimelineView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
## TimelineView

**Atomic Classification**: Conversation Display Organism  
**Composed of**: TimelineMessage + TypingIndicator molecules  
**Single Responsibility**: Display scrollable conversation timeline with real-time streaming support

### Purpose
The main conversation display component that shows all thread events (messages, tool calls, system events) in a scrollable container with automatic scroll-to-bottom behavior and real-time streaming content display.

### When to Use
- Main chat interface conversation display
- Message history viewing
- Real-time streaming AI responses
- Tool execution timeline tracking
- System event display

### Organism Composition
- **TimelineMessage**: Individual event display with type-specific rendering
- **TypingIndicator**: Shows agent thinking state during AI processing
- **Streaming Content**: Real-time display of AI response tokens
- **Auto-scroll**: Automatic scrolling to newest messages

### Features
- **Multi-type Events**: Supports user, agent, tool, system, and task events
- **Real-time Streaming**: Live display of AI response tokens as they arrive
- **Auto-scroll**: Automatically scrolls to bottom when new messages arrive
- **Typing Indicators**: Shows agent thinking state during processing
- **Responsive Layout**: Adapts to different screen sizes and orientations
- **Overscroll Handling**: Prevents bounce scrolling on mobile devices

### State Management
- **Event List**: Array of thread events with timestamps and metadata
- **Streaming State**: Current streaming content from AI responses
- **Typing State**: Boolean indicating if agent is thinking/processing
- **Scroll Position**: Automatic scroll management for new content

### Integration Points
- **TimelineMessage**: Renders individual events with type-specific styling
- **useProcessedEvents**: Hook for filtering and aggregating events
- **Agent Selection**: Filters events by selected agent thread

### Performance Considerations
- **Event Processing**: Uses memoized hook for efficient event filtering
- **Scroll Performance**: RAF-based smooth scrolling
- **Virtualization Ready**: Structure supports future virtual scrolling

### Design System Integration
- **Spacing**: Uses consistent padding and gap utilities
- **Colors**: Semantic color tokens for different event types
- **Typography**: Consistent text sizing and font weights
- **Layout**: Flexbox-based responsive design

### Best Practices
✅ **Do**: Use proper LaceEvent types for all events
✅ **Do**: Include agent info for multi-agent conversations  
✅ **Do**: Handle empty states gracefully
✗ **Don't**: Mutate event data directly
✗ **Don't**: Override scroll behavior externally
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ height: '600px', width: '100%', border: '1px solid #e5e7eb' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Mock agent info
const mockAgents: AgentInfo[] = [
  {
    threadId: asThreadId('lace_20240115_abc123.1'),
    name: 'Claude',
    modelId: 'claude-3-opus',
    providerInstanceId: 'anthropic',
    status: 'idle',
  },
  {
    threadId: asThreadId('lace_20240115_abc123.2'), 
    name: 'Research Assistant',
    modelId: 'gpt-4',
    providerInstanceId: 'openai',
    status: 'thinking',
  },
];

// Sample thread events for stories
const sampleEvents: LaceEvent[] = [
  {
    id: 'evt-1',
    type: 'USER_MESSAGE',
    threadId: asThreadId('lace_20240115_abc123'),
    timestamp: new Date('2024-01-15T10:30:00Z'),
    data: 'Can you help me understand React hooks?',
  },
  {
    id: 'evt-2',
    type: 'AGENT_MESSAGE',
    threadId: asThreadId('lace_20240115_abc123.1'),
    timestamp: new Date('2024-01-15T10:30:15Z'),
    data: {
      content: "I'd be happy to explain React hooks! React hooks are functions that let you use state and other React features in functional components.\n\nThe most common hooks are:\n\n1. **useState** - Manages local component state\n2. **useEffect** - Handles side effects\n3. **useContext** - Accesses context values\n4. **useMemo** - Memoizes expensive computations\n5. **useCallback** - Memoizes callback functions",
      tokenUsage: {
        message: {
          promptTokens: 15,
          completionTokens: 89,
          totalTokens: 104,
        },
        thread: {
          totalPromptTokens: 15,
          totalCompletionTokens: 89,
          totalTokens: 104,
          contextLimit: 200000,
          percentUsed: 0.05,
          nearLimit: false,
        },
      },
    },
  },
  {
    id: 'evt-3',
    type: 'USER_MESSAGE',
    threadId: asThreadId('lace_20240115_abc123'),
    timestamp: new Date('2024-01-15T10:31:00Z'),
    data: 'Can you show me an example of useState?',
  },
  {
    id: 'evt-4',
    type: 'TOOL_CALL',
    threadId: asThreadId('lace_20240115_abc123.1'),
    timestamp: new Date('2024-01-15T10:31:10Z'),
    data: {
      id: 'call-456',
      name: 'file_write',
      arguments: {
        path: '/tmp/useState-example.tsx',
        content: 'import { useState } from "react";\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  \n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(count + 1)}>Increment</button>\n    </div>\n  );\n}',
      },
    },
  },
  {
    id: 'evt-5',
    type: 'TOOL_RESULT',
    threadId: asThreadId('lace_20240115_abc123.1'),
    timestamp: new Date('2024-01-15T10:31:12Z'),
    data: {
      id: 'call-456',
      content: [
        {
          type: 'text',
          text: 'File written successfully to /tmp/useState-example.tsx',
        },
      ],
      status: 'completed',
    },
  },
  {
    id: 'evt-6',
    type: 'AGENT_MESSAGE',
    threadId: asThreadId('lace_20240115_abc123.1'),
    timestamp: new Date('2024-01-15T10:31:15Z'),
    data: {
      content: "I've created a simple example of `useState` in a file. This Counter component demonstrates:\n\n- Declaring state with `useState(0)` - initial value is 0\n- Reading the current state value (`count`)\n- Updating state with `setCount`\n\nWhen you click the button, it increments the counter by calling `setCount(count + 1)`, which triggers a re-render with the new value.",
      tokenUsage: {
        message: {
          promptTokens: 120,
          completionTokens: 78,
          totalTokens: 198,
        },
        thread: {
          totalPromptTokens: 135,
          totalCompletionTokens: 167,
          totalTokens: 302,
          contextLimit: 200000,
          percentUsed: 0.15,
          nearLimit: false,
        },
      },
    },
  },
  {
    id: 'evt-7',
    type: 'LOCAL_SYSTEM_MESSAGE',
    threadId: asThreadId('lace_20240115_abc123'),
    timestamp: new Date('2024-01-15T10:32:00Z'),
    data: 'Auto-save enabled for this conversation',
  },
];

// Empty state
const emptyEvents: LaceEvent[] = [];

// Streaming state events
const streamingEvents: LaceEvent[] = [
  ...sampleEvents.slice(0, 3),
  {
    id: 'evt-streaming',
    type: 'AGENT_STREAMING',
    threadId: asThreadId('lace_20240115_abc123.1'),
    timestamp: new Date(),
    data: {
      content: 'Let me create a more advanced example that shows...',
    },
    transient: true,
  },
];

// Default story with sample conversation
export const Default: Story = {
  args: {
    events: sampleEvents,
    agents: mockAgents,
    isTyping: false,
    currentAgent: asThreadId('lace_20240115_abc123.1'),
    selectedAgent: asThreadId('lace_20240115_abc123.1'),
  },
};

// Empty conversation
export const EmptyState: Story = {
  args: {
    events: emptyEvents,
    agents: mockAgents,
    isTyping: false,
    currentAgent: asThreadId('lace_20240115_abc123.1'),
    selectedAgent: asThreadId('lace_20240115_abc123.1'),
  },
};

// Agent is typing
export const AgentTyping: Story = {
  args: {
    events: sampleEvents,
    agents: mockAgents,
    isTyping: true,
    currentAgent: asThreadId('lace_20240115_abc123.1'),
    selectedAgent: asThreadId('lace_20240115_abc123.1'),
  },
};

// Streaming response
export const StreamingResponse: Story = {
  args: {
    events: sampleEvents,
    agents: mockAgents,
    isTyping: false,
    currentAgent: asThreadId('lace_20240115_abc123.1'),
    selectedAgent: asThreadId('lace_20240115_abc123.1'),
    streamingContent: 'Let me create a more advanced example that shows how to use multiple hooks together...',
  },
};

// Multi-agent conversation
export const MultiAgent: Story = {
  args: {
    events: [
      ...sampleEvents,
      {
        id: 'evt-8',
        type: 'AGENT_SPAWNED',
        threadId: asThreadId('lace_20240115_abc123'),
        timestamp: new Date('2024-01-15T10:33:00Z'),
        data: {
          type: 'agent:spawned',
          agentThreadId: asThreadId('lace_20240115_abc123.2'),
          provider: 'openai',
          model: 'gpt-4',
          taskId: 'task-789',
          context: {
            actor: 'Claude',
            isHuman: false,
          },
          timestamp: new Date('2024-01-15T10:33:00Z'),
        },
      },
      {
        id: 'evt-9',
        type: 'AGENT_MESSAGE',
        threadId: asThreadId('lace_20240115_abc123.2'),
        timestamp: new Date('2024-01-15T10:33:30Z'),
        data: {
          content: 'I found some best practices for React hooks:\n\n1. Only call hooks at the top level\n2. Only call hooks from React functions\n3. Use the ESLint plugin for hooks\n4. Keep effects focused and small',
          tokenUsage: {
            message: {
              promptTokens: 45,
              completionTokens: 52,
              totalTokens: 97,
            },
            thread: {
              totalPromptTokens: 45,
              totalCompletionTokens: 52,
              totalTokens: 97,
              contextLimit: 200000,
              percentUsed: 0.05,
              nearLimit: false,
            },
          },
        },
      },
    ],
    agents: mockAgents,
    isTyping: false,
    currentAgent: asThreadId('lace_20240115_abc123.2'),
    selectedAgent: asThreadId('lace_20240115_abc123.2'),
  },
};

// Long conversation with scrolling
export const LongConversation: Story = {
  args: {
    events: [
      ...sampleEvents,
      ...sampleEvents.map((e, i) => ({
        ...e,
        id: `${e.id}-duplicate-${i}`,
        timestamp: new Date(new Date(e.timestamp || new Date()).getTime() + 60000 * (i + 1)),
      })),
      ...sampleEvents.map((e, i) => ({
        ...e,
        id: `${e.id}-duplicate-2-${i}`,
        timestamp: new Date(new Date(e.timestamp || new Date()).getTime() + 120000 * (i + 1)),
      })),
    ],
    agents: mockAgents,
    isTyping: false,
    currentAgent: asThreadId('lace_20240115_abc123.1'),
    selectedAgent: asThreadId('lace_20240115_abc123.1'),
  },
};

// With task events
export const WithTaskEvents: Story = {
  args: {
    events: [
      ...sampleEvents.slice(0, 3),
      {
        id: 'evt-task-1',
        type: 'TASK_CREATED',
        threadId: asThreadId('lace_20240115_abc123'),
        timestamp: new Date('2024-01-15T10:31:05Z'),
        data: {
          taskId: 'task-789',
          task: {
            id: 'task-789',
            title: 'Create React hooks tutorial',
            description: 'Comprehensive tutorial on React hooks',
            prompt: 'Create a detailed tutorial covering all React hooks',
            status: 'pending',
            priority: 'high',
            createdBy: 'human',
            threadId: asThreadId('lace_20240115_abc123'),
            createdAt: new Date('2024-01-15T10:31:05Z'),
            updatedAt: new Date('2024-01-15T10:31:05Z'),
            notes: [],
          },
          context: {
            actor: 'human',
            isHuman: true,
          },
          timestamp: new Date('2024-01-15T10:31:05Z'),
          type: 'task:created',
        },
      },
      {
        id: 'evt-task-2',
        type: 'TASK_UPDATED',
        threadId: asThreadId('lace_20240115_abc123'),
        timestamp: new Date('2024-01-15T10:31:20Z'),
        data: {
          taskId: 'task-789',
          task: {
            id: 'task-789',
            title: 'Create React hooks tutorial',
            description: 'Comprehensive tutorial on React hooks',
            prompt: 'Create a detailed tutorial covering all React hooks',
            status: 'in_progress',
            priority: 'high',
            createdBy: 'human',
            threadId: asThreadId('lace_20240115_abc123'),
            createdAt: new Date('2024-01-15T10:31:05Z'),
            updatedAt: new Date('2024-01-15T10:31:20Z'),
            notes: [],
          },
          context: {
            actor: 'human',
            isHuman: true,
          },
          timestamp: new Date('2024-01-15T10:31:20Z'),
          type: 'task:updated',
        },
      },
      ...sampleEvents.slice(3),
    ],
    agents: mockAgents,
    isTyping: false,
    currentAgent: asThreadId('lace_20240115_abc123.1'),
    selectedAgent: asThreadId('lace_20240115_abc123.1'),
  },
};