import type { Meta, StoryObj } from '@storybook/react';
import Avatar from './Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Atoms/Avatar',
  component: Avatar,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## Avatar

**Atomic Classification**: Identity Atom  
**Source**: Core UI primitive for user representation  
**Single Responsibility**: Display role-based icons with consistent sizing

### Purpose
A foundational atom that provides visual identity for users and assistants in conversation interfaces. Uses semantic role-based icons with a consistent size system to maintain visual hierarchy.

### When to Use
- User identification in messages
- Assistant branding in responses
- Profile representation
- Speaker identification in conversations

### Design Tokens Used
- **Colors**: Role-specific colors (teal for users, orange for assistants)
- **Sizing**: Consistent scale (sm: 24px, md: 32px, lg: 40px)
- **Icons**: FontAwesome user/robot icons for semantic meaning
- **Spacing**: Rounded corners with consistent border radius

### Role Types
- **User**: Human participant with teal background and user icon
- **Assistant**: AI agent with orange background and robot icon

### Size Scale
- **Small (sm)**: 24px - Compact interfaces, inline mentions
- **Medium (md)**: 32px - Standard conversation views
- **Large (lg)**: 40px - Emphasis, profile headers

### Accessibility
- Semantic HTML with proper ARIA labels
- High contrast color combinations
- Icon alternatives for screen readers
- Consistent focus states

### Atom Guidelines
✓ **Do**: Use for consistent identity representation  
✓ **Do**: Maintain role-based color coding  
✓ **Do**: Follow size scale for visual hierarchy  
✗ **Don't**: Create custom colors outside the role system  
✗ **Don't**: Mix with unrelated icon types  
✗ **Don't**: Override semantic meaning
        `,
      },
    },
  },
  argTypes: {
    role: {
      control: { type: 'select' },
      options: ['user', 'assistant'],
      description: 'The role type determines the icon displayed',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'The size of the avatar',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {
  args: {
    role: 'user',
    size: 'md',
  },
};

export const Assistant: Story = {
  args: {
    role: 'assistant',
    size: 'md',
  },
};

export const UserSmall: Story = {
  args: {
    role: 'user',
    size: 'sm',
  },
};

export const UserLarge: Story = {
  args: {
    role: 'user',
    size: 'lg',
  },
};

export const AssistantSmall: Story = {
  args: {
    role: 'assistant',
    size: 'sm',
  },
};

export const AssistantLarge: Story = {
  args: {
    role: 'assistant',
    size: 'lg',
  },
};

export const AllRoles: Story = {
  render: () => (
    <div className="flex gap-6">
      <div className="text-center">
        <Avatar role="user" size="md" />
        <p className="text-xs text-gray-500 mt-2">User</p>
      </div>
      <div className="text-center">
        <Avatar role="assistant" size="md" />
        <p className="text-xs text-gray-500 mt-2">Assistant</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available avatar roles displayed together.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <Avatar role="user" size="sm" />
        <p className="text-xs text-gray-500 mt-1">Small</p>
      </div>
      <div className="text-center">
        <Avatar role="user" size="md" />
        <p className="text-xs text-gray-500 mt-1">Medium</p>
      </div>
      <div className="text-center">
        <Avatar role="user" size="lg" />
        <p className="text-xs text-gray-500 mt-1">Large</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available avatar sizes displayed together.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Avatar Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the avatars below!
        </p>
      </div>
      
      <div className="grid grid-cols-2 gap-8">
        <div className="text-center">
          <div className="cursor-pointer transition-transform hover:scale-110">
            <Avatar role="user" size="lg" />
          </div>
          <p className="text-sm font-medium mt-2">User Avatar</p>
          <p className="text-xs text-gray-500">Click & hover for commentary!</p>
        </div>
        
        <div className="text-center">
          <div className="cursor-pointer transition-transform hover:scale-110">
            <Avatar role="assistant" size="lg" />
          </div>
          <p className="text-sm font-medium mt-2">Assistant Avatar</p>
          <p className="text-xs text-gray-500">Great for interactions!</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing avatars with tennis commentary. Enable commentary in the toolbar and interact with the avatars!',
      },
    },
  },
};