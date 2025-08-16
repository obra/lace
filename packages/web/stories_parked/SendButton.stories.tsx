/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for SendButton.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import SendButton from './SendButton';

const meta: Meta<typeof SendButton> = {
  title: 'Atoms/SendButton',
  component: SendButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## SendButton

**Atomic Classification**: Input Atom  
**Source**: Extracted from ChatInput component  
**Single Responsibility**: Submit/stop action with loading states

### Purpose
A fundamental building block that handles form submission and streaming interruption with consistent visual feedback. The smallest functional unit for send/stop actions.

### When to Use
- Chat message submission
- Form submission buttons
- Streaming interruption controls
- Any submit/cancel pattern

### Design Tokens Used
- **Colors**: Teal-600 for send state, red-600 for stop state
- **Spacing**: Responsive padding scale (sm: p-1.5, md: p-2, lg: p-3)
- **Typography**: Icon sizing follows system scale (sm: w-3 h-3, md: w-4 h-4, lg: w-5 h-5)
- **Shadows**: Subtle elevation with rounded-xl borders

### Accessibility
- Dynamic ARIA labels based on state
- Keyboard navigation support (Enter/Space)
- Visual feedback for disabled states
- Proper button semantics (type="submit" vs type="button")
- Descriptive titles for context

### State Management
- **hasContent**: Controls availability for sending
- **isStreaming**: Switches between send/stop modes
- **disabled**: Prevents all interactions
- **size**: Responsive sizing for different contexts

### Composition Guidelines
✓ **Do**: Use in molecules like ChatInputComposer  
✓ **Do**: Combine with other form atoms  
✓ **Do**: Follow semantic color usage (teal for actions, red for stop)  
✗ **Don't**: Create custom colors outside the token system  
✗ **Don't**: Override atom styles in higher-level components  
✗ **Don't**: Use for non-submission actions
        `,
      },
    },
  },
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the button is disabled',
    },
    isStreaming: {
      control: { type: 'boolean' },
      description: 'Whether the system is streaming (changes to stop button)',
    },
    hasContent: {
      control: { type: 'boolean' },
      description: 'Whether there is content to send',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'The size of the button',
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
    hasContent: true,
    onSubmit: () => {},
  },
};

export const WithoutContent: Story = {
  args: {
    hasContent: false,
    onSubmit: () => {},
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    hasContent: true,
    onSubmit: () => {},
  },
};

export const Streaming: Story = {
  args: {
    isStreaming: true,
    hasContent: true,
    onStop: () => {},
  },
};

export const StreamingDisabled: Story = {
  args: {
    isStreaming: true,
    disabled: true,
    hasContent: true,
    onStop: () => {},
  },
};

export const SmallSize: Story = {
  args: {
    size: 'sm',
    hasContent: true,
    onSubmit: () => {},
  },
};

export const MediumSize: Story = {
  args: {
    size: 'md',
    hasContent: true,
    onSubmit: () => console.log('Medium button clicked!'),
  },
};

export const LargeSize: Story = {
  args: {
    size: 'lg',
    hasContent: true,
    onSubmit: () => console.log('Large button clicked!'),
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="text-center">
        <SendButton size="sm" hasContent={true} onSubmit={() => console.log('Small send')} />
        <p className="text-xs text-gray-500 mt-2">SM</p>
      </div>
      <div className="text-center">
        <SendButton size="md" hasContent={true} onSubmit={() => console.log('Medium send')} />
        <p className="text-xs text-gray-500 mt-2">MD</p>
      </div>
      <div className="text-center">
        <SendButton size="lg" hasContent={true} onSubmit={() => console.log('Large send')} />
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

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <SendButton hasContent={true} onSubmit={() => console.log('Ready to send')} />
        <span className="text-sm">Ready to send</span>
      </div>

      <div className="flex items-center gap-4">
        <SendButton hasContent={false} onSubmit={() => console.log('No content')} />
        <span className="text-sm">No content (disabled)</span>
      </div>

      <div className="flex items-center gap-4">
        <SendButton
          isStreaming={true}
          hasContent={true}
          onStop={() => console.log('Stop streaming')}
        />
        <span className="text-sm">Streaming (stop button)</span>
      </div>

      <div className="flex items-center gap-4">
        <SendButton disabled={true} hasContent={true} onSubmit={() => console.log('Disabled')} />
        <span className="text-sm">Disabled</span>
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

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Send Button Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the send buttons
          below!
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="text-center p-4 border rounded-lg">
          <div className="flex items-center justify-center mb-2">
            <SendButton size="lg" hasContent={true} onSubmit={() => console.log('Send message!')} />
          </div>
          <p className="text-sm font-medium">Send Message</p>
          <p className="text-xs text-gray-500">Click to send</p>
        </div>

        <div className="text-center p-4 border rounded-lg">
          <div className="flex items-center justify-center mb-2">
            <SendButton
              size="lg"
              isStreaming={true}
              hasContent={true}
              onStop={() => console.log('Stop streaming!')}
            />
          </div>
          <p className="text-sm font-medium">Stop Streaming</p>
          <p className="text-xs text-gray-500">Click to stop</p>
        </div>

        <div className="text-center p-4 border rounded-lg">
          <div className="flex items-center justify-center mb-2">
            <SendButton size="lg" hasContent={false} onSubmit={() => console.log('No content')} />
          </div>
          <p className="text-sm font-medium">No Content</p>
          <p className="text-xs text-gray-500">Disabled state</p>
        </div>

        <div className="text-center p-4 border rounded-lg">
          <div className="flex items-center justify-center mb-2">
            <SendButton
              size="lg"
              disabled={true}
              hasContent={true}
              onSubmit={() => console.log('Disabled')}
            />
          </div>
          <p className="text-sm font-medium">Disabled</p>
          <p className="text-xs text-gray-500">Cannot click</p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing send buttons with tennis commentary. Enable commentary in the toolbar and interact with the buttons!',
      },
    },
  },
};
