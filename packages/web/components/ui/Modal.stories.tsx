import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Modal, ConfirmModal } from './Modal';

const meta: Meta<typeof Modal> = {
  title: 'Molecules/Modal',
  component: Modal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## Modal

**Atomic Classification**: Layout Molecule  
**Composed of**: IconButton + Backdrop + Content Container + Focus Management atoms  
**Single Responsibility**: Provide modal dialog functionality with accessibility and interaction management

### Purpose
A sophisticated layout molecule that combines 3-4 atoms to solve the specific UI pattern of modal dialogs. Handles overlay presentation, focus management, escape key handling, and backdrop interactions in a single, reusable component.

### When to Use
- Form dialogs and data entry
- Confirmation prompts and alerts
- Image galleries and media viewers
- Settings and configuration panels
- Help and documentation overlays
- Complex multi-step workflows
- Critical action confirmations

### Atomic Composition
- **IconButton**: Close button with FontAwesome faTimes icon
- **Backdrop**: Semi-transparent overlay with blur effect
- **Content Container**: Rounded modal box with shadow and borders
- **Focus Management**: Automatic focus trapping and restoration
- **Keyboard Handling**: Escape key and tab navigation atoms
- **Animation System**: Enter/exit transition atoms

### Design Tokens Used
- **Layout**: Fixed positioning with full viewport coverage
- **Colors**: Backdrop blur and overlay colors
- **Spacing**: Consistent padding and margins
- **Borders**: Subtle borders and rounded corners
- **Animations**: Smooth enter/exit transitions
- **Z-index**: Proper layering above other content

### Features
- **Accessibility**: ARIA attributes, focus management, keyboard navigation
- **Size Variants**: Multiple size options from small to full-screen
- **Backdrop Interaction**: Configurable backdrop click behavior
- **Escape Key**: Keyboard dismissal with escape key
- **Body Scroll**: Prevents background scrolling when open
- **Focus Trapping**: Keeps focus within modal content
- **Smooth Animations**: Enter/exit animations with CSS transitions

### Size Variants
- **sm**: Small modal (max-w-md) for simple confirmations
- **md**: Medium modal (max-w-lg) for forms and content - default
- **lg**: Large modal (max-w-2xl) for complex content
- **xl**: Extra large modal (max-w-4xl) for rich content
- **full**: Full-screen modal (95vw x 95vh) for immersive experiences

### Behavior Options
- **closeOnBackdropClick**: Whether clicking backdrop closes modal
- **closeOnEscape**: Whether escape key closes modal
- **showCloseButton**: Whether to show X button in header

### Composition Guidelines
✓ **Do**: Use in organisms and templates for focused interactions  
✓ **Do**: Combine atoms logically for modal functionality  
✓ **Do**: Maintain single responsibility for dialog presentation  
✓ **Do**: Handle all accessibility requirements atomically  
✗ **Don't**: Mix unrelated functionality  
✗ **Don't**: Override individual atom behaviors  
✗ **Don't**: Create nested modal dependencies

### Specialized Molecule Variants
- **ConfirmModal**: Pre-configured confirmation dialog molecule
- **AlertModal**: Pre-configured alert dialog molecule
- **FormModal**: Pre-configured form dialog molecule

### Accessibility
- **ARIA Attributes**: Proper modal, dialog, and labelledby attributes
- **Focus Management**: Automatic focus and focus trapping
- **Keyboard Support**: Escape key and tab navigation
- **Screen Reader**: Proper content structure and labeling
- **Color Contrast**: High contrast backdrop and content

### State Management
- **isOpen**: Controls modal visibility and focus management
- **size**: Determines modal dimensions and responsive behavior
- **title**: Header text for accessibility and labeling
- **showCloseButton**: Controls close button atom visibility
- **closeOnBackdropClick**: Configures backdrop interaction atom
- **closeOnEscape**: Configures keyboard handling atom
        `,
      },
    },
  },
  argTypes: {
    isOpen: {
      control: { type: 'boolean' },
      description: 'Whether the modal is open',
    },
    onClose: {
      action: 'closed',
      description: 'Callback when modal is closed',
    },
    title: {
      control: { type: 'text' },
      description: 'Modal title text',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg', 'xl', 'full'],
      description: 'Modal size variant',
    },
    showCloseButton: {
      control: { type: 'boolean' },
      description: 'Whether to show close button',
    },
    closeOnBackdropClick: {
      control: { type: 'boolean' },
      description: 'Whether clicking backdrop closes modal',
    },
    closeOnEscape: {
      control: { type: 'boolean' },
      description: 'Whether escape key closes modal',
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
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          Open Modal
        </button>
        
        <Modal
          {...args}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        >
          <div className="space-y-4">
            <p>This is a basic modal with default settings.</p>
            <p>You can close it by clicking the X button, pressing Escape, or clicking outside the modal.</p>
          </div>
        </Modal>
      </div>
    );
  },
  args: {
    title: 'Default Modal',
    size: 'md',
    showCloseButton: true,
    closeOnBackdropClick: true,
    closeOnEscape: true,
  },
};

export const Sizes: Story = {
  render: () => {
    const [openModal, setOpenModal] = useState<string | null>(null);
    
    const sizes = [
      { id: 'sm', name: 'Small', description: 'Perfect for simple confirmations' },
      { id: 'md', name: 'Medium', description: 'Default size for most content' },
      { id: 'lg', name: 'Large', description: 'For complex forms and content' },
      { id: 'xl', name: 'Extra Large', description: 'For rich content and data' },
      { id: 'full', name: 'Full Screen', description: 'For immersive experiences' },
    ];
    
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {sizes.map((size) => (
            <button
              key={size.id}
              onClick={() => setOpenModal(size.id)}
              className="btn btn-outline btn-primary"
            >
              {size.name}
            </button>
          ))}
        </div>
        
        {sizes.map((size) => (
          <Modal
            key={size.id}
            isOpen={openModal === size.id}
            onClose={() => setOpenModal(null)}
            title={`${size.name} Modal`}
            size={size.id as "sm" | "md" | "lg" | "xl" | "full"}
          >
            <div className="space-y-4">
              <p><strong>Size:</strong> {size.name}</p>
              <p><strong>Description:</strong> {size.description}</p>
              <p>This modal demonstrates the {size.name.toLowerCase()} size variant. The content automatically adjusts to fit the modal&apos;s constraints while maintaining proper spacing and readability.</p>
              
              {size.id === 'full' && (
                <div className="bg-base-200 p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Full Screen Features:</h4>
                  <ul className="text-sm space-y-1">
                    <li>• Maximum viewport utilization</li>
                    <li>• Perfect for complex interfaces</li>
                    <li>• Immersive user experience</li>
                    <li>• Ideal for media galleries</li>
                  </ul>
                </div>
              )}
            </div>
          </Modal>
        ))}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Different modal sizes for various use cases.',
      },
    },
  },
};

export const WithForm: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      message: '',
    });
    
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      console.log('Form submitted:', formData);
      setIsOpen(false);
      setFormData({ name: '', email: '', message: '' });
    };
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          Contact Us
        </button>
        
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Contact Us"
          size="md"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input input-bordered w-full"
                required
              />
            </div>
            
            <div>
              <label className="label">
                <span className="label-text">Email</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="input input-bordered w-full"
                required
              />
            </div>
            
            <div>
              <label className="label">
                <span className="label-text">Message</span>
              </label>
              <textarea
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="textarea textarea-bordered w-full"
                rows={4}
                required
              />
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Send Message
              </button>
            </div>
          </form>
        </Modal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal with form content and proper form handling.',
      },
    },
  },
};

export const ConfirmationDialog: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [result, setResult] = useState<string>('');
    
    const handleConfirm = () => {
      setResult('Action confirmed!');
      setTimeout(() => setResult(''), 3000);
    };
    
    return (
      <div className="space-y-4">
        {result && (
          <div className="bg-success/20 text-success p-3 rounded-lg text-sm">
            {result}
          </div>
        )}
        
        <button onClick={() => setIsOpen(true)} className="btn btn-error">
          Delete Item
        </button>
        
        <ConfirmModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onConfirm={handleConfirm}
          title="Confirm Deletion"
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
        story: 'Pre-configured confirmation modal with different variants.',
      },
    },
  },
};

export const BehaviorOptions: Story = {
  render: () => {
    const [openModal, setOpenModal] = useState<string | null>(null);
    
    const behaviors = [
      {
        id: 'no-backdrop',
        name: 'No Backdrop Close',
        props: { closeOnBackdropClick: false },
        description: 'Clicking the backdrop will not close the modal',
      },
      {
        id: 'no-escape',
        name: 'No Escape Close',
        props: { closeOnEscape: false },
        description: 'Escape key will not close the modal',
      },
      {
        id: 'no-close-button',
        name: 'No Close Button',
        props: { showCloseButton: false },
        description: 'No X button in the header',
      },
      {
        id: 'restricted',
        name: 'Fully Restricted',
        props: { closeOnBackdropClick: false, closeOnEscape: false, showCloseButton: false },
        description: 'Can only be closed by the cancel button',
      },
    ];
    
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {behaviors.map((behavior) => (
            <button
              key={behavior.id}
              onClick={() => setOpenModal(behavior.id)}
              className="btn btn-outline btn-primary"
            >
              {behavior.name}
            </button>
          ))}
        </div>
        
        {behaviors.map((behavior) => (
          <Modal
            key={behavior.id}
            isOpen={openModal === behavior.id}
            onClose={() => setOpenModal(null)}
            title={behavior.name}
            size="md"
            {...behavior.props}
          >
            <div className="space-y-4">
              <p><strong>Behavior:</strong> {behavior.description}</p>
              <p>This modal demonstrates different closing behaviors. Try using the escape key, clicking outside, or looking for the close button.</p>
              
              <div className="flex justify-end">
                <button
                  onClick={() => setOpenModal(null)}
                  className="btn btn-primary"
                >
                  Close Modal
                </button>
              </div>
            </div>
          </Modal>
        ))}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Different modal behaviors for closing interactions.',
      },
    },
  },
};

export const NoHeader: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          Open Headerless Modal
        </button>
        
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          showCloseButton={false}
          size="md"
        >
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Custom Header</h3>
            <p>This modal has no default header, allowing for custom header styling and layout.</p>
            
            <div className="flex justify-between items-center">
              <span className="text-sm text-base-content/60">Custom footer content</span>
              <button onClick={() => setIsOpen(false)} className="btn btn-sm btn-primary">
                Close
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal without default header for custom layouts.',
      },
    },
  },
};

export const MultipleModals: Story = {
  render: () => {
    const [firstModal, setFirstModal] = useState(false);
    const [secondModal, setSecondModal] = useState(false);
    
    return (
      <div className="space-y-4">
        <div className="bg-warning/20 text-warning p-3 rounded-lg text-sm">
          <strong>Note:</strong> While technically possible, nesting modals is not recommended for UX reasons.
        </div>
        
        <button onClick={() => setFirstModal(true)} className="btn btn-primary">
          Open First Modal
        </button>
        
        <Modal
          isOpen={firstModal}
          onClose={() => setFirstModal(false)}
          title="First Modal"
          size="md"
        >
          <div className="space-y-4">
            <p>This is the first modal. You can open a second modal from here, but it&apos;s not recommended.</p>
            <button onClick={() => setSecondModal(true)} className="btn btn-secondary">
              Open Second Modal (Not Recommended)
            </button>
          </div>
        </Modal>
        
        <Modal
          isOpen={secondModal}
          onClose={() => setSecondModal(false)}
          title="Second Modal"
          size="sm"
        >
          <div className="space-y-4">
            <p>This is a second modal. Multiple modals can create confusion and accessibility issues.</p>
            <button onClick={() => setSecondModal(false)} className="btn btn-primary">
              Close This Modal
            </button>
          </div>
        </Modal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Example of multiple modals and why they should be avoided.',
      },
    },
  },
};

export const RichContent: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          View Rich Content
        </button>
        
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Rich Content Modal"
          size="lg"
        >
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-base-200 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Features</h4>
                <ul className="text-sm space-y-1">
                  <li>• Rich text content</li>
                  <li>• Image galleries</li>
                  <li>• Data tables</li>
                  <li>• Interactive elements</li>
                </ul>
              </div>
              
              <div className="bg-base-200 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Benefits</h4>
                <ul className="text-sm space-y-1">
                  <li>• Focused user attention</li>
                  <li>• Accessible interactions</li>
                  <li>• Responsive design</li>
                  <li>• Keyboard navigation</li>
                </ul>
              </div>
            </div>
            
            <div className="bg-gradient-to-r from-primary/20 to-secondary/20 p-4 rounded-lg">
              <h4 className="font-medium mb-2">Interactive Example</h4>
              <p className="text-sm mb-3">This modal can contain any content, including interactive elements:</p>
              <div className="flex gap-2">
                <button className="btn btn-xs btn-primary">Action 1</button>
                <button className="btn btn-xs btn-secondary">Action 2</button>
                <button className="btn btn-xs btn-accent">Action 3</button>
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-base-content/60">
                This modal demonstrates how rich content can be effectively displayed while maintaining accessibility and user experience.
              </p>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal with rich content including grids, cards, and interactive elements.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Modal Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and interact with the modal triggers below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Confirmation Modal</h4>
          <p className="text-sm text-gray-600 mb-3">
            Standard confirmation dialog with action buttons.
          </p>
          <ConfirmModal
            isOpen={false}
            onClose={() => {}}
            onConfirm={() => alert('Confirmed!')}
            title="Delete Item"
            message="Are you sure you want to delete this item?"
            variant="danger"
          />
          <button className="btn btn-error btn-sm">Delete Item</button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Form Modal</h4>
          <p className="text-sm text-gray-600 mb-3">
            Modal with form inputs and validation.
          </p>
          <button className="btn btn-primary btn-sm">Open Form</button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Large Content Modal</h4>
          <p className="text-sm text-gray-600 mb-3">
            Modal with rich content and multiple sections.
          </p>
          <button className="btn btn-secondary btn-sm">View Content</button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Settings Modal</h4>
          <p className="text-sm text-gray-600 mb-3">
            Configuration modal with various options.
          </p>
          <button className="btn btn-accent btn-sm">Open Settings</button>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Modal Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Accessibility</strong> - Full keyboard navigation and screen reader support</li>
          <li>• <strong>Focus Management</strong> - Automatic focus trapping and restoration</li>
          <li>• <strong>Backdrop Control</strong> - Configurable backdrop click behavior</li>
          <li>• <strong>Size Variants</strong> - Multiple size options for different content types</li>
          <li>• <strong>Escape Key</strong> - Keyboard dismissal with escape key</li>
          <li>• <strong>Smooth Animations</strong> - Enter/exit animations for better UX</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing Modal with tennis commentary. Enable commentary in the toolbar and interact with the modal triggers!',
      },
    },
  },
};