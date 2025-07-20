import type { Meta, StoryObj } from '@storybook/react';
import MessageHeader from './MessageHeader';

const meta: Meta<typeof MessageHeader> = {
  title: 'Molecules/MessageHeader',
  component: MessageHeader,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## MessageHeader

**Atomic Classification**: Message Molecule  
**Composed of**: Avatar + TimestampDisplay + Badge atoms  
**Single Responsibility**: Display message sender information with context and status

### Purpose
A cohesive molecule that combines 2-3 atoms to solve the specific UI pattern of message attribution. Handles user/assistant identification, timing context, and status badges in a single, reusable component.

### When to Use
- Chat message headers
- Comment attribution
- Activity feed entries
- Notification headers
- User-generated content attribution

### Atomic Composition
- **Avatar**: User/assistant profile picture with role-based defaults
- **TimestampDisplay**: Formatted time information (via formatTime utility)
- **Badge**: Optional status/type indicators with semantic colors
- **Typography**: Name display with proper hierarchy

### Design Tokens Used
- **Layout**: Flexbox composition with gap-3 spacing
- **Colors**: Role-based avatar colors, semantic badge variants
- **Typography**: Font-medium for names, smaller timestamps
- **Spacing**: Consistent spacing between composed atoms
- **Badges**: Semantic color variants (primary, success, warning, etc.)

### Badge Variants
- **default**: Neutral badge for general information
- **primary**: Primary brand color for important status
- **secondary**: Secondary color for less important status
- **success**: Green for positive states
- **warning**: Yellow for attention-requiring states
- **error**: Red for error states
- **info**: Blue for informational states
- **claude**: Orange for Claude AI assistant
- **gpt-4**: Green for GPT-4 assistant
- **gemini**: Blue for Gemini assistant

### State Management
- **name**: Display name of the message sender
- **timestamp**: Date object or formatted string
- **role**: User or assistant role for avatar selection
- **badge**: Optional badge configuration with text and variant
- **avatar**: Custom avatar override if needed

### Accessibility
- Maintains semantic structure with proper heading hierarchy
- Screen reader friendly timestamp formatting
- Clear visual hierarchy between name, time, and badges
- Proper contrast ratios for all badge variants

### Composition Guidelines
✓ **Do**: Use in message-related organisms and templates  
✓ **Do**: Combine atoms logically for message attribution  
✓ **Do**: Provide consistent badge semantics  
✓ **Do**: Maintain single responsibility for message headers  
✗ **Don't**: Mix unrelated functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create dependencies between unrelated atoms
        `,
      },
    },
  },
  argTypes: {
    name: {
      control: { type: 'text' },
      description: 'The name of the message sender',
    },
    timestamp: {
      control: { type: 'date' },
      description: 'The timestamp of the message',
    },
    role: {
      control: { type: 'select' },
      options: ['user', 'assistant'],
      description: 'Role determines the default avatar',
    },
    badge: {
      control: { type: 'object' },
      description: 'Badge configuration with text and variant',
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

export const UserMessage: Story = {
  args: {
    name: 'John Doe',
    timestamp: new Date(),
    role: 'user',
  },
};

export const AssistantMessage: Story = {
  args: {
    name: 'Claude',
    timestamp: new Date(),
    role: 'assistant',
  },
};

export const WithBadge: Story = {
  args: {
    name: 'Claude',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'AI Assistant',
      variant: 'primary',
    },
  },
};

export const WithClaudeBadge: Story = {
  args: {
    name: 'Claude',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'Claude',
      variant: 'claude',
    },
  },
};

export const WithGPT4Badge: Story = {
  args: {
    name: 'GPT-4',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'GPT-4',
      variant: 'gpt-4',
    },
  },
};

export const WithGeminiBadge: Story = {
  args: {
    name: 'Gemini',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'Gemini',
      variant: 'gemini',
    },
  },
};

export const WithSuccessBadge: Story = {
  args: {
    name: 'System',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'Success',
      variant: 'success',
    },
  },
};

export const WithWarningBadge: Story = {
  args: {
    name: 'System',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'Warning',
      variant: 'warning',
    },
  },
};

export const WithErrorBadge: Story = {
  args: {
    name: 'System',
    timestamp: new Date(),
    role: 'assistant',
    badge: {
      text: 'Error',
      variant: 'error',
    },
  },
};

export const AllBadgeVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-full">
      <MessageHeader
        name="Claude"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Primary', variant: 'primary' }}
      />
      <MessageHeader
        name="GPT-4"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Secondary', variant: 'secondary' }}
      />
      <MessageHeader
        name="Gemini"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Accent', variant: 'accent' }}
      />
      <MessageHeader
        name="System"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Success', variant: 'success' }}
      />
      <MessageHeader
        name="System"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Warning', variant: 'warning' }}
      />
      <MessageHeader
        name="System"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Error', variant: 'error' }}
      />
      <MessageHeader
        name="Info Bot"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Info', variant: 'info' }}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available badge variants displayed together.',
      },
    },
  },
};

export const AIAssistants: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-full">
      <MessageHeader
        name="Claude"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Claude', variant: 'claude' }}
      />
      <MessageHeader
        name="GPT-4"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'GPT-4', variant: 'gpt-4' }}
      />
      <MessageHeader
        name="Gemini"
        timestamp={new Date()}
        role="assistant"
        badge={{ text: 'Gemini', variant: 'gemini' }}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different AI assistants with their specific badge styles.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Message Header Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the message headers below!
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
          <MessageHeader
            name="You"
            timestamp={new Date(Date.now() - 5 * 60 * 1000)}
            role="user"
          />
          <div className="mt-2 text-sm text-gray-600">
            User message header - simple and clean
          </div>
        </div>
        
        <div className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
          <MessageHeader
            name="Claude"
            timestamp={new Date(Date.now() - 2 * 60 * 1000)}
            role="assistant"
            badge={{ text: 'AI Assistant', variant: 'primary' }}
          />
          <div className="mt-2 text-sm text-gray-600">
            Assistant with primary badge - professional look
          </div>
        </div>
        
        <div className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
          <MessageHeader
            name="GPT-4"
            timestamp={new Date(Date.now() - 1 * 60 * 1000)}
            role="assistant"
            badge={{ text: 'GPT-4', variant: 'gpt-4' }}
          />
          <div className="mt-2 text-sm text-gray-600">
            GPT-4 with custom green badge styling
          </div>
        </div>
        
        <div className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
          <MessageHeader
            name="System"
            timestamp={new Date()}
            role="assistant"
            badge={{ text: 'Success', variant: 'success' }}
          />
          <div className="mt-2 text-sm text-gray-600">
            System message with success badge
          </div>
        </div>
        
        <div className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
          <MessageHeader
            name="Alert System"
            timestamp={new Date()}
            role="assistant"
            badge={{ text: 'Warning', variant: 'warning' }}
          />
          <div className="mt-2 text-sm text-gray-600">
            Warning message header for attention
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing message headers with tennis commentary. Enable commentary in the toolbar and interact with the headers!',
      },
    },
  },
};