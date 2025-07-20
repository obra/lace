import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import ExpandableHeader from './ExpandableHeader';
import IconButton from './IconButton';
import { faPlus, faCog, faEye } from '~/lib/fontawesome';

const meta: Meta<typeof ExpandableHeader> = {
  title: 'Atoms/ExpandableHeader',
  component: ExpandableHeader,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## ExpandableHeader

**Atomic Classification**: Interactive Atom  
**Source**: Core UI primitive for expandable sections  
**Single Responsibility**: Toggle header with chevron state and optional actions

### Purpose
A fundamental interactive atom that provides expandable section headers with clear visual state feedback. Uses chevron icons to indicate expanded/collapsed states with consistent styling and optional badge/action support.

### When to Use
- Collapsible sections and panels
- Sidebar navigation groups
- Accordion-style interfaces
- Settings and configuration panels
- File explorer tree structures

### Design Tokens Used
- **Colors**: Base-content for text, base-200 for hover states
- **Spacing**: Consistent padding (p-3) and gaps (gap-2)
- **Typography**: Font-medium for titles, proper text hierarchy
- **Icons**: Heroicons chevron-down and chevron-right
- **Transitions**: Smooth color transitions on hover

### Features
- **State Indication**: Clear chevron direction for expanded/collapsed
- **Badge Support**: Optional badge for counts or labels
- **Action Buttons**: Optional action buttons with event isolation
- **Hover Effects**: Interactive feedback on hover
- **Accessibility**: Proper button semantics and keyboard support

### State Management
- **isExpanded**: Controls chevron direction and visual state
- **onToggle**: Callback for state changes
- **badge**: Optional badge content
- **actions**: Optional action button group

### Accessibility
- Semantic button elements for interaction
- Proper ARIA states for expanded/collapsed
- Keyboard navigation support (Tab, Enter, Space)
- Screen reader friendly content
- Event isolation for nested actions

### Atom Guidelines
✓ **Do**: Use for consistent expandable sections  
✓ **Do**: Provide clear toggle feedback  
✓ **Do**: Follow chevron direction conventions  
✓ **Do**: Isolate action button events  
✗ **Don't**: Use for non-expandable content  
✗ **Don't**: Override chevron icon meanings  
✗ **Don't**: Create confusing interaction patterns
        `,
      },
    },
  },
  argTypes: {
    title: {
      control: { type: 'text' },
      description: 'The header title text',
    },
    isExpanded: {
      control: { type: 'boolean' },
      description: 'Whether the section is expanded',
    },
    onToggle: {
      action: 'toggled',
      description: 'Callback when header is clicked',
    },
    badge: {
      control: { type: 'text' },
      description: 'Optional badge content',
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
    title: 'Section Title',
    isExpanded: false,
    onToggle: () => {},
  },
};

export const Expanded: Story = {
  args: {
    title: 'Expanded Section',
    isExpanded: true,
    onToggle: () => {},
  },
};

export const WithBadge: Story = {
  args: {
    title: 'Files',
    isExpanded: false,
    badge: '5',
    onToggle: () => {},
  },
};

export const WithActions: Story = {
  args: {
    title: 'Project Files',
    isExpanded: true,
    badge: '12',
    onToggle: () => {},
  },
  render: (args) => (
    <ExpandableHeader
      {...args}
      actions={
        <div className="flex gap-1">
          <IconButton
            icon={faPlus}
            size="xs"
            variant="ghost"
            tooltip="Add file"
            onClick={() => alert('Add file clicked')}
          />
          <IconButton
            icon={faCog}
            size="xs"
            variant="ghost"
            tooltip="Settings"
            onClick={() => alert('Settings clicked')}
          />
        </div>
      }
    />
  ),
};

export const LongTitle: Story = {
  args: {
    title: 'A Very Long Section Title That Might Wrap to Multiple Lines',
    isExpanded: false,
    badge: '999+',
    onToggle: () => {},
  },
};

export const Interactive: Story = {
  render: () => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    return (
      <div className="w-80">
        <ExpandableHeader
          title="Interactive Section"
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
          badge={isExpanded ? 'Open' : 'Closed'}
          actions={
            <IconButton
              icon={faEye}
              size="xs"
              variant="ghost"
              tooltip="View details"
              onClick={() => alert('View details clicked')}
            />
          }
        />
        
        {isExpanded && (
          <div className="p-4 bg-base-100 border-l-2 border-primary">
            <p className="text-sm">This content is revealed when the header is expanded.</p>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive example showing expand/collapse functionality with content reveal.',
      },
    },
  },
};

export const NavigationExample: Story = {
  render: () => {
    const [sections, setSections] = useState({
      projects: false,
      files: true,
      settings: false,
    });
    
    const toggleSection = (section: keyof typeof sections) => {
      setSections(prev => ({
        ...prev,
        [section]: !prev[section],
      }));
    };
    
    return (
      <div className="w-80 border border-base-300 rounded-lg overflow-hidden">
        <ExpandableHeader
          title="Projects"
          isExpanded={sections.projects}
          onToggle={() => toggleSection('projects')}
          badge="3"
          actions={
            <IconButton
              icon={faPlus}
              size="xs"
              variant="ghost"
              tooltip="New project"
              onClick={() => alert('New project')}
            />
          }
        />
        
        <ExpandableHeader
          title="Recent Files"
          isExpanded={sections.files}
          onToggle={() => toggleSection('files')}
          badge="8"
          actions={
            <IconButton
              icon={faEye}
              size="xs"
              variant="ghost"
              tooltip="View all"
              onClick={() => alert('View all files')}
            />
          }
        />
        
        <ExpandableHeader
          title="Settings"
          isExpanded={sections.settings}
          onToggle={() => toggleSection('settings')}
          actions={
            <IconButton
              icon={faCog}
              size="xs"
              variant="ghost"
              tooltip="Configure"
              onClick={() => alert('Configure settings')}
            />
          }
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Example showing multiple expandable headers in a navigation context.',
      },
    },
  },
};

export const StatesShowcase: Story = {
  render: () => (
    <div className="w-80 space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-4">All States</h3>
      </div>
      
      <div className="border border-base-300 rounded-lg overflow-hidden">
        <ExpandableHeader
          title="Collapsed Section"
          isExpanded={false}
          onToggle={() => {}}
        />
        
        <ExpandableHeader
          title="Expanded Section"
          isExpanded={true}
          onToggle={() => {}}
        />
        
        <ExpandableHeader
          title="With Badge"
          isExpanded={false}
          badge="5"
          onToggle={() => {}}
        />
        
        <ExpandableHeader
          title="With Actions"
          isExpanded={true}
          badge="12"
          onToggle={() => {}}
          actions={
            <div className="flex gap-1">
              <IconButton
                icon={faPlus}
                size="xs"
                variant="ghost"
                tooltip="Add"
                onClick={() => {}}
              />
              <IconButton
                icon={faCog}
                size="xs"
                variant="ghost"
                tooltip="Settings"
                onClick={() => {}}
              />
            </div>
          }
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all expandable header states and variations.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 ExpandableHeader Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the headers below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">Project Navigation</h4>
          </div>
          <ExpandableHeader
            title="Source Files"
            isExpanded={true}
            badge="24"
            onToggle={() => alert('Source files toggled')}
            actions={
              <IconButton
                icon={faPlus}
                size="xs"
                variant="ghost"
                tooltip="Add file"
                onClick={() => alert('Add file clicked')}
              />
            }
          />
        </div>
        
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">Task Management</h4>
          </div>
          <ExpandableHeader
            title="Active Tasks"
            isExpanded={false}
            badge="7"
            onToggle={() => alert('Tasks toggled')}
            actions={
              <IconButton
                icon={faEye}
                size="xs"
                variant="ghost"
                tooltip="View all"
                onClick={() => alert('View all tasks')}
              />
            }
          />
        </div>
        
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">Settings Panel</h4>
          </div>
          <ExpandableHeader
            title="Configuration"
            isExpanded={true}
            onToggle={() => alert('Configuration toggled')}
            actions={
              <IconButton
                icon={faCog}
                size="xs"
                variant="ghost"
                tooltip="Advanced settings"
                onClick={() => alert('Advanced settings')}
              />
            }
          />
        </div>
        
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">File Explorer</h4>
          </div>
          <ExpandableHeader
            title="Documents"
            isExpanded={false}
            badge="156"
            onToggle={() => alert('Documents toggled')}
            actions={
              <div className="flex gap-1">
                <IconButton
                  icon={faPlus}
                  size="xs"
                  variant="ghost"
                  tooltip="New document"
                  onClick={() => alert('New document')}
                />
                <IconButton
                  icon={faEye}
                  size="xs"
                  variant="ghost"
                  tooltip="View options"
                  onClick={() => alert('View options')}
                />
              </div>
            }
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing expandable headers with tennis commentary. Enable commentary in the toolbar and interact with the headers!',
      },
    },
  },
};