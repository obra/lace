import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { AnimatedButton, AnimatedIconButton, AnimatedInput } from './AnimatedButton';

const meta: Meta<typeof AnimatedButton> = {
  title: 'Molecules/AnimatedButton',
  component: AnimatedButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## AnimatedButton

**Atomic Classification**: Interactive Animation Molecule  
**Composed of**: IconButton + MessageText + StatusDot + Container + Animation atoms  
**Single Responsibility**: Animated button interface with comprehensive state management, visual feedback, and motion design

### Purpose
A sophisticated animated button molecule that combines smooth animations, loading states, variant styling, and accessibility features. Built with Framer Motion for fluid interactions and comprehensive state management for modern application interfaces.

### When to Use
- Primary action buttons with enhanced UX
- Form submissions requiring loading states
- Interactive elements needing visual feedback
- Modern interfaces requiring motion design
- Accessibility-focused button interactions

### Atomic Composition
- **IconButton**: Base button functionality with click handling
- **MessageText**: Button text content with animated appearance
- **StatusDot**: Loading indicator with rotation animation
- **Container**: Positioned layout with size and variant styling
- **Animation**: Framer Motion animations for all interactions
- **Ripple Effect**: Touch feedback with gradient animations

### Design Tokens Used
- **Colors**: Semantic color variants (primary, secondary, error, warning, success)
- **Spacing**: Size-based padding (xs: px-2 py-1, lg: px-6 py-3)
- **Typography**: Responsive text sizing (xs: text-xs, lg: text-base)
- **Animations**: Spring configurations for natural motion
- **Borders**: Rounded corners (rounded-lg) and outline variants
- **Shadows**: Hover elevation with box-shadow animations

### Button Variants
- **Primary**: Main action button with primary color
- **Secondary**: Secondary actions with secondary color
- **Ghost**: Transparent button with subtle hover effects
- **Outline**: Bordered button with background on hover
- **Error**: Destructive actions with error color
- **Warning**: Caution actions with warning color
- **Success**: Positive actions with success color

### Size Options
- **xs**: Extra small (px-2 py-1, text-xs)
- **sm**: Small (px-3 py-1.5, text-sm)
- **md**: Medium (px-4 py-2, text-sm) - default
- **lg**: Large (px-6 py-3, text-base)

### Animation Features
- **Hover Effects**: Scale and box-shadow animations
- **Tap Feedback**: Button press animations with scale
- **Loading States**: Spinning indicator with opacity transitions
- **Ripple Effect**: Touch feedback with radial gradients
- **Icon Animations**: Staggered icon appearance with delays
- **Focus Rings**: Accessible focus indicators

### State Management
- **Loading**: Shows spinner and disables interaction
- **Disabled**: Reduces opacity and prevents interaction
- **Icon Support**: Left or right positioned icons
- **Type Support**: Button, submit, and reset types
- **Click Handling**: Proper event handling and propagation

### Specialized Components
- **AnimatedIconButton**: Icon-only button with circular design
- **AnimatedInput**: Floating label input with animations
- **Combined Usage**: Can be used together in forms

### Accessibility
- **Keyboard Navigation**: Full keyboard support and focus management
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators and tab order
- **High Contrast**: Theme-aware styling for accessibility
- **Loading States**: Accessible loading announcements

### Molecule Guidelines
✓ **Do**: Use for primary interactive elements requiring feedback  
✓ **Do**: Include loading states for async operations  
✓ **Do**: Provide proper ARIA labels and accessibility  
✓ **Do**: Choose appropriate variants for action context  
✗ **Don't**: Use for simple buttons without animation needs  
✗ **Don't**: Override animation timings without testing  
✗ **Don't**: Skip loading states for async operations
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['primary', 'secondary', 'ghost', 'outline', 'error', 'warning', 'success'],
      description: 'Button variant/style',
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'Button size',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether button is disabled',
    },
    loading: {
      control: { type: 'boolean' },
      description: 'Whether button is in loading state',
    },
    iconPosition: {
      control: { type: 'select' },
      options: ['left', 'right'],
      description: 'Icon position relative to text',
    },
    type: {
      control: { type: 'select' },
      options: ['button', 'submit', 'reset'],
      description: 'Button type',
    },
    onClick: {
      action: 'clicked',
      description: 'Click handler',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Click Me',
    variant: 'primary',
    size: 'md',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <AnimatedButton variant="primary">Primary</AnimatedButton>
      <AnimatedButton variant="secondary">Secondary</AnimatedButton>
      <AnimatedButton variant="ghost">Ghost</AnimatedButton>
      <AnimatedButton variant="outline">Outline</AnimatedButton>
      <AnimatedButton variant="error">Error</AnimatedButton>
      <AnimatedButton variant="warning">Warning</AnimatedButton>
      <AnimatedButton variant="success">Success</AnimatedButton>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button variants with their respective styling.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <AnimatedButton size="xs">Extra Small</AnimatedButton>
      <AnimatedButton size="sm">Small</AnimatedButton>
      <AnimatedButton size="md">Medium</AnimatedButton>
      <AnimatedButton size="lg">Large</AnimatedButton>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button sizes from extra small to large.',
      },
    },
  },
};

