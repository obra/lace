/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for VoiceButton.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import VoiceButton from './VoiceButton';

const meta: Meta<typeof VoiceButton> = {
  title: 'Atoms/VoiceButton',
  component: VoiceButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## VoiceButton

**Atomic Classification**: Input Atom  
**Source**: Extracted from VoiceRecognitionUI component  
**Single Responsibility**: Voice recording toggle with visual state feedback

### Purpose
A fundamental building block that provides voice input controls with consistent styling and interaction patterns. Cannot be broken down further without losing its core functionality.

### When to Use
- Voice recording controls in chat interfaces
- Audio input toggles in forms
- Microphone activation buttons
- Voice search implementations

### Design Tokens Used
- **Colors**: Primary, ghost, outline variants using DaisyUI semantic tokens
- **Spacing**: Consistent padding scale (sm: p-1.5, md: p-2, lg: p-3)
- **Typography**: Icon sizing follows the typography scale
- **Animations**: Pulse animation for active state, scale transform for hover

### Accessibility
- Proper ARIA labels for screen readers ("Start voice input" / "Stop listening")
- Keyboard navigation support
- Visual feedback for active/inactive states
- Sufficient color contrast ratios

### Composition Guidelines
✓ **Do**: Use as building block in molecules like ChatInputComposer  
✓ **Do**: Combine with other atoms for complex voice interfaces  
✓ **Do**: Follow semantic color usage (primary for CTAs)  
✗ **Don't**: Create custom colors outside the token system  
✗ **Don't**: Override atom styles in higher-level components  
✗ **Don't**: Mix with other input atoms in confusing ways
        `,
      },
    },
  },
  argTypes: {
    isListening: {
      control: { type: 'boolean' },
      description: 'Whether the voice input is currently active',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the button is disabled',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'The size of the button',
    },
    variant: {
      control: { type: 'select' },
      options: ['primary', 'ghost', 'outline'],
      description: 'The visual style variant',
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
    isListening: false,
    onToggle: () => {},
  },
};

export const Listening: Story = {
  args: {
    isListening: true,
    onToggle: () => {},
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    isListening: false,
    onToggle: () => {},
  },
};

export const DisabledListening: Story = {
  args: {
    disabled: true,
    isListening: true,
    onToggle: () => {},
  },
};

export const SmallSize: Story = {
  args: {
    size: 'sm',
    isListening: false,
    onToggle: () => {},
  },
};

export const MediumSize: Story = {
  args: {
    size: 'md',
    isListening: false,
    onToggle: () => {},
  },
};

export const LargeSize: Story = {
  args: {
    size: 'lg',
    isListening: false,
    onToggle: () => {},
  },
};

export const PrimaryVariant: Story = {
  args: {
    variant: 'primary',
    isListening: false,
    onToggle: () => {},
  },
};

export const GhostVariant: Story = {
  args: {
    variant: 'ghost',
    isListening: false,
    onToggle: () => {},
  },
};

export const OutlineVariant: Story = {
  args: {
    variant: 'outline',
    isListening: false,
    onToggle: () => {},
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <VoiceButton size="sm" isListening={false} onToggle={() => {}} />
        <p className="text-xs text-gray-500 mt-2">SM</p>
      </div>
      <div className="text-center">
        <VoiceButton size="md" isListening={false} onToggle={() => {}} />
        <p className="text-xs text-gray-500 mt-2">MD</p>
      </div>
      <div className="text-center">
        <VoiceButton size="lg" isListening={false} onToggle={() => {}} />
        <p className="text-xs text-gray-500 mt-2">LG</p>
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

export const AllVariants: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <VoiceButton variant="primary" isListening={false} onToggle={() => {}} />
        <p className="text-xs text-gray-500 mt-2">Primary</p>
      </div>
      <div className="text-center">
        <VoiceButton variant="ghost" isListening={false} onToggle={() => {}} />
        <p className="text-xs text-gray-500 mt-2">Ghost</p>
      </div>
      <div className="text-center">
        <VoiceButton variant="outline" isListening={false} onToggle={() => {}} />
        <p className="text-xs text-gray-500 mt-2">Outline</p>
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

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <VoiceButton isListening={false} onToggle={() => {}} />
        <span className="text-sm">Ready to listen</span>
      </div>

      <div className="flex items-center gap-4">
        <VoiceButton isListening={true} onToggle={() => {}} />
        <span className="text-sm">Currently listening (animated)</span>
      </div>

      <div className="flex items-center gap-4">
        <VoiceButton disabled={true} isListening={false} onToggle={() => {}} />
        <span className="text-sm">Disabled</span>
      </div>

      <div className="flex items-center gap-4">
        <VoiceButton disabled={true} isListening={true} onToggle={() => {}} />
        <span className="text-sm">Disabled while listening</span>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button states displayed together.',
      },
    },
  },
};

export const Interactive: Story = {
  render: () => {
    const [isListening, setIsListening] = useState(false);

    return (
      <div className="flex flex-col items-center gap-4">
        <VoiceButton isListening={isListening} onToggle={() => setIsListening(!isListening)} />
        <p className="text-sm text-gray-600">
          {isListening ? 'Listening... Click to stop' : 'Click to start listening'}
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive voice button that toggles between listening and idle states.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const [states, setStates] = useState({
      primary: false,
      ghost: false,
      outline: false,
    });

    const toggleState = (variant: keyof typeof states) => {
      setStates((prev) => ({
        ...prev,
        [variant]: !prev[variant],
      }));
    };

    return (
      <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">🎾 Voice Button Tennis Commentary Demo</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enable tennis commentary in the toolbar above, then hover and click the voice buttons
            below!
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="text-center p-4 border rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <VoiceButton
                size="lg"
                variant="primary"
                isListening={states.primary}
                onToggle={() => toggleState('primary')}
              />
            </div>
            <p className="text-sm font-medium">Primary</p>
            <p className="text-xs text-gray-500">
              {states.primary ? 'Listening...' : 'Click to listen'}
            </p>
          </div>

          <div className="text-center p-4 border rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <VoiceButton
                size="lg"
                variant="ghost"
                isListening={states.ghost}
                onToggle={() => toggleState('ghost')}
              />
            </div>
            <p className="text-sm font-medium">Ghost</p>
            <p className="text-xs text-gray-500">
              {states.ghost ? 'Listening...' : 'Click to listen'}
            </p>
          </div>

          <div className="text-center p-4 border rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <VoiceButton
                size="lg"
                variant="outline"
                isListening={states.outline}
                onToggle={() => toggleState('outline')}
              />
            </div>
            <p className="text-sm font-medium">Outline</p>
            <p className="text-xs text-gray-500">
              {states.outline ? 'Listening...' : 'Click to listen'}
            </p>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600">
            Notice the pulse animation when listening and hover effects when idle!
          </p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing voice buttons with tennis commentary. Enable commentary in the toolbar and interact with the buttons!',
      },
    },
  },
};
