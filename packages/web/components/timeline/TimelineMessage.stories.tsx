import type { Meta, StoryObj } from '@storybook/react';
import { TimelineMessage } from './TimelineMessage';
import { TimelineEntry } from '@/types/web-events';

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
**Business Logic**: Timeline entry rendering, message type switching, integration display

### Purpose
A complex, self-contained component that renders different types of timeline entries in a conversation interface. Handles multiple message types (human, AI, tool, integration, carousel, Google Doc) with appropriate styling and interactions.

### When to Use
- Primary conversation timelines
- Message history displays
- Activity feed interfaces
- Multi-modal conversation logs

### Atomic Composition
- **MessageDisplay** molecule for basic message types (human, AI, tool, admin)
- **IntegrationEntry** molecule for integration messages
- **GoogleDocChatMessage** organism for Google Doc interactions
- **FontAwesome icons** atoms for visual indicators
- **TimestampDisplay** atoms for time formatting
- **AgentBadge** atoms for agent identification

### Design Tokens Used
- **Colors**: Agent-specific colors (orange for Claude, blue for Gemini, etc.)
- **Spacing**: Consistent gap-3 between avatar and content
- **Typography**: Hierarchical sizing for different content types
- **Shadows**: Subtle elevation for cards and containers
- **Layout**: Flexbox composition with responsive behavior

### Message Types Supported
- **Human Messages**: User input with teal avatar
- **AI Messages**: Agent responses with agent-specific colors
- **Tool Messages**: Tool execution results with context
- **Integration Messages**: External service interactions
- **Carousel Messages**: Multi-item display grids
- **Google Doc Messages**: Document collaboration interface
- **Admin Messages**: System notifications and status

### Accessibility
- Semantic HTML structure for screen readers
- Proper ARIA labels for dynamic content
- Keyboard navigation support
- High contrast mode compatibility
- Icon accessibility with text alternatives

### State Management
- **entry**: TimelineEntry object with type discrimination
- **Conditional rendering**: Based on entry.type property
- **Dynamic styling**: Agent-specific colors and badges
- **Content adaptation**: Different layouts for different types

### Business Logic
- Type discrimination for rendering logic
- Agent color mapping and badge generation
- Time formatting and display
- External link handling for integrations
- File type detection and icons
- Responsive grid layouts for carousels

