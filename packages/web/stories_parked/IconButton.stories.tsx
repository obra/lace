// ABOUTME: Storybook story for IconButton.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import IconButton from './IconButton';
import {
  faSearch,
  faTerminal,
  faTasks,
  faFolder,
  faFolderOpen,
  faMicrophone,
  faPaperPlane,
  faPaperclip,
  faBars,
  faTimes,
  faComments,
  faPlus,
  faCheck,
  faCog,
  faFileCode,
  faUser,
  faSignOutAlt,
  faCrown,
  faRobot,
  faInfoCircle,
  faCreditCard,
  faExternalLinkAlt,
  faImages,
  faFileAlt,
  faFile,
  faImage,
  faFileExcel,
  faFolderPlus,
  faShare,
  faEdit,
  faCheckCircle,
  faTable,
  faMinus,
  faPlug,
  faStop,
  faEye,
  faColumns,
  faList,
  faCopy,
  faExpand,
  faCompress,
} from '@/lib/fontawesome';

const meta: Meta<typeof IconButton> = {
  title: 'Atoms/IconButton',
  component: IconButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## IconButton

**Atomic Classification**: Action Atom  
**Source**: Core UI primitive for interactive actions  
**Single Responsibility**: Square button with icon, badge, and loading states

### Purpose
A fundamental action atom that provides consistent interactive elements with FontAwesome icons. Supports various states, badges, and accessibility features for user interactions throughout the interface.

### When to Use
- Toolbar actions and controls
- Navigation elements
- Form submission buttons
- Interactive media controls
- Status and notification triggers

### Design Tokens Used
- **Colors**: Semantic variants (primary, secondary, accent, ghost, outline, error, warning, success)
- **Sizing**: Consistent scale (xs, sm, md, lg)
- **Spacing**: Proportional padding for each size
- **Typography**: Icon sizing aligned with button dimensions
- **Borders**: Rounded corners for modern appearance

### Icon System
- **FontAwesome Integration**: Uses centralized icon library from @/lib/fontawesome
- **Semantic Icons**: Consistent icon usage (search, send, settings, etc.)
- **Size Scaling**: Icons automatically scale with button size
- **Accessibility**: Proper ARIA labels and tooltips

### State Management
- **Loading**: Spinner overlay with disabled interaction
- **Disabled**: Reduced opacity and prevented interactions
- **Badge**: Notification indicators with customizable text
- **Hover/Focus**: Interactive feedback states

### Accessibility
- Proper ARIA labels and roles
- Keyboard navigation support (Tab, Enter, Space)
- Tooltip integration for context
- Screen reader compatible
- High contrast mode support

### Atom Guidelines
✓ **Do**: Use for consistent interactive actions  
✓ **Do**: Provide meaningful tooltips  
✓ **Do**: Follow semantic color usage  
✓ **Do**: Use appropriate icon semantics  
✗ **Don't**: Create custom colors outside the variant system  
✗ **Don't**: Use for non-interactive display  
✗ **Don't**: Override icon sizing manually
        `,
      },
    },
  },
  argTypes: {
    icon: {
      control: { type: 'select' },
      options: [
        'faSearch',
        'faTerminal',
        'faTasks',
        'faFolder',
        'faMicrophone',
        'faPaperPlane',
        'faPaperclip',
        'faPlus',
        'faCheck',
        'faCog',
        'faEdit',
        'faStop',
        'faShare',
      ],
      mapping: {
        faSearch,
        faTerminal,
        faTasks,
        faFolder,
        faMicrophone,
        faPaperPlane,
        faPaperclip,
        faPlus,
        faCheck,
        faCog,
        faEdit,
        faStop,
        faShare,
      },
      description: 'FontAwesome icon to display',
    },
    variant: {
      control: { type: 'select' },
      options: [
        'primary',
        'secondary',
        'accent',
        'ghost',
        'outline',
        'error',
        'warning',
        'success',
      ],
      description: 'Button variant/style',
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'Button size',
    },
    badge: {
      control: { type: 'text' },
      description: 'Badge text/number to display',
    },
    loading: {
      control: { type: 'boolean' },
      description: 'Loading state',
    },
    tooltip: {
      control: { type: 'text' },
      description: 'Tooltip text',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Disabled state',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: faSearch,
    variant: 'ghost',
    size: 'md',
    tooltip: 'Search',
  },
};

export const Primary: Story = {
  args: {
    icon: faPaperPlane,
    variant: 'primary',
    size: 'md',
    tooltip: 'Send',
  },
};

export const Secondary: Story = {
  args: {
    icon: faShare,
    variant: 'secondary',
    size: 'md',
    tooltip: 'Share',
  },
};

export const Accent: Story = {
  args: {
    icon: faFolder,
    variant: 'accent',
    size: 'md',
    tooltip: 'Open Folder',
  },
};

export const Error: Story = {
  args: {
    icon: faTimes,
    variant: 'error',
    size: 'md',
    tooltip: 'Close',
  },
};

export const Warning: Story = {
  args: {
    icon: faInfoCircle,
    variant: 'warning',
    size: 'md',
    tooltip: 'Information',
  },
};

export const Success: Story = {
  args: {
    icon: faCheck,
    variant: 'success',
    size: 'md',
    tooltip: 'Complete',
  },
};

export const WithBadge: Story = {
  args: {
    icon: faComments,
    variant: 'ghost',
    size: 'md',
    badge: '3',
    tooltip: 'Messages',
  },
};

export const Loading: Story = {
  args: {
    icon: faPlug,
    variant: 'primary',
    size: 'md',
    loading: true,
    tooltip: 'Connecting...',
  },
};

export const Disabled: Story = {
  args: {
    icon: faEdit,
    variant: 'outline',
    size: 'md',
    disabled: true,
    tooltip: 'Edit (disabled)',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <div className="text-center">
        <IconButton icon={faPaperPlane} variant="primary" size="md" tooltip="Primary" />
        <p className="text-xs text-gray-500 mt-1">Primary</p>
      </div>
      <div className="text-center">
        <IconButton icon={faShare} variant="secondary" size="md" tooltip="Secondary" />
        <p className="text-xs text-gray-500 mt-1">Secondary</p>
      </div>
      <div className="text-center">
        <IconButton icon={faFolder} variant="accent" size="md" tooltip="Accent" />
        <p className="text-xs text-gray-500 mt-1">Accent</p>
      </div>
      <div className="text-center">
        <IconButton icon={faSearch} variant="ghost" size="md" tooltip="Ghost" />
        <p className="text-xs text-gray-500 mt-1">Ghost</p>
      </div>
      <div className="text-center">
        <IconButton icon={faTerminal} variant="outline" size="md" tooltip="Outline" />
        <p className="text-xs text-gray-500 mt-1">Outline</p>
      </div>
      <div className="text-center">
        <IconButton icon={faTimes} variant="error" size="md" tooltip="Error" />
        <p className="text-xs text-gray-500 mt-1">Error</p>
      </div>
      <div className="text-center">
        <IconButton icon={faInfoCircle} variant="warning" size="md" tooltip="Warning" />
        <p className="text-xs text-gray-500 mt-1">Warning</p>
      </div>
      <div className="text-center">
        <IconButton icon={faCheck} variant="success" size="md" tooltip="Success" />
        <p className="text-xs text-gray-500 mt-1">Success</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button variants displayed together.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <IconButton icon={faSearch} variant="primary" size="xs" tooltip="Extra Small" />
        <p className="text-xs text-gray-500 mt-1">XS</p>
      </div>
      <div className="text-center">
        <IconButton icon={faSearch} variant="primary" size="sm" tooltip="Small" />
        <p className="text-xs text-gray-500 mt-1">SM</p>
      </div>
      <div className="text-center">
        <IconButton icon={faSearch} variant="primary" size="md" tooltip="Medium" />
        <p className="text-xs text-gray-500 mt-1">MD</p>
      </div>
      <div className="text-center">
        <IconButton icon={faSearch} variant="primary" size="lg" tooltip="Large" />
        <p className="text-xs text-gray-500 mt-1">LG</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button sizes displayed together.',
      },
    },
  },
};

export const WithBadges: Story = {
  render: () => (
    <div className="flex gap-4">
      <div className="text-center">
        <IconButton icon={faComments} variant="ghost" size="md" badge="3" tooltip="Messages" />
        <p className="text-xs text-gray-500 mt-1">Badge: 3</p>
      </div>
      <div className="text-center">
        <IconButton
          icon={faComments}
          variant="ghost"
          size="md"
          badge="99+"
          tooltip="Many messages"
        />
        <p className="text-xs text-gray-500 mt-1">Badge: 99+</p>
      </div>
      <div className="text-center">
        <IconButton icon={faComments} variant="ghost" size="md" badge="!" tooltip="Alert" />
        <p className="text-xs text-gray-500 mt-1">Badge: !</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Icon buttons with various badge types.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Icon Button Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the buttons below!
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="text-center">
          <IconButton
            icon={faSearch}
            variant="error"
            size="lg"
            tooltip="Search"
            onClick={() => alert('Searching!')}
          />
          <p className="text-sm font-medium mt-2">Search</p>
          <p className="text-xs text-gray-500">Find content</p>
        </div>

        <div className="text-center">
          <IconButton
            icon={faComments}
            variant="warning"
            size="lg"
            badge="5"
            tooltip="Messages"
            onClick={() => alert('5 messages!')}
          />
          <p className="text-sm font-medium mt-2">Messages</p>
          <p className="text-xs text-gray-500">5 new messages</p>
        </div>

        <div className="text-center">
          <IconButton
            icon={faPaperPlane}
            variant="success"
            size="lg"
            tooltip="Send message"
            onClick={() => alert('Sending...')}
          />
          <p className="text-sm font-medium mt-2">Send</p>
          <p className="text-xs text-gray-500">Send message</p>
        </div>

        <div className="text-center">
          <IconButton
            icon={faCog}
            variant="ghost"
            size="lg"
            tooltip="Settings"
            onClick={() => alert('Opening settings...')}
          />
          <p className="text-sm font-medium mt-2">Settings</p>
          <p className="text-xs text-gray-500">Configure app</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing icon buttons with tennis commentary. Enable commentary in the toolbar and interact with the buttons!',
      },
    },
  },
};
