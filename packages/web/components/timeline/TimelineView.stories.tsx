import type { Meta, StoryObj } from '@storybook/react';
import { TimelineView } from './TimelineView';
import { TimelineEntry } from '@/types/web-events';

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
The main conversation display component that shows all timeline entries (messages, tool calls, integrations) in a scrollable container with automatic scroll-to-bottom behavior and real-time streaming content display.

### When to Use
- Main chat interface conversation display
- Message history viewing
- Real-time streaming AI responses
- Tool execution timeline tracking
- Integration event display

### Organism Composition
- **TimelineMessage**: Individual message/entry display with type-specific rendering
- **TypingIndicator**: Shows agent thinking state during AI processing
- **Streaming Content**: Real-time display of AI response tokens
- **Auto-scroll**: Automatic scrolling to newest messages

### Features
- **Multi-type Messages**: Supports human, AI, tool, admin, integration, and carousel entries
- **Real-time Streaming**: Live display of AI response tokens as they arrive
- **Auto-scroll**: Automatically scrolls to bottom when new messages arrive
- **Typing Indicators**: Shows agent thinking state during processing
- **Responsive Layout**: Adapts to different screen sizes and orientations
- **Overscroll Handling**: Prevents bounce scrolling on mobile devices

### State Management
- **Entry List**: Array of timeline entries with timestamps and metadata
- **Streaming State**: Current streaming content from AI responses
- **Typing State**: Boolean indicating if agent is thinking/processing
- **Scroll Position**: Automatic scroll management for new content

### Integration Points
- **TimelineMessage**: Renders individual entries with type-specific styling
- **TypingIndicator**: Shows agent activity during processing
- **Conversation Stream**: Real-time streaming content integration
- **Auto-scroll Hook**: Maintains scroll position at bottom for new messages

### Visual Features
- **Scrollable Container**: Smooth scrolling with proper overflow handling
- **Message Spacing**: Consistent spacing between timeline entries
- **Padding Bottom**: Extra space at bottom for input area clearance
- **Responsive Design**: Works on desktop and mobile screen sizes

### Organism Guidelines
✓ **Do**: Display complete conversation history with all entry types  
✓ **Do**: Support real-time streaming for AI responses  
✓ **Do**: Auto-scroll to bottom when new messages arrive  
✓ **Do**: Show typing indicators during agent processing  
✗ **Don't**: Use for single message display (use TimelineMessage)  
✗ **Don't**: Skip auto-scroll behavior for conversation flow  
✗ **Don't**: Modify without testing streaming functionality  
✗ **Don't**: Remove responsive design considerations

### Organism Hierarchy
- **Organism Level**: Complete conversation timeline display
- **Molecule Level**: Individual message and indicator components
- **Atom Level**: Basic UI elements within messages
- **System Level**: Scroll management and streaming integration

### Performance Considerations
- **Virtualization**: Consider for very long conversations
- **Message Caching**: Efficient rendering of large entry lists
- **Streaming Optimization**: Smooth real-time content updates
- **Auto-scroll Efficiency**: Optimized scroll position management
- **Memory Management**: Proper cleanup of refs and effects
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample timeline entries for stories
const sampleEntries: TimelineEntry[] = [
  {
    id: 1,
    type: 'admin',
    content: 'Timeline started',
    timestamp: new Date(Date.now() - 3600000),
  },
  {
    id: 2,
    type: 'human',
    content: 'Can you help me create a React component with TypeScript?',
    timestamp: new Date(Date.now() - 1800000),
  },
  {
    id: 3,
    type: 'ai',
    content: `I'll help you create a React component with TypeScript. Here's a complete example:

\`\`\`typescript
import React, { useState, useEffect } from 'react';

interface ComponentProps {
  title: string;
  content?: string;
  onUpdate?: (value: string) => void;
}

export const MyComponent: React.FC<ComponentProps> = ({
  title,
  content = '',
  onUpdate
}) => {
  const [value, setValue] = useState(content);

  useEffect(() => {
    if (onUpdate) {
      onUpdate(value);
    }
  }, [value, onUpdate]);

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full p-2 border rounded"
        placeholder="Enter your content..."
      />
    </div>
  );
};
\`\`\`

This component demonstrates TypeScript typing, React hooks, and props handling.`,
    agent: 'Claude',
    timestamp: new Date(Date.now() - 1790000),
  },
  {
    id: 4,
    type: 'tool',
    tool: 'file-write',
    content: 'file-write executed',
    result: {
      content: [{ type: 'text', text: 'Successfully created MyComponent.tsx' }],
      isError: false,
    },
    timestamp: new Date(Date.now() - 1700000),
  },
  {
    id: 5,
    type: 'integration',
    tool: 'GitHub',
    action: 'created',
    title: 'Pull Request #123',
    description: 'Added new React component with TypeScript',
    link: 'https://github.com/example/repo/pull/123',
    timestamp: new Date(Date.now() - 1600000),
  },
];

