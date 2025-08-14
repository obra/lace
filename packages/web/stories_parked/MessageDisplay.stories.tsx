/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for MessageDisplay.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import MessageDisplay from './MessageDisplay';

const meta: Meta<typeof MessageDisplay> = {
  title: 'Molecules/MessageDisplay',
  component: MessageDisplay,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## MessageDisplay

**Atomic Classification**: Message Molecule  
**Composed of**: Avatar, MessageHeader, MessageText, and TimestampDisplay atoms  
**Business Logic**: Message type discrimination, content rendering, and metadata display

### Purpose
A flexible molecule that renders different types of messages (human, AI, admin, tool) with appropriate styling and layout. Provides the core structure for conversation interfaces with consistent visual hierarchy.

### When to Use
- Primary message rendering in conversations
- Timeline message displays
- Chat interface components
- Multi-agent conversation systems
- Tool execution result displays

### Atomic Composition
- **Avatar** atom for sender identification
- **MessageHeader** atom for metadata display
- **MessageText** atom for content rendering
- **TimestampDisplay** atom for time formatting
- **AgentBadge** atom for AI agent identification
- **Container** molecules for layout structure

### Message Types
- **Human**: User messages with teal avatar and right-aligned layout
- **AI**: Assistant responses with agent-specific colors and badges
- **Admin**: System messages with centered layout and neutral styling
- **Tool**: Command execution with collapsible input/output display

### Design Tokens Used
- **Colors**: Type-specific color schemes (teal for human, agent colors for AI)
- **Spacing**: Consistent gap-3 between avatar and content
- **Typography**: Hierarchical text sizing and weight
- **Layout**: Flexbox composition with responsive behavior
- **Borders**: Subtle borders for content separation

### Agent Support
- **Claude**: Orange theme with robot icon
- **GPT-4**: Blue theme with OpenAI branding
- **Gemini**: Purple theme with Google styling
- **Custom Agents**: Default styling with fallback colors

### State Management
- **Type**: Determines layout and styling approach
- **Content**: Main message text with markdown support
- **Timestamp**: Display time with relative formatting
- **Agent**: AI agent name for identification
- **Tool**: Tool execution context and results

### Accessibility
- Semantic HTML structure for screen readers
- Proper ARIA labels for dynamic content
- Keyboard navigation support
- High contrast mode compatibility
- Focus management for interactive elements

### Molecule Guidelines
✓ **Do**: Use for consistent message rendering  
✓ **Do**: Maintain type-specific styling  
✓ **Do**: Provide proper metadata display  
✓ **Do**: Support all agent types  
✗ **Don't**: Mix message types inappropriately  
✗ **Don't**: Override atomic component styles  
✗ **Don't**: Create inconsistent layouts
        `,
      },
    },
  },
  argTypes: {
    type: {
      control: { type: 'select' },
      options: ['human', 'ai', 'admin', 'tool'],
      description: 'The type of message determines the layout and styling',
    },
    content: {
      control: { type: 'text' },
      description: 'The message content',
    },
    timestamp: {
      control: { type: 'date' },
      description: 'The timestamp of the message',
    },
    agent: {
      control: { type: 'text' },
      description: 'The agent name (for AI messages)',
    },
    name: {
      control: { type: 'text' },
      description: 'The sender name',
    },
    role: {
      control: { type: 'select' },
      options: ['user', 'assistant'],
      description: 'The role for avatar display',
    },
    tool: {
      control: { type: 'text' },
      description: 'The tool name (for tool messages)',
    },
    result: {
      control: { type: 'text' },
      description: 'The tool result (for tool messages)',
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const HumanMessage: Story = {
  args: {
    type: 'human',
    content: 'Hello! I need help with implementing a new feature in my React application.',
    timestamp: new Date(),
    name: 'John Doe',
  },
};

export const AIMessage: Story = {
  args: {
    type: 'ai',
    content:
      "I'd be happy to help you with your React application! Can you provide more details about the specific feature you want to implement?",
    timestamp: new Date(),
    agent: 'Claude',
  },
};

export const AdminMessage: Story = {
  args: {
    type: 'admin',
    content: 'Conversation started',
    timestamp: new Date(),
  },
};

export const ToolMessage: Story = {
  args: {
    type: 'tool',
    content: 'npm install react-router-dom',
    timestamp: new Date(),
    tool: 'bash',
    result:
      'added 15 packages, and audited 1527 packages in 2s\n\n237 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities',
  },
};

export const AIMessageWithGPT4: Story = {
  args: {
    type: 'ai',
    content:
      "Here's a comprehensive solution using TypeScript and modern React patterns. This approach ensures type safety and maintainability.",
    timestamp: new Date(),
    agent: 'GPT-4',
  },
};

export const AIMessageWithGemini: Story = {
  args: {
    type: 'ai',
    content:
      'I can help you optimize this code for better performance and readability. Let me break down the improvements we can make.',
    timestamp: new Date(),
    agent: 'Gemini',
  },
};

export const ToolMessageWithError: Story = {
  args: {
    type: 'tool',
    content: 'git push origin main',
    timestamp: new Date(),
    tool: 'bash',
    result:
      "error: failed to push some refs to 'origin'\nhint: Updates were rejected because the remote contains work that you do\nhint: not have locally. This is usually caused by another repository pushing\nhint: to the same ref. You may want to first integrate the remote changes\nhint: (e.g., 'git pull ...') before pushing again.",
  },
};

export const LongAIMessage: Story = {
  args: {
    type: 'ai',
    content:
      "Here's a comprehensive explanation of React hooks and their usage patterns:\n\n1. **useState**: Manages local component state\n2. **useEffect**: Handles side effects and lifecycle events\n3. **useContext**: Consumes context values\n4. **useReducer**: Manages complex state logic\n5. **useMemo**: Optimizes expensive calculations\n6. **useCallback**: Memoizes function references\n\nEach hook serves a specific purpose and can be combined to create powerful, reusable components. The key is understanding when and how to use each one effectively.",
    timestamp: new Date(),
    agent: 'Claude',
  },
};

export const ConversationFlow: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      <MessageDisplay
        type="admin"
        content="New conversation started"
        timestamp={new Date(Date.now() - 10 * 60 * 1000)}
      />

      <MessageDisplay
        type="human"
        content="Can you help me understand React hooks?"
        timestamp={new Date(Date.now() - 8 * 60 * 1000)}
        name="Developer"
      />

      <MessageDisplay
        type="ai"
        content="Absolutely! React hooks are functions that let you use state and other React features in functional components. Let me show you some examples."
        timestamp={new Date(Date.now() - 7 * 60 * 1000)}
        agent="Claude"
      />

      <MessageDisplay
        type="tool"
        content="npx create-react-app hooks-demo"
        timestamp={new Date(Date.now() - 5 * 60 * 1000)}
        tool="bash"
        result="Creating a new React app in /Users/dev/hooks-demo.\n\nInstalling packages. This might take a couple of minutes.\nInstalling react, react-dom, and react-scripts with corepack..."
      />

      <MessageDisplay
        type="ai"
        content="Perfect! Now let's create a simple component using useState. This is the most common hook you'll use."
        timestamp={new Date(Date.now() - 3 * 60 * 1000)}
        agent="Claude"
      />

      <MessageDisplay
        type="human"
        content="That's really helpful! Can you show me useEffect next?"
        timestamp={new Date(Date.now() - 1 * 60 * 1000)}
        name="Developer"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'A complete conversation flow showing different message types in sequence.',
      },
    },
  },
};

export const AllMessageTypes: Story = {
  render: () => (
    <div className="flex flex-col gap-6 w-full max-w-2xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">All Message Types</h3>
        <p className="text-sm text-gray-600">Different message types with their unique styling</p>
      </div>

      <div className="space-y-4">
        <MessageDisplay
          type="human"
          content="This is a human message with standard user styling"
          timestamp={new Date()}
          name="John Doe"
        />

        <MessageDisplay
          type="ai"
          content="This is an AI message with assistant styling and agent badge"
          timestamp={new Date()}
          agent="Claude"
        />

        <MessageDisplay
          type="admin"
          content="This is an admin message displayed in the center"
          timestamp={new Date()}
        />

        <MessageDisplay
          type="tool"
          content="ls -la"
          timestamp={new Date()}
          tool="bash"
          result="total 24\ndrwxr-xr-x   4 user  staff  128 Jan 15 10:30 .\ndrwxr-xr-x  20 user  staff  640 Jan 15 10:29 ..\n-rw-r--r--   1 user  staff  1234 Jan 15 10:30 package.json\n-rw-r--r--   1 user  staff  567 Jan 15 10:30 README.md"
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available message types displayed together for comparison.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Message Display Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the messages below!
        </p>
      </div>

      <div className="space-y-4">
        <div className="cursor-pointer transition-transform hover:scale-[1.01]">
          <MessageDisplay
            type="human"
            content="I'm working on a new project and need some guidance. Can you help me choose the right technology stack?"
            timestamp={new Date(Date.now() - 5 * 60 * 1000)}
            name="Product Manager"
          />
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.01]">
          <MessageDisplay
            type="ai"
            content="I'd be happy to help you choose the right technology stack! 🚀 The best choice depends on your project requirements, team expertise, and scalability needs. Can you tell me more about your project?"
            timestamp={new Date(Date.now() - 4 * 60 * 1000)}
            agent="Claude"
          />
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.01]">
          <MessageDisplay
            type="admin"
            content="Context saved - conversation can be resumed later"
            timestamp={new Date(Date.now() - 3 * 60 * 1000)}
          />
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.01]">
          <MessageDisplay
            type="tool"
            content="npx create-next-app@latest my-project --typescript --tailwind"
            timestamp={new Date(Date.now() - 2 * 60 * 1000)}
            tool="bash"
            result="Creating a new Next.js app in /Users/dev/my-project.\n\nUsing npm.\n\nInstalling dependencies:\n- react\n- react-dom\n- next\n- typescript\n- tailwindcss\n\n✅ Success! Created my-project at /Users/dev/my-project"
          />
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.01]">
          <MessageDisplay
            type="ai"
            content="Perfect! I've set up a Next.js project with TypeScript and Tailwind CSS. This is an excellent foundation for modern web applications with great developer experience and performance."
            timestamp={new Date(Date.now() - 1 * 60 * 1000)}
            agent="Claude"
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing message displays with tennis commentary. Enable commentary in the toolbar and interact with the messages!',
      },
    },
  },
};
