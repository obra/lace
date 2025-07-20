import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { AnimatedModal, AnimatedConfirmModal } from './AnimatedModal';

const meta: Meta<typeof AnimatedModal> = {
  title: 'Molecules/AnimatedModal',
  component: AnimatedModal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## AnimatedModal

**Atomic Classification**: Overlay Molecule  
**Composed of**: IconButton + Backdrop + Container + MessageText + StatusDot atoms  
**Single Responsibility**: Animated modal dialog interface with backdrop, content, and interaction controls

### Purpose
A cohesive molecule that combines 4-5 atoms to solve the specific UI pattern of modal dialogs. Handles overlay display, backdrop interaction, content presentation, and animated transitions in a single, accessible component.

### When to Use
- Dialog boxes and confirmations
- Form overlays and wizards
- Image galleries and previews
- Settings panels and preferences
- Alert messages and notifications

### Atomic Composition
- **IconButton**: Close button with proper sizing and hover states
- **Backdrop**: Semi-transparent overlay with blur effects
- **Container**: Modal content area with proper sizing and positioning
- **MessageText**: Title and content text with proper typography
- **StatusDot**: Visual indicators for modal states and types
- **Animation**: Framer Motion components for smooth transitions

### Design Tokens Used
- **Colors**: Base colors for content, backdrop transparency effects
- **Animations**: Framer Motion variants for enter/exit transitions
- **Spacing**: Consistent padding (p-6) and content spacing
- **Typography**: Font-semibold for titles, regular for content
- **Shadows**: Box shadows for depth and elevation
- **Borders**: Subtle borders for content separation

### Modal States
- **closed**: Modal hidden, not rendered in DOM
- **opening**: Modal appearing with entrance animation
- **open**: Modal fully visible and interactive
- **closing**: Modal disappearing with exit animation

### State Management
- **isOpen**: Controls modal visibility and animation state
- **size**: Modal size variants (sm, md, lg, xl, full)
- **showCloseButton**: Toggle for close button visibility
- **closeOnBackdropClick**: Enable/disable backdrop click to close
- **closeOnEscape**: Enable/disable escape key to close

### Accessibility
- Proper ARIA attributes (role="dialog", aria-modal="true")
- Focus management with automatic focus on open
- Keyboard navigation support (Tab, Escape)
- Screen reader friendly content structure
- Body scroll prevention when modal is open

### Composition Guidelines
✓ **Do**: Use in overlay organisms and dialog templates  
✓ **Do**: Combine atoms logically for modal interactions  
✓ **Do**: Maintain single responsibility for modal display  
✓ **Do**: Provide clear visual feedback for all states  
✗ **Don't**: Mix unrelated modal functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create complex nested modal structures
        `,
      },
    },
  },
  argTypes: {
    isOpen: {
      control: { type: 'boolean' },
      description: 'Whether the modal is open',
    },
    title: {
      control: { type: 'text' },
      description: 'Modal title',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg', 'xl', 'full'],
      description: 'Modal size',
    },
    showCloseButton: {
      control: { type: 'boolean' },
      description: 'Whether to show the close button',
    },
    closeOnBackdropClick: {
      control: { type: 'boolean' },
      description: 'Whether clicking the backdrop closes the modal',
    },
    closeOnEscape: {
      control: { type: 'boolean' },
      description: 'Whether pressing escape closes the modal',
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

// Interactive wrapper component
const AnimatedModalDemo = ({ initialOpen = false, ...props }: any) => {
  const [isOpen, setIsOpen] = useState(initialOpen);

  const handleOpen = () => setIsOpen(true);
  const handleClose = () => setIsOpen(false);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center">
        <button
          onClick={handleOpen}
          className="btn btn-primary"
        >
          Open Modal
        </button>
      </div>
      
      <AnimatedModal
        isOpen={isOpen}
        onClose={handleClose}
        title="Example Modal"
        {...props}
      >
        <div className="space-y-4">
          <p className="text-base-content/80">
            This is an animated modal with smooth entrance and exit transitions. 
            It supports various sizes and interaction options.
          </p>
          
          <div className="space-y-2">
            <div className="text-sm font-medium text-base-content/60">Features:</div>
            <ul className="text-sm text-base-content/80 space-y-1 list-disc list-inside">
              <li>Smooth animations with Framer Motion</li>
              <li>Keyboard navigation support</li>
              <li>Focus management and accessibility</li>
              <li>Backdrop click to close</li>
              <li>Escape key to close</li>
              <li>Multiple size options</li>
            </ul>
          </div>
          
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleClose}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleClose}
              className="btn btn-primary btn-sm"
            >
              Save
            </button>
          </div>
        </div>
      </AnimatedModal>
    </div>
  );
};

export const Default: Story = {
  render: () => <AnimatedModalDemo />,
};

export const Small: Story = {
  render: () => <AnimatedModalDemo size="sm" />,
};

export const Large: Story = {
  render: () => <AnimatedModalDemo size="lg" />,
};

export const ExtraLarge: Story = {
  render: () => <AnimatedModalDemo size="xl" />,
};

export const FullSize: Story = {
  render: () => <AnimatedModalDemo size="full" />,
};

export const NoCloseButton: Story = {
  render: () => <AnimatedModalDemo showCloseButton={false} />,
};

export const NoBackdropClose: Story = {
  render: () => <AnimatedModalDemo closeOnBackdropClick={false} />,
};

export const NoEscapeClose: Story = {
  render: () => <AnimatedModalDemo closeOnEscape={false} />,
};

export const ConfirmModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [result, setResult] = useState('');

    const handleOpen = () => {
      setIsOpen(true);
      setResult('');
    };

    const handleClose = () => setIsOpen(false);

    const handleConfirm = () => {
      setResult('Confirmed!');
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <button
            onClick={handleOpen}
            className="btn btn-error"
          >
            Delete Item
          </button>
          
          {result && (
            <div className="text-sm text-success bg-success/10 rounded-lg p-2">
              {result}
            </div>
          )}
        </div>
        
        <AnimatedConfirmModal
          isOpen={isOpen}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title="Delete Item"
          message="Are you sure you want to delete this item? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Specialized confirm modal for dangerous actions with proper styling.',
      },
    },
  },
};

export const WarningModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [result, setResult] = useState('');

    const handleOpen = () => {
      setIsOpen(true);
      setResult('');
    };

    const handleClose = () => setIsOpen(false);

    const handleConfirm = () => {
      setResult('Proceeding with caution!');
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <button
            onClick={handleOpen}
            className="btn btn-warning"
          >
            Proceed with Warning
          </button>
          
          {result && (
            <div className="text-sm text-success bg-success/10 rounded-lg p-2">
              {result}
            </div>
          )}
        </div>
        
        <AnimatedConfirmModal
          isOpen={isOpen}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title="Warning"
          message="This action may have unintended consequences. Are you sure you want to proceed?"
          confirmText="Proceed"
          cancelText="Cancel"
          variant="warning"
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Warning modal variant for actions that need user attention.',
      },
    },
  },
};

export const InfoModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [result, setResult] = useState('');

    const handleOpen = () => {
      setIsOpen(true);
      setResult('');
    };

    const handleClose = () => setIsOpen(false);

    const handleConfirm = () => {
      setResult('Information acknowledged!');
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <button
            onClick={handleOpen}
            className="btn btn-info"
          >
            Show Info
          </button>
          
          {result && (
            <div className="text-sm text-success bg-success/10 rounded-lg p-2">
              {result}
            </div>
          )}
        </div>
        
        <AnimatedConfirmModal
          isOpen={isOpen}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title="Information"
          message="This is some important information that you should be aware of. Please read it carefully."
          confirmText="Got it"
          cancelText="Cancel"
          variant="info"
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Info modal variant for informational messages.',
      },
    },
  },
};

export const FormModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({ name: '', email: '' });

    const handleOpen = () => {
      setIsOpen(true);
      setFormData({ name: '', email: '' });
    };

    const handleClose = () => setIsOpen(false);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      alert(`Form submitted: ${JSON.stringify(formData)}`);
      handleClose();
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <button
            onClick={handleOpen}
            className="btn btn-primary"
          >
            Open Form
          </button>
        </div>
        
        <AnimatedModal
          isOpen={isOpen}
          onClose={handleClose}
          title="User Information"
          size="md"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-base-content/60 mb-1">
                Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-base-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-base-content/60 mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-base-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                required
              />
            </div>
            
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
              >
                Submit
              </button>
            </div>
          </form>
        </AnimatedModal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal containing a form with validation and submission handling.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Animated Modal Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then open and interact with the modals!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer">
          <AnimatedModalDemo />
        </div>
        
        <div className="cursor-pointer">
          {FormModal.render ? FormModal.render() : <div>Form Modal</div>}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="cursor-pointer">
          {ConfirmModal.render ? ConfirmModal.render() : <div>Confirm Modal</div>}
        </div>
        
        <div className="cursor-pointer">
          {WarningModal.render ? WarningModal.render() : <div>Warning Modal</div>}
        </div>
        
        <div className="cursor-pointer">
          {InfoModal.render ? InfoModal.render() : <div>Info Modal</div>}
        </div>
      </div>
      
      <div className="text-sm text-gray-600 space-y-1">
        <p>• <strong>Click buttons</strong> to open different modal types</p>
        <p>• <strong>Try keyboard navigation</strong> with Tab and Escape</p>
        <p>• <strong>Click backdrop</strong> to close modals</p>
        <p>• <strong>Hover elements</strong> for tennis commentary feedback!</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing animated modals with tennis commentary. Enable commentary in the toolbar and interact with the modals!',
      },
    },
  },
};