const carouselEntries: TimelineEntry[] = [
  ...sampleEntries,
  {
    id: 6,
    type: 'carousel',
    title: 'Recent Code Changes',
    timestamp: new Date(Date.now() - 1500000),
    items: [
      {
        title: 'Authentication Module',
        description: 'Added OAuth2 integration with Google and GitHub',
        type: 'feature' as const,
        impact: 'high' as const,
        files: ['src/auth/oauth.ts', 'src/auth/providers.ts'],
        commit: 'a1b2c3d',
      },
      {
        title: 'Database Migration',
        description: 'Updated user schema to support OAuth tokens',
        type: 'maintenance' as const,
        impact: 'medium' as const,
        files: ['migrations/001_oauth_tokens.sql', 'src/models/user.ts'],
        commit: 'e4f5g6h',
      },
      {
        title: 'Login Bug Fix',
        description: 'Fixed session timeout issue in production',
        type: 'bugfix' as const,
        impact: 'high' as const,
        files: ['src/auth/session.ts'],
        commit: 'i7j8k9l',
      },
    ],
  },
];

export const Default: Story = {
  args: {
    entries: sampleEntries,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Default timeline view with various message types including human, AI, tool, and integration entries.',
      },
    },
  },
};

export const WithTypingIndicator: Story = {
  args: {
    entries: sampleEntries,
    isTyping: true,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline showing typing indicator when AI agent is processing.',
      },
    },
  },
};

export const WithStreamingContent: Story = {
  args: {
    entries: sampleEntries,
    isTyping: false,
    currentAgent: 'Claude',
    streamingContent: 'This is streaming content being displayed in real-time as the AI generates the response...',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline displaying real-time streaming content from AI responses.',
      },
    },
  },
};

export const WithCarouselEntries: Story = {
  args: {
    entries: carouselEntries,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline with carousel entries showing code changes and complex data structures.',
      },
    },
  },
};

export const EmptyTimeline: Story = {
  args: {
    entries: [],
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty timeline ready for new conversation entries.',
      },
    },
  },
};

export const MobileView: Story = {
  args: {
    entries: sampleEntries,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Timeline optimized for mobile viewing with responsive message layout.',
      },
    },
  },
};

export const LongConversation: Story = {
  args: {
    entries: [
      ...sampleEntries,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: 10 + i,
        type: 'human' as const,
        content: `This is message ${i + 1} in a long conversation to test scrolling behavior.`,
        timestamp: new Date(Date.now() - 1000000 + i * 60000),
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: 20 + i,
        type: 'ai' as const,
        content: `This is AI response ${i + 1} demonstrating how the timeline handles long conversations with automatic scrolling.`,
        agent: 'Claude',
        timestamp: new Date(Date.now() - 950000 + i * 60000),
      })),
    ],
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Long conversation demonstrating scrolling behavior and performance with many timeline entries.',
      },
    },
  },
};

export const MultipleAgents: Story = {
  args: {
    entries: [
      {
        id: 1,
        type: 'admin',
        content: 'Multi-agent collaboration timeline started',
        timestamp: new Date(Date.now() - 3600000),
      },
      {
        id: 2,
        type: 'human',
        content: 'Can you both help me with this complex problem?',
        timestamp: new Date(Date.now() - 1800000),
      },
      {
        id: 3,
        type: 'ai',
        content: 'I can help with the frontend implementation using React and TypeScript.',
        agent: 'Claude',
        timestamp: new Date(Date.now() - 1700000),
      },
      {
        id: 4,
        type: 'ai',
        content: 'I can handle the backend API design and database optimization.',
        agent: 'GPT-4',
        timestamp: new Date(Date.now() - 1600000),
      },
      {
        id: 5,
        type: 'ai',
        content: 'I can provide data analysis and machine learning insights.',
        agent: 'Gemini',
        timestamp: new Date(Date.now() - 1500000),
      },
    ],
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline showing collaboration between multiple AI agents with different specializations.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    entries: sampleEntries,
    isTyping: false,
    currentAgent: 'Claude',
  },
  render: (args) => (
    <div className="flex flex-col gap-6 p-6 h-96 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🗣️ TimelineView Interactive Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Complete conversation timeline with real-time streaming support!
        </p>
      </div>
      
      <div className="h-80 border border-base-300 rounded-lg overflow-hidden">
        <TimelineView {...args} />
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">TimelineView Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Multi-type Messages</strong> - Human, AI, tool, admin, integration entries</li>
          <li>• <strong>Real-time Streaming</strong> - Live AI response token display</li>
          <li>• <strong>Auto-scroll</strong> - Automatic scrolling to newest messages</li>
          <li>• <strong>Typing Indicators</strong> - Shows agent thinking state</li>
          <li>• <strong>Responsive Design</strong> - Works on all screen sizes</li>
          <li>• <strong>Performance Optimized</strong> - Efficient rendering of large conversations</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing the complete TimelineView conversation display organism.',
      },
    },
  },
};