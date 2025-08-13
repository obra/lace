// ABOUTME: Storybook story for TimelineMessage.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { TimelineMessage } from './TimelineMessage';
import type { LaceEvent, AgentInfo } from '~/types/core';
import { asThreadId } from '~/types/core';

const meta: Meta<typeof TimelineMessage> = {
  title: 'Organisms/TimelineMessage',
  component: TimelineMessage,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## TimelineMessage

**Atomic Classification**: Message Organism  
**Composed of**: Multiple molecules and atoms for different message types  
**Business Logic**: Thread event rendering, message type switching, integration display

### Purpose
A complex, self-contained component that renders different types of thread events in a conversation interface. Handles multiple message types (user, agent, tool, system) with appropriate styling and interactions.

### When to Use
- Primary conversation timelines
- Message history displays
- Activity feed interfaces
- Multi-modal conversation logs

### Atomic Composition
- **MessageDisplay** for basic message types (user, agent, tool, system)
- **ToolCallDisplay** for tool interactions
- **SystemNotificationDisplay** for system messages

### Component Contract
- **Props**: LaceEvent object containing type, data, timestamp, and metadata
- **State**: Internally manages display variations based on event type
- **Events**: None (display-only component)

### Design Tokens Usage
Uses semantic tokens for different message types:
- User messages: primary colors
- Agent messages: default text colors
- Tool calls: info/warning/error based on risk level
- System messages: muted colors

### Best Practices
✅ **Do**: Pass complete LaceEvent objects
✅ **Do**: Include agent info for proper attribution
✅ **Do**: Use semantic colors for message types
✗ **Don't**: Modify event data before passing
✗ **Don't**: Override individual molecule/atom styles
        `,
      },
    },
  },
  argTypes: {
    event: {
      control: { type: 'object' },
      description: 'The thread event to display',
    },
    agents: {
      control: { type: 'object' },
      description: 'Optional agent information for display',
    },
  },
  tags: ['autodocs'],
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

// User message event
const userMessageEvent: LaceEvent = {
  id: 'evt-1',
  type: 'USER_MESSAGE',
  threadId: asThreadId('lace_20240115_abc123'),
  timestamp: new Date('2024-01-15T10:30:00Z'),
  data: 'Hey there! Can you help me write a React component?',
};

// Agent message event
const agentMessageEvent: LaceEvent = {
  id: 'evt-2',
  type: 'AGENT_MESSAGE',
  threadId: asThreadId('lace_20240115_abc123.1'),
  timestamp: new Date('2024-01-15T10:30:30Z'),
  data: {
    content: "I'd be happy to help you write a React component! What kind of component would you like to create? Please provide some details about:\n\n- What the component should do\n- Any specific features or functionality\n- Whether you need TypeScript or JavaScript\n- Any styling preferences (CSS, Tailwind, etc.)",
    tokenUsage: {
      message: {
        promptTokens: 25,
        completionTokens: 67,
        totalTokens: 92,
      },
      thread: {
        totalPromptTokens: 25,
        totalCompletionTokens: 67,
        totalTokens: 92,
        contextLimit: 200000,
        percentUsed: 0.05,
        nearLimit: false,
      },
    },
  },
};

// Tool call event
const toolCallEvent: LaceEvent = {
  id: 'evt-3',
  type: 'TOOL_CALL',
  threadId: asThreadId('lace_20240115_abc123.1'),
  timestamp: new Date('2024-01-15T10:31:00Z'),
  data: {
    id: 'call-123',
    name: 'file_read',
    arguments: {
      path: '/src/components/Button.tsx',
    },
  },
};

// Tool result event
const toolResultEvent: LaceEvent = {
  id: 'evt-4',
  type: 'TOOL_RESULT',
  threadId: asThreadId('lace_20240115_abc123.1'),
  timestamp: new Date('2024-01-15T10:31:05Z'),
  data: {
    id: 'call-123',
    content: [
      {
        type: 'text',
        text: 'File contents:\n```tsx\nexport function Button({ children, onClick }) {\n  return <button onClick={onClick}>{children}</button>;\n}\n```',
      },
    ],
    status: 'completed',
  },
};

// System message event
const systemMessageEvent: LaceEvent = {
  id: 'evt-5',
  type: 'LOCAL_SYSTEM_MESSAGE',
  threadId: asThreadId('lace_20240115_abc123'),
  timestamp: new Date('2024-01-15T10:32:00Z'),
  data: 'Connection restored. Continuing conversation...',
};

// Task created event
const taskCreatedEvent: LaceEvent = {
  id: 'evt-6',
  type: 'TASK_CREATED',
  threadId: asThreadId('lace_20240115_abc123'),
  timestamp: new Date('2024-01-15T10:33:00Z'),
  data: {
    taskId: 'task-456',
    task: {
      id: 'task-456',
      title: 'Implement Button component',
      description: 'Create a reusable button component',
      prompt: 'Implement a button component with proper styling',
      status: 'in_progress',
      priority: 'medium',
      createdBy: 'human',
      threadId: asThreadId('lace_20240115_abc123'),
      createdAt: new Date('2024-01-15T10:33:00Z'),
      updatedAt: new Date('2024-01-15T10:33:00Z'),
      notes: [],
    },
    context: {
      actor: 'human',
      isHuman: true,
    },
    timestamp: new Date('2024-01-15T10:33:00Z'),
    type: 'task:created',
  },
};

// Agent streaming event
const agentStreamingEvent: LaceEvent = {
  id: 'evt-7',
  type: 'AGENT_STREAMING',
  threadId: asThreadId('lace_20240115_abc123.1'),
  timestamp: new Date('2024-01-15T10:33:30Z'),
  data: {
    content: 'Let me help you improve that Button component...',
  },
  transient: true,
};

// Stories
export const UserMessage: Story = {
  args: {
    event: userMessageEvent,
    agents: mockAgents,
  },
};

export const AgentMessage: Story = {
  args: {
    event: agentMessageEvent,
    agents: mockAgents,
  },
};

export const ToolCall: Story = {
  args: {
    event: toolCallEvent,
    agents: mockAgents,
  },
};

export const ToolResult: Story = {
  args: {
    event: toolResultEvent,
    agents: mockAgents,
  },
};

export const SystemMessage: Story = {
  args: {
    event: systemMessageEvent,
    agents: mockAgents,
  },
};

export const TaskCreated: Story = {
  args: {
    event: taskCreatedEvent,
    agents: mockAgents,
  },
};

export const StreamingMessage: Story = {
  args: {
    event: agentStreamingEvent,
    agents: mockAgents,
  },
};

// Combined conversation flow
export const ConversationFlow: Story = {
  render: () => (
    <div className="space-y-4 p-4 max-w-4xl">
      <TimelineMessage event={userMessageEvent} agents={mockAgents} />
      <TimelineMessage event={agentMessageEvent} agents={mockAgents} />
      <TimelineMessage event={toolCallEvent} agents={mockAgents} />
      <TimelineMessage event={toolResultEvent} agents={mockAgents} />
      <TimelineMessage event={systemMessageEvent} agents={mockAgents} />
      <TimelineMessage event={taskCreatedEvent} agents={mockAgents} />
    </div>
  ),
};