### Organism Guidelines
✓ **Do**: Self-contained with clear message type boundaries  
✓ **Do**: Handle own rendering logic for all supported types  
✓ **Do**: Maintain consistent spacing and typography  
✓ **Do**: Provide proper accessibility for all message types  
✗ **Don't**: Mix unrelated message type functionality  
✗ **Don't**: Create tight coupling to specific conversation contexts  
✗ **Don't**: Override individual molecule/atom styles
        `,
      },
    },
  },
  argTypes: {
    entry: {
      control: { type: 'object' },
      description: 'The timeline entry data to display',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Mock timeline entries for stories
const mockHumanEntry: TimelineEntry = {
  id: 1,
  type: 'human',
  content: 'Hey there! Can you help me with this code?',
  timestamp: new Date('2024-01-15T10:30:00Z'),
  agent: undefined,
  tool: undefined,
  result: undefined,
  link: undefined,
  title: undefined,
  description: undefined,
  action: undefined,
  items: undefined,
  document: undefined,
};

const mockAIEntry: TimelineEntry = {
  id: 2,
  type: 'ai',
  content: 'Of course! I\'d be happy to help you with your code. What specific issue are you facing?',
  timestamp: new Date('2024-01-15T10:31:00Z'),
  agent: 'Claude',
  tool: undefined,
  result: undefined,
  link: undefined,
  title: undefined,
  description: undefined,
  action: undefined,
  items: undefined,
  document: undefined,
};

const mockToolEntry: TimelineEntry = {
  id: 3,
  type: 'tool',
  content: 'Searching for Python files in the current directory...',
  timestamp: new Date('2024-01-15T10:32:00Z'),
  agent: 'Claude',
  tool: 'file-search',
  result: {
    content: [{ type: 'text', text: 'Found 5 Python files:\n- main.py\n- utils.py\n- models.py\n- tests.py\n- config.py' }],
    status: 'completed' as const,
  },
  link: undefined,
  title: undefined,
  description: undefined,
  action: undefined,
  items: undefined,
  document: undefined,
};

const mockIntegrationEntry: TimelineEntry = {
  id: 4,
  type: 'integration',
  content: undefined,
  timestamp: new Date('2024-01-15T10:33:00Z'),
  agent: undefined,
  tool: 'Google Drive',
  result: undefined,
  link: 'https://docs.google.com/document/d/abc123',
  title: 'Project Documentation',
  description: 'Created comprehensive project documentation with code examples',
  action: 'created',
  items: undefined,
  document: undefined,
};

const mockCarouselEntry: TimelineEntry = {
  id: 5,
  type: 'carousel',
  content: undefined,
  timestamp: new Date('2024-01-15T10:34:00Z'),
  agent: undefined,
  tool: undefined,
  result: undefined,
  link: undefined,
  title: 'Recent Code Changes',
  description: undefined,
  action: undefined,
  items: [
    {
      title: 'Add user authentication',
      description: 'Implemented JWT-based authentication system with login/logout functionality',
      type: 'feature',
      impact: 'high',
      commit: 'a1b2c3d',
      files: ['auth.py', 'middleware.py', 'routes.py'],
    },
    {
      title: 'Fix database connection leak',
      description: 'Resolved memory leak in database connection pool',
      type: 'bugfix',
      impact: 'medium',
      commit: 'e4f5g6h',
      files: ['db.py', 'config.py'],
    },
    {
      title: 'Refactor API endpoints',
      description: 'Consolidated duplicate code in API route handlers',
      type: 'refactor',
      impact: 'low',
      commit: 'i7j8k9l',
      files: ['api/users.py', 'api/posts.py', 'api/comments.py', 'api/common.py'],
    },
  ],
  document: undefined,
};

const mockGoogleDocEntry: TimelineEntry = {
  id: 6,
  type: 'google-doc',
  content: 'Here\'s the updated project specification with all the requirements we discussed.',
  timestamp: new Date('2024-01-15T10:35:00Z'),
  agent: 'Claude',
  tool: undefined,
  result: undefined,
  link: undefined,
  title: undefined,
  description: undefined,
  action: undefined,
  items: undefined,
  document: {
    id: 'doc123',
    title: 'Project Specification',
    url: 'https://docs.google.com/document/d/doc123',
    lastModified: new Date('2024-01-15T10:35:00Z'),
    owner: 'John Doe',
    permissions: 'edit',
  },
};

export const HumanMessage: Story = {
  args: {
    entry: mockHumanEntry,
  },
};

export const AIMessage: Story = {
  args: {
    entry: mockAIEntry,
  },
};

export const ToolMessage: Story = {
  args: {
    entry: mockToolEntry,
  },
};

export const IntegrationMessage: Story = {
  args: {
    entry: mockIntegrationEntry,
  },
};

export const SlackIntegration: Story = {
  args: {
    entry: {
      ...mockIntegrationEntry,
      tool: 'Slack',
      title: 'Message sent to #development',
      description: 'Deployment completed successfully! 🚀',
      action: 'shared',
    },
  },
};

export const GitHubIntegration: Story = {
  args: {
    entry: {
      ...mockIntegrationEntry,
      tool: 'GitHub',
      title: 'Pull Request #123',
      description: 'Add new feature for user dashboard',
      action: 'created',
    },
  },
};

export const CarouselMessage: Story = {
  args: {
    entry: mockCarouselEntry,
  },
};

export const GoogleDocMessage: Story = {
  args: {
    entry: mockGoogleDocEntry,
  },
};

export const AdminMessage: Story = {
  args: {
    entry: {
      ...mockHumanEntry,
      type: 'admin',
      content: 'System initialized successfully. Ready for user interactions.',
      agent: 'System',
    },
  },
};

export const AllMessageTypes: Story = {
  render: () => (
    <div className="flex flex-col gap-6 w-full max-w-4xl">
      <div>
        <h3 className="text-lg font-semibold mb-3">Human Message</h3>
        <TimelineMessage entry={mockHumanEntry} />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-3">AI Message</h3>
        <TimelineMessage entry={mockAIEntry} />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-3">Tool Message</h3>
        <TimelineMessage entry={mockToolEntry} />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-3">Integration Message</h3>
        <TimelineMessage entry={mockIntegrationEntry} />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-3">Carousel Message</h3>
        <TimelineMessage entry={mockCarouselEntry} />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-3">Google Doc Message</h3>
        <TimelineMessage entry={mockGoogleDocEntry} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available message types displayed together.',
      },
    },
  },
};

export const ConversationFlow: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-full max-w-4xl">
      <TimelineMessage entry={mockHumanEntry} />
      <TimelineMessage entry={mockAIEntry} />
      <TimelineMessage entry={mockToolEntry} />
      <TimelineMessage entry={mockIntegrationEntry} />
      <TimelineMessage entry={mockCarouselEntry} />
      <TimelineMessage entry={mockGoogleDocEntry} />
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

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Timeline Message Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the timeline messages below!
        </p>
      </div>
      
      <div className="space-y-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Human Message</h4>
          <TimelineMessage entry={mockHumanEntry} />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">AI Response</h4>
          <TimelineMessage entry={mockAIEntry} />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Tool Execution</h4>
          <TimelineMessage entry={mockToolEntry} />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Integration</h4>
          <TimelineMessage entry={mockIntegrationEntry} />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Code Changes Carousel</h4>
          <TimelineMessage entry={mockCarouselEntry} />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Google Doc Message</h4>
          <TimelineMessage entry={mockGoogleDocEntry} />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing different timeline message types with tennis commentary. Enable commentary in the toolbar and interact with the messages!',
      },
    },
  },
};
