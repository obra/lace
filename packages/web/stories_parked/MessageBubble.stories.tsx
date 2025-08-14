/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for MessageBubble.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import MessageBubble from './MessageBubble';
import IconButton from './IconButton';
import { faHeart, faShare, faBookmark, faReply } from '@/lib/fontawesome';

const meta: Meta<typeof MessageBubble> = {
  title: 'Molecules/MessageBubble',
  component: MessageBubble,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## MessageBubble

**Atomic Classification**: Message Container Molecule  
**Composed of**: Avatar + StatusDot + Badge + TimestampDisplay + Content Container atoms  
**Single Responsibility**: Display complete chat message with user context, content, and actions

### Purpose
A cohesive molecule that combines 4-5 atoms to solve the specific UI pattern of chat message display. Handles user identification, status indication, content presentation, and action buttons in a single, reusable component.

### When to Use
- Chat message display
- Comment threads
- Activity feeds
- Notification items
- User-generated content display
- Conversation interfaces

### Atomic Composition
- **Avatar**: User/assistant profile picture with role-based styling
- **StatusDot**: User status indicator (online, offline, busy, away)
- **Badge**: Message type/status indicators with semantic colors
- **TimestampDisplay**: Formatted timestamp for message timing
- **Content Container**: Structured content area with proper spacing
- **Action Buttons**: Optional interaction buttons (like, share, bookmark)

### Design Tokens Used
- **Layout**: Flexbox composition with gap-3 spacing
- **Colors**: Variant-based background colors (primary, error, info)
- **Borders**: Rounded corners with variant-specific border colors
- **Spacing**: Consistent padding (p-4) and content spacing
- **Typography**: Proper text hierarchy and readability

### Message Variants
- **default**: Standard message with base styling
- **highlighted**: Emphasized message with primary accent
- **error**: Error message with error accent colors
- **system**: System message with info accent colors

### State Management
- **role**: User or assistant role for avatar and styling
- **avatar**: Avatar configuration with status indicator
- **header**: Message header with name, timestamp, and badges
- **variant**: Visual variant for different message types
- **actions**: Optional action buttons for interaction

### Accessibility
- Proper semantic structure with message hierarchy
- Screen reader friendly content organization
- Clear visual hierarchy between sender, content, and actions
- Accessible color contrast for all variants
- Keyboard navigation support for action buttons

### Composition Guidelines
✓ **Do**: Use in chat organisms and conversation templates  
✓ **Do**: Combine atoms logically for message display  
✓ **Do**: Maintain single responsibility for message presentation  
✓ **Do**: Provide consistent status and badge semantics  
✗ **Don&apos;t**: Mix unrelated functionality  
✗ **Don&apos;t**: Override individual atom styles  
✗ **Don&apos;t**: Create complex nested message structures
        `,
      },
    },
  },
  argTypes: {
    role: {
      control: { type: 'select' },
      options: ['user', 'assistant'],
      description: 'The role determines the avatar icon',
    },
    avatar: {
      control: { type: 'object' },
      description: 'Avatar configuration with name and status',
    },
    header: {
      control: { type: 'object' },
      description: 'Header configuration with name, timestamp, and badges',
    },
    variant: {
      control: { type: 'select' },
      options: ['default', 'highlighted', 'error', 'system'],
      description: 'Visual variant of the message bubble',
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
    role: 'user',
    header: {
      name: 'John Doe',
      timestamp: '2:30 PM',
    },
    children: (
      <div>
        <p>
          Hey there! I&apos;m working on a new project and could use some help with the
          implementation.
        </p>
      </div>
    ),
  },
};

export const AssistantMessage: Story = {
  args: {
    role: 'assistant',
    header: {
      name: 'Claude',
      timestamp: '2:31 PM',
      badges: [{ text: 'AI Assistant', variant: 'primary' }],
    },
    children: (
      <div>
        <p>
          I&apos;d be happy to help! What kind of project are you working on? Please share more
          details about the specific implementation you need assistance with.
        </p>
      </div>
    ),
  },
};

export const WithStatus: Story = {
  args: {
    role: 'user',
    avatar: {
      name: 'Jane Smith',
      status: 'online',
    },
    header: {
      name: 'Jane Smith',
      timestamp: '2:32 PM',
    },
    children: (
      <div>
        <p>I&apos;m currently online and available for discussion!</p>
      </div>
    ),
  },
};

export const WithMultipleBadges: Story = {
  args: {
    role: 'assistant',
    header: {
      name: 'GPT-4',
      timestamp: '2:33 PM',
      badges: [
        { text: 'AI', variant: 'primary' },
        { text: 'GPT-4', variant: 'accent' },
        { text: 'Pro', variant: 'success' },
      ],
    },
    children: (
      <div>
        <p>
          I&apos;m an advanced AI assistant with multiple capabilities including code generation,
          analysis, and problem-solving.
        </p>
      </div>
    ),
  },
};

export const WithActions: Story = {
  args: {
    role: 'assistant',
    header: {
      name: 'Claude',
      timestamp: '2:34 PM',
      badges: [{ text: 'AI Assistant', variant: 'primary' }],
    },
    children: (
      <div>
        <p>
          Here&apos;s a comprehensive solution to your problem. You can like, share, or bookmark
          this response for future reference.
        </p>
      </div>
    ),
    actions: (
      <div className="flex gap-2">
        <IconButton icon={faHeart} variant="ghost" size="sm" tooltip="Like" />
        <IconButton icon={faShare} variant="ghost" size="sm" tooltip="Share" />
        <IconButton icon={faBookmark} variant="ghost" size="sm" tooltip="Bookmark" />
        <IconButton icon={faReply} variant="ghost" size="sm" tooltip="Reply" />
      </div>
    ),
  },
};

export const HighlightedMessage: Story = {
  args: {
    role: 'assistant',
    variant: 'highlighted',
    header: {
      name: 'Claude',
      timestamp: '2:35 PM',
      badges: [{ text: 'Important', variant: 'warning' }],
    },
    children: (
      <div>
        <p>
          🔥 This is a highlighted message that contains important information you should pay
          attention to!
        </p>
      </div>
    ),
  },
};

export const ErrorMessage: Story = {
  args: {
    role: 'assistant',
    variant: 'error',
    header: {
      name: 'System',
      timestamp: '2:36 PM',
      badges: [{ text: 'Error', variant: 'error' }],
    },
    children: (
      <div>
        <p>
          ⚠️ An error occurred while processing your request. Please try again or contact support if
          the problem persists.
        </p>
      </div>
    ),
  },
};

export const SystemMessage: Story = {
  args: {
    role: 'assistant',
    variant: 'system',
    header: {
      name: 'System',
      timestamp: '2:37 PM',
      badges: [{ text: 'System', variant: 'info' }],
    },
    children: (
      <div>
        <p>
          ℹ️ The conversation has been automatically saved. Your progress is secure and can be
          resumed at any time.
        </p>
      </div>
    ),
  },
};

export const LongMessage: Story = {
  args: {
    role: 'assistant',
    header: {
      name: 'Claude',
      timestamp: '2:38 PM',
      badges: [{ text: 'AI Assistant', variant: 'primary' }],
    },
    children: (
      <div className="space-y-4">
        <p>Here&apos;s a comprehensive explanation of the topic you asked about:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>First, let&apos;s understand the fundamental concepts</li>
          <li>Then we&apos;ll explore the practical applications</li>
          <li>Next, we&apos;ll dive into advanced techniques</li>
          <li>Finally, we&apos;ll discuss best practices and optimization</li>
        </ul>
        <p>
          This approach ensures you get a complete understanding of the subject matter while
          maintaining clarity and practical applicability.
        </p>
      </div>
    ),
    actions: (
      <div className="flex gap-2">
        <IconButton icon={faHeart} variant="ghost" size="sm" tooltip="Like" />
        <IconButton icon={faShare} variant="ghost" size="sm" tooltip="Share" />
        <IconButton icon={faBookmark} variant="ghost" size="sm" tooltip="Bookmark" />
      </div>
    ),
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Message Bubble Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the message bubbles
          below!
        </p>
      </div>

      <div className="space-y-4">
        <div className="cursor-pointer transition-transform hover:scale-[1.02]">
          <MessageBubble
            role="user"
            avatar={{ status: 'online' }}
            header={{
              name: 'You',
              timestamp: '2:30 PM',
            }}
          >
            <p>Hey! Can you help me understand how Storybook works?</p>
          </MessageBubble>
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.02]">
          <MessageBubble
            role="assistant"
            variant="highlighted"
            header={{
              name: 'Claude',
              timestamp: '2:31 PM',
              badges: [
                { text: 'AI Assistant', variant: 'primary' },
                { text: 'Expert', variant: 'accent' },
              ],
            }}
            actions={
              <div className="flex gap-2">
                <IconButton icon={faHeart} variant="ghost" size="sm" tooltip="Like" />
                <IconButton icon={faShare} variant="ghost" size="sm" tooltip="Share" />
                <IconButton icon={faBookmark} variant="ghost" size="sm" tooltip="Bookmark" />
              </div>
            }
          >
            <p>
              Absolutely! Storybook is a powerful tool for building and testing UI components in
              isolation. It allows you to develop components independently and create interactive
              documentation.
            </p>
          </MessageBubble>
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.02]">
          <MessageBubble
            role="user"
            avatar={{ status: 'online' }}
            header={{
              name: 'You',
              timestamp: '2:32 PM',
            }}
          >
            <p>That sounds amazing! Can you show me how to create stories?</p>
          </MessageBubble>
        </div>

        <div className="cursor-pointer transition-transform hover:scale-[1.02]">
          <MessageBubble
            role="assistant"
            variant="system"
            header={{
              name: 'System',
              timestamp: '2:33 PM',
              badges: [{ text: 'Tutorial', variant: 'info' }],
            }}
          >
            <p>
              🎾 Tennis commentary is perfect for interactive demos like this! Try hovering and
              clicking on these message bubbles to see the commentary in action.
            </p>
          </MessageBubble>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing message bubbles with tennis commentary. Enable commentary in the toolbar and interact with the messages!',
      },
    },
  },
};