export const WithIcons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <AnimatedButton icon={<span>👍</span>} iconPosition="left">
        Like
      </AnimatedButton>
      <AnimatedButton icon={<span>📤</span>} iconPosition="right">
        Send
      </AnimatedButton>
      <AnimatedButton icon={<span>⬇️</span>} iconPosition="left" variant="secondary">
        Download
      </AnimatedButton>
      <AnimatedButton icon={<span>🗑️</span>} iconPosition="right" variant="error">
        Delete
      </AnimatedButton>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Buttons with icons positioned on the left or right side.',
      },
    },
  },
};

export const LoadingStates: Story = {
  render: () => {
    const [loadingStates, setLoadingStates] = useState({
      primary: false,
      secondary: false,
      error: false,
    });

    const handleClick = (type: keyof typeof loadingStates) => {
      setLoadingStates(prev => ({ ...prev, [type]: true }));
      setTimeout(() => {
        setLoadingStates(prev => ({ ...prev, [type]: false }));
      }, 2000);
    };

    return (
      <div className="flex flex-wrap gap-4">
        <AnimatedButton
          variant="primary"
          loading={loadingStates.primary}
          onClick={() => handleClick('primary')}
        >
          Submit Form
        </AnimatedButton>
        <AnimatedButton
          variant="secondary"
          loading={loadingStates.secondary}
          onClick={() => handleClick('secondary')}
        >
          Save Draft
        </AnimatedButton>
        <AnimatedButton
          variant="error"
          loading={loadingStates.error}
          onClick={() => handleClick('error')}
        >
          Delete Item
        </AnimatedButton>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Buttons with loading states that activate on click and auto-reset after 2 seconds.',
      },
    },
  },
};

export const DisabledStates: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <AnimatedButton disabled>Disabled Primary</AnimatedButton>
      <AnimatedButton variant="secondary" disabled>
        Disabled Secondary
      </AnimatedButton>
      <AnimatedButton variant="outline" disabled>
        Disabled Outline
      </AnimatedButton>
      <AnimatedButton variant="ghost" disabled>
        Disabled Ghost
      </AnimatedButton>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Buttons in disabled state showing reduced opacity and no interaction.',
      },
    },
  },
};

export const FormExample: Story = {
  render: () => {
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      message: '',
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        alert('Form submitted!');
      }, 2000);
    };

    const handleReset = () => {
      setFormData({ name: '', email: '', message: '' });
    };

    return (
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatedInput
            label="Name"
            value={formData.name}
            onChange={(value) => setFormData(prev => ({ ...prev, name: value }))}
            icon={<span>👤</span>}
          />
          
          <AnimatedInput
            label="Email"
            type="email"
            value={formData.email}
            onChange={(value) => setFormData(prev => ({ ...prev, email: value }))}
            icon={<span>📧</span>}
          />
          
          <AnimatedInput
            label="Message"
            value={formData.message}
            onChange={(value) => setFormData(prev => ({ ...prev, message: value }))}
            icon={<span>💬</span>}
          />
          
          <div className="flex gap-2">
            <AnimatedButton
              type="submit"
              loading={loading}
              disabled={!formData.name || !formData.email}
              icon={<span>📤</span>}
            >
              Send Message
            </AnimatedButton>
            <AnimatedButton
              type="button"
              variant="ghost"
              onClick={handleReset}
              disabled={loading}
            >
              Reset
            </AnimatedButton>
          </div>
        </form>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Complete form example with AnimatedInput and AnimatedButton components working together.',
      },
    },
  },
};

