// ABOUTME: Storybook story for NavigationItem.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import NavigationItem from './NavigationItem';
import IconButton from './IconButton';
import {
  faFolder,
  faFile,
  faComment,
  faCog,
  faUser,
  faRobot,
  faEllipsisV,
  faEdit,
  faTrash,
  faHeart,
  faShare,
  faHistory,
  faBookmark,
  faBell,
  faInbox,
  faStar,
} from '@/lib/fontawesome';

const meta: Meta<typeof NavigationItem> = {
  title: 'Molecules/NavigationItem',
  component: NavigationItem,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## NavigationItem

**Atomic Classification**: Navigation Molecule  
**Composed of**: IconButton + Badge + StatusDot + Typography atoms  
**Single Responsibility**: Complete navigation list item with icon, content, status, and actions

### Purpose
A cohesive molecule that combines 3-4 atoms to solve the specific UI pattern of navigation items. Handles icon display, content hierarchy, status indication, and action buttons in a single, reusable component.

### When to Use
- Sidebar navigation menus
- Mobile navigation lists
- Settings navigation
- File browser items
- Dashboard navigation
- Menu items with status

### Atomic Composition
- **IconButton**: FontAwesome icon with proper sizing and colors
- **Badge**: Optional count or status badge with semantic colors
- **StatusDot**: Status indicator (online, offline, busy, error, success)
- **Typography**: Title and subtitle text with proper hierarchy
- **Action Buttons**: Optional right-aligned action controls

### Design Tokens Used
- **Layout**: Flexbox composition with gap-3 spacing
- **Colors**: Primary colors for active states, semantic status colors
- **Borders**: Active state border-l-2 with primary color
- **Spacing**: Consistent padding (p-3) and content spacing
- **Typography**: Font-medium titles, smaller subtitles
- **Transitions**: Smooth color transitions on hover/active

### State Management
- **isActive**: Controls active visual state and primary coloring
- **isDisabled**: Disables interaction and reduces opacity
- **status**: Status indicator for real-time status display
- **badge**: Optional badge for counts or short status text
- **actions**: Optional action buttons for item-specific actions

### Navigation States
- **default**: Standard navigation item with hover effects
- **active**: Highlighted item with primary colors and border
- **disabled**: Non-interactive item with reduced opacity
- **with-status**: Item with status indicator overlay

### Accessibility
- Proper semantic button structure for navigation
- Keyboard navigation support (Tab, Enter, Space)
- Screen reader friendly content hierarchy
- Clear visual hierarchy between title, subtitle, and actions
- Accessible color contrast for all states
- Focus indicators for keyboard users

### Composition Guidelines
✓ **Do**: Use in navigation organisms and sidebar templates  
✓ **Do**: Combine atoms logically for navigation items  
✓ **Do**: Maintain single responsibility for navigation display  
✓ **Do**: Provide consistent status and badge semantics  
✗ **Don't**: Mix unrelated functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create complex nested navigation structures
        `,
      },
    },
  },
  argTypes: {
    icon: {
      control: { type: 'select' },
      options: ['faFolder', 'faFile', 'faComment', 'faCog', 'faUser', 'faRobot'],
      mapping: {
        faFolder,
        faFile,
        faComment,
        faCog,
        faUser,
        faRobot,
      },
      description: 'FontAwesome icon to display',
    },
    title: {
      control: { type: 'text' },
      description: 'The main title text',
    },
    subtitle: {
      control: { type: 'text' },
      description: 'Optional subtitle text',
    },
    badge: {
      control: { type: 'text' },
      description: 'Badge text or number',
    },
    status: {
      control: { type: 'select' },
      options: ['online', 'offline', 'busy', 'away', 'error', 'success'],
      description: 'Status indicator',
    },
    isActive: {
      control: { type: 'boolean' },
      description: 'Whether the item is active/selected',
    },
    isDisabled: {
      control: { type: 'boolean' },
      description: 'Whether the item is disabled',
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

export const Default: Story = {
  args: {
    icon: faFolder,
    title: 'Documents',
    onClick: () => console.log('Clicked Documents'),
  },
};

export const WithSubtitle: Story = {
  args: {
    icon: faFile,
    title: 'Project Report',
    subtitle: 'Last updated 2 hours ago',
    onClick: () => console.log('Clicked Project Report'),
  },
};

export const WithBadge: Story = {
  args: {
    icon: faComment,
    title: 'Messages',
    badge: '3',
    onClick: () => console.log('Clicked Messages'),
  },
};

export const WithStatus: Story = {
  args: {
    icon: faUser,
    title: 'John Doe',
    status: 'online',
    onClick: () => console.log('Clicked John Doe'),
  },
};

export const Active: Story = {
  args: {
    icon: faFolder,
    title: 'Current Project',
    isActive: true,
    onClick: () => console.log('Clicked Current Project'),
  },
};

export const Disabled: Story = {
  args: {
    icon: faCog,
    title: 'Settings',
    isDisabled: true,
    onClick: () => console.log('This should not trigger'),
  },
};

export const WithActions: Story = {
  args: {
    icon: faFile,
    title: 'Important Document',
    subtitle: 'Shared with 5 people',
    actions: (
      <div className="flex gap-1">
        <IconButton icon={faEdit} variant="ghost" size="xs" tooltip="Edit" />
        <IconButton icon={faTrash} variant="ghost" size="xs" tooltip="Delete" />
        <IconButton icon={faEllipsisV} variant="ghost" size="xs" tooltip="More" />
      </div>
    ),
    onClick: () => console.log('Clicked Important Document'),
  },
};

export const ComplexExample: Story = {
  args: {
    icon: faRobot,
    title: 'AI Assistant',
    subtitle: 'Claude - Ready to help',
    badge: '2',
    status: 'online',
    isActive: true,
    actions: (
      <div className="flex gap-1">
        <IconButton icon={faHeart} variant="ghost" size="xs" tooltip="Favorite" />
        <IconButton icon={faShare} variant="ghost" size="xs" tooltip="Share" />
      </div>
    ),
    onClick: () => console.log('Clicked AI Assistant'),
  },
};

export const ConversationItems: Story = {
  render: () => (
    <div className="flex flex-col gap-2 w-full max-w-md">
      <NavigationItem
        icon={faComment}
        title="Project Discussion"
        subtitle="Last message 5 minutes ago"
        badge="3"
        status="online"
        onClick={() => console.log('Clicked Project Discussion')}
      />
      <NavigationItem
        icon={faRobot}
        title="AI Assistant Chat"
        subtitle="Claude - Ready to help"
        status="online"
        isActive={true}
        onClick={() => console.log('Clicked AI Assistant Chat')}
      />
      <NavigationItem
        icon={faHistory}
        title="Previous Conversation"
        subtitle="Completed yesterday"
        status="offline"
        onClick={() => console.log('Clicked Previous Conversation')}
      />
      <NavigationItem
        icon={faBookmark}
        title="Saved Chat"
        subtitle="Bookmarked for later"
        onClick={() => console.log('Clicked Saved Chat')}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Navigation items representing different conversation types.',
      },
    },
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-2 w-full max-w-md">
      <NavigationItem
        icon={faFolder}
        title="Default State"
        subtitle="Normal navigation item"
        onClick={() => console.log('Default clicked')}
      />
      <NavigationItem
        icon={faFolder}
        title="Active State"
        subtitle="Currently selected"
        isActive={true}
        onClick={() => console.log('Active clicked')}
      />
      <NavigationItem
        icon={faFolder}
        title="With Badge"
        subtitle="Has notification"
        badge="5"
        onClick={() => console.log('Badge clicked')}
      />
      <NavigationItem
        icon={faFolder}
        title="With Status"
        subtitle="Online indicator"
        status="online"
        onClick={() => console.log('Status clicked')}
      />
      <NavigationItem
        icon={faFolder}
        title="Disabled State"
        subtitle="Cannot be clicked"
        isDisabled={true}
        onClick={() => console.log('This should not trigger')}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available states of the navigation item component.',
      },
    },
  },
};

export const WithDifferentIcons: Story = {
  render: () => (
    <div className="flex flex-col gap-2 w-full max-w-md">
      <NavigationItem
        icon={faInbox}
        title="Inbox"
        subtitle="New messages"
        badge="12"
        onClick={() => console.log('Inbox clicked')}
      />
      <NavigationItem
        icon={faBell}
        title="Notifications"
        subtitle="Recent alerts"
        badge="3"
        status="error"
        onClick={() => console.log('Notifications clicked')}
      />
      <NavigationItem
        icon={faStar}
        title="Favorites"
        subtitle="Starred items"
        onClick={() => console.log('Favorites clicked')}
      />
      <NavigationItem
        icon={faCog}
        title="Settings"
        subtitle="Configure preferences"
        onClick={() => console.log('Settings clicked')}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Navigation items with different icon types.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const items = [
      {
        icon: faComment,
        title: 'Main Chat',
        subtitle: 'Primary conversation',
        badge: '5',
        status: 'online' as const,
        id: 'main-chat',
      },
      {
        icon: faRobot,
        title: 'AI Assistant',
        subtitle: 'Claude - Ready to help',
        status: 'online' as const,
        id: 'ai-assistant',
      },
      {
        icon: faHistory,
        title: 'Chat History',
        subtitle: 'Previous conversations',
        badge: '25',
        id: 'chat-history',
      },
      {
        icon: faBookmark,
        title: 'Saved Messages',
        subtitle: 'Important conversations',
        badge: '8',
        id: 'saved-messages',
      },
      {
        icon: faBell,
        title: 'Notifications',
        subtitle: 'System alerts',
        badge: '2',
        status: 'warning' as const,
        id: 'notifications',
      },
      {
        icon: faCog,
        title: 'Settings',
        subtitle: 'Configure preferences',
        id: 'settings',
      },
    ];

    return (
      <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">🎾 Navigation Item Tennis Commentary Demo</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enable tennis commentary in the toolbar above, then hover and click the navigation items
            below!
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div key={item.id} className="cursor-pointer transition-transform hover:scale-[1.02]">
              <NavigationItem
                icon={item.icon}
                title={item.title}
                subtitle={item.subtitle}
                badge={item.badge}
                status={item.status === 'warning' ? 'error' : item.status}
                isActive={index === 1} // Make AI Assistant active
                actions={
                  <div className="flex gap-1">
                    <IconButton icon={faHeart} variant="ghost" size="xs" tooltip="Favorite" />
                    <IconButton icon={faEllipsisV} variant="ghost" size="xs" tooltip="More" />
                  </div>
                }
                onClick={() => console.log(`Clicked ${item.title}`)}
              />
            </div>
          ))}
        </div>

        <div className="text-sm text-gray-600 space-y-1">
          <p>
            • <strong>Hover</strong> over items to see hover effects
          </p>
          <p>
            • <strong>Click</strong> items to see console logs
          </p>
          <p>
            • <strong>Action buttons</strong> have separate click handlers
          </p>
          <p>
            • <strong>Tennis commentary</strong> provides feedback on interactions!
          </p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing navigation items with tennis commentary. Enable commentary in the toolbar and interact with the items!',
      },
    },
  },
};
