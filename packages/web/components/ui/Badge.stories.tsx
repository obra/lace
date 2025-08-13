// ABOUTME: Storybook story for Badge.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import Badge from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Atoms/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## Badge

**Atomic Classification**: Status Atom  
**Source**: Core UI primitive for labels and notifications  
**Single Responsibility**: Display status, labels, and contextual information

### Purpose
A versatile atomic component that provides visual status indicators, labels, and notifications throughout the interface. Uses semantic color variants and consistent sizing for clear information hierarchy.

### When to Use
- Status indicators (online, offline, error, success)
- Category labels and tags
- Notification counters
- Agent identification
- Feature flags and toggles

### Design Tokens Used
- **Colors**: Semantic variants (primary, secondary, accent, ghost, default)
- **Sizing**: Consistent scale (xs, sm, md, lg)
- **Typography**: Balanced text sizing with padding
- **Spacing**: Proportional padding for each size
- **Borders**: Rounded corners for modern appearance

### Variant Types
- **Default**: Neutral gray for general labels
- **Primary**: Brand color for important status
- **Secondary**: Muted color for secondary information
- **Accent**: Highlight color for special cases
- **Ghost**: Transparent background for subtle labeling

### Size Scale
- **Extra Small (xs)**: 10px text - Minimal indicators
- **Small (sm)**: 12px text - Compact interfaces
- **Medium (md)**: 14px text - Standard usage
- **Large (lg)**: 16px text - Emphasis and headers

### Accessibility
- High contrast color combinations
- Semantic HTML with proper structure
- Screen reader friendly content
- Focus states for interactive badges

### Atom Guidelines
✓ **Do**: Use for consistent status representation  
✓ **Do**: Follow semantic color meanings  
✓ **Do**: Maintain size hierarchy  
✗ **Don't**: Create custom colors outside the variant system  
✗ **Don't**: Use for interactive elements without proper states  
✗ **Don't**: Mix incompatible size combinations
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'primary', 'secondary', 'accent', 'ghost'],
      description: 'The visual variant of the badge',
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'The size of the badge',
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes',
    },
    children: {
      control: { type: 'text' },
      description: 'Badge content',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Default Badge',
    variant: 'default',
    size: 'md',
  },
};

export const Primary: Story = {
  args: {
    children: 'Primary',
    variant: 'primary',
    size: 'md',
  },
};

export const Secondary: Story = {
  args: {
    children: 'Secondary',
    variant: 'secondary',
    size: 'md',
  },
};

export const Accent: Story = {
  args: {
    children: 'Accent',
    variant: 'accent',
    size: 'md',
  },
};

export const Outline: Story = {
  args: {
    children: 'Outline',
    variant: 'outline',
    size: 'md',
  },
};

export const ExtraSmall: Story = {
  args: {
    children: 'XS',
    variant: 'primary',
    size: 'xs',
  },
};

export const Small: Story = {
  args: {
    children: 'Small',
    variant: 'primary',
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    children: 'Medium',
    variant: 'primary',
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    children: 'Large',
    variant: 'primary',
    size: 'lg',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Badge variant="default">Default</Badge>
      <Badge variant="primary">Primary</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="accent">Accent</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'All available badge variants displayed together. Great for testing tennis commentary!',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Badge variant="primary" size="xs">
        XS
      </Badge>
      <Badge variant="primary" size="sm">
        SM
      </Badge>
      <Badge variant="primary" size="md">
        MD
      </Badge>
      <Badge variant="primary" size="lg">
        LG
      </Badge>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available badge sizes displayed together. Perfect for hover interactions!',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the badges below!
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <Badge variant="primary" size="lg" className="cursor-pointer">
            Hover Me!
          </Badge>
          <p className="text-xs text-gray-500 mt-1">Primary Badge</p>
        </div>

        <div className="text-center">
          <Badge variant="accent" size="lg" className="cursor-pointer">
            Click Me!
          </Badge>
          <p className="text-xs text-gray-500 mt-1">Accent Badge</p>
        </div>

        <div className="text-center">
          <Badge variant="secondary" size="lg" className="cursor-pointer">
            Try Both!
          </Badge>
          <p className="text-xs text-gray-500 mt-1">Secondary Badge</p>
        </div>

        <div className="text-center">
          <Badge variant="outline" size="lg" className="cursor-pointer">
            Amazing!
          </Badge>
          <p className="text-xs text-gray-500 mt-1">Ghost Badge</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing the tennis commentary system. Enable commentary in the toolbar and interact with the badges!',
      },
    },
  },
};