export const IconButtons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <AnimatedIconButton icon={<span>❤️</span>} ariaLabel="Like" />
      <AnimatedIconButton icon={<span>🔄</span>} ariaLabel="Refresh" variant="outline" />
      <AnimatedIconButton icon={<span>⚙️</span>} ariaLabel="Settings" variant="ghost" />
      <AnimatedIconButton icon={<span>🗑️</span>} ariaLabel="Delete" variant="primary" />
      <AnimatedIconButton icon={<span>👁️</span>} ariaLabel="View" size="lg" />
      <AnimatedIconButton icon={<span>✏️</span>} ariaLabel="Edit" size="sm" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Icon-only buttons in different sizes and variants with proper accessibility.',
      },
    },
  },
};

export const ButtonGroup: Story = {
  render: () => {
    const [selected, setSelected] = useState('center');

    return (
      <div className="space-y-6">
        <div className="text-sm font-medium text-base-content">Text Alignment</div>
        <div className="flex rounded-lg border border-base-300 overflow-hidden">
          <AnimatedButton
            variant={selected === 'left' ? 'primary' : 'ghost'}
            onClick={() => setSelected('left')}
            className="rounded-none border-r border-base-300"
            icon={<span>◀</span>}
          >
            Left
          </AnimatedButton>
          <AnimatedButton
            variant={selected === 'center' ? 'primary' : 'ghost'}
            onClick={() => setSelected('center')}
            className="rounded-none border-r border-base-300"
            icon={<span>▬</span>}
          >
            Center
          </AnimatedButton>
          <AnimatedButton
            variant={selected === 'right' ? 'primary' : 'ghost'}
            onClick={() => setSelected('right')}
            className="rounded-none"
            icon={<span>▶</span>}
          >
            Right
          </AnimatedButton>
        </div>
        
        <div className="text-sm text-base-content/60">
          Selected: {selected}
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Button group example showing toggle functionality with animated state changes.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 AnimatedButton Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then click, hover, and interact with the buttons!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer hover:shadow-lg transition-shadow border rounded-lg p-4">
          <h4 className="font-medium mb-3">Button Variants</h4>
          <div className="space-y-3">
            <div className="flex gap-2">
              <AnimatedButton variant="primary">Primary</AnimatedButton>
              <AnimatedButton variant="secondary">Secondary</AnimatedButton>
            </div>
            <div className="flex gap-2">
              <AnimatedButton variant="ghost">Ghost</AnimatedButton>
              <AnimatedButton variant="outline">Outline</AnimatedButton>
            </div>
            <div className="flex gap-2">
              <AnimatedButton variant="error">Error</AnimatedButton>
              <AnimatedButton variant="success">Success</AnimatedButton>
            </div>
          </div>
        </div>
        
        <div className="cursor-pointer hover:shadow-lg transition-shadow border rounded-lg p-4">
          <h4 className="font-medium mb-3">Icon Buttons</h4>
          <div className="space-y-3">
            <div className="flex gap-2">
              <AnimatedIconButton icon={<span>❤️</span>} ariaLabel="Like" />
              <AnimatedIconButton icon={<span>🔄</span>} ariaLabel="Refresh" variant="outline" />
              <AnimatedIconButton icon={<span>⚙️</span>} ariaLabel="Settings" variant="ghost" />
            </div>
            <div className="flex gap-2">
              <AnimatedButton icon={<span>📤</span>} size="sm">
                Send
              </AnimatedButton>
              <AnimatedButton icon={<span>⬇️</span>} variant="secondary" size="sm">
                Download
              </AnimatedButton>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">AnimatedButton Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Smooth Animations</strong> - Hover, tap, and loading animations</li>
          <li>• <strong>Multiple Variants</strong> - 7 different button styles</li>
          <li>• <strong>Size Options</strong> - From extra small to large</li>
          <li>• <strong>Loading States</strong> - Animated spinners and disabled states</li>
          <li>• <strong>Icon Support</strong> - Left and right positioned icons</li>
          <li>• <strong>Accessibility</strong> - Full keyboard navigation and ARIA support</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing AnimatedButton with tennis commentary. Enable commentary in the toolbar and interact with the buttons!',
      },
    },
  },
};