// ABOUTME: Storybook story for StatusDot.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import StatusDot from './StatusDot';

const meta: Meta<typeof StatusDot> = {
  title: 'Atoms/StatusDot',
  component: StatusDot,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## StatusDot

**Atomic Classification**: Status Atom  
**Source**: Consistent status and feedback indicator pattern  
**Single Responsibility**: Visual status communication with semantic color coding

### Purpose
A fundamental building block for status communication. Provides instant visual feedback using semantic colors and consistent sizing. The smallest unit for status indication that follows our design token system.

### When to Use
- Connection status indicators
- Agent availability states
- Process completion markers
- Health/status dashboards
- Real-time status updates

### Design Tokens Used
- **Colors**: Semantic feedback colors (success, warning, error, info)
- **Sizing**: Consistent scale (sm: w-2 h-2, md: w-3 h-3, lg: w-4 h-4)
- **Layout**: Rounded-full for perfect circles
- **Animations**: Optional pulse for active states

### Semantic Color Usage
- **Success (green)**: Online, completed, healthy
- **Warning (yellow)**: Pending, attention needed, degraded
- **Error (red)**: Offline, failed, critical
- **Info (blue)**: Processing, neutral information
- **Neutral**: Default, unknown, inactive

### Accessibility
- Sufficient color contrast for visibility
- Not relying on color alone for meaning
- Screen reader compatible when paired with text
- Consistent sizing for different visual contexts

### State Patterns
- **Static**: Simple status indication
- **Animated**: Pulse animation for active/live states
- **Grouped**: Multiple dots for multi-status interfaces
- **Contextual**: Paired with text labels for clarity

### Composition Guidelines
✓ **Do**: Use semantic colors consistently  
✓ **Do**: Pair with text labels for accessibility  
✓ **Do**: Follow the consistent sizing scale  
✓ **Do**: Use in navigation items and status bars  
✗ **Don't**: Create custom colors outside the token system  
✗ **Don't**: Use arbitrary sizes  
✗ **Don't**: Rely on color alone for meaning
        `,
      },
    },
  },
  argTypes: {
    status: {
      control: { type: 'select' },
      options: ['online', 'offline', 'busy', 'away', 'error', 'success', 'warning', 'info'],
      description: 'The status type determines the color',
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'The size of the status dot',
    },
    pulse: {
      control: { type: 'boolean' },
      description: 'Whether the dot should pulse',
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

export const Online: Story = {
  args: {
    status: 'online',
    size: 'sm',
    pulse: false,
  },
};

export const Offline: Story = {
  args: {
    status: 'offline',
    size: 'sm',
    pulse: false,
  },
};

export const Busy: Story = {
  args: {
    status: 'busy',
    size: 'sm',
    pulse: false,
  },
};

export const Away: Story = {
  args: {
    status: 'away',
    size: 'sm',
    pulse: false,
  },
};

export const Error: Story = {
  args: {
    status: 'error',
    size: 'sm',
    pulse: false,
  },
};

export const Success: Story = {
  args: {
    status: 'success',
    size: 'sm',
    pulse: false,
  },
};

export const Warning: Story = {
  args: {
    status: 'warning',
    size: 'sm',
    pulse: false,
  },
};

export const Info: Story = {
  args: {
    status: 'info',
    size: 'sm',
    pulse: false,
  },
};

export const WithPulse: Story = {
  args: {
    status: 'online',
    size: 'md',
    pulse: true,
  },
};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      {(['online', 'offline', 'busy', 'away', 'error', 'success', 'warning', 'info'] as const).map(
        (status) => (
          <div key={status} className="text-center">
            <StatusDot status={status} size="md" />
            <p className="text-xs text-gray-500 mt-1 capitalize">{status}</p>
          </div>
        )
      )}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available status types displayed together.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="text-center">
          <StatusDot status="online" size={size} />
          <p className="text-xs text-gray-500 mt-1 uppercase">{size}</p>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available sizes displayed together.',
      },
    },
  },
};

export const PulsingStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      {(['online', 'busy', 'warning', 'error'] as const).map((status) => (
        <div key={status} className="text-center">
          <StatusDot status={status} size="lg" pulse={true} />
          <p className="text-xs text-gray-500 mt-1 capitalize">{status} (Pulsing)</p>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Status dots with pulsing animation for attention-grabbing states.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Status Dot Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the status dots below!
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="text-center cursor-pointer">
          <StatusDot status="online" size="lg" pulse={true} />
          <p className="text-sm font-medium mt-2">Online</p>
          <p className="text-xs text-gray-500">Active & Ready</p>
        </div>

        <div className="text-center cursor-pointer">
          <StatusDot status="busy" size="lg" pulse={true} />
          <p className="text-sm font-medium mt-2">Busy</p>
          <p className="text-xs text-gray-500">Hard at Work</p>
        </div>

        <div className="text-center cursor-pointer">
          <StatusDot status="warning" size="lg" pulse={false} />
          <p className="text-sm font-medium mt-2">Warning</p>
          <p className="text-xs text-gray-500">Needs Attention</p>
        </div>

        <div className="text-center cursor-pointer">
          <StatusDot status="success" size="lg" pulse={false} />
          <p className="text-sm font-medium mt-2">Success</p>
          <p className="text-xs text-gray-500">All Good!</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing status dots with tennis commentary. Enable commentary in the toolbar and interact with the dots!',
      },
    },
  },
};
