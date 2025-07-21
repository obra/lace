import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import SectionHeader from './SectionHeader';

const meta: Meta<typeof SectionHeader> = {
  title: 'Atoms/SectionHeader',
  component: SectionHeader,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## SectionHeader

**Atomic Classification**: Interactive Atom  
**Source**: Core UI primitive for collapsible section headers  
**Single Responsibility**: Toggle header with state indication and optional badge/actions

### Purpose
A fundamental interactive atom that provides section headers with expand/collapse functionality. Features clear visual state feedback through chevron icons and supports optional badges and right-aligned content for enhanced functionality.

### When to Use
- Collapsible content sections
- Navigation groups with toggle states
- Sidebar section headers
- Accordion-style interfaces
- Settings panels with categories
- File tree structures

### Design Tokens Used
- **Colors**: Base-content for text, base-200 for hover states
- **Spacing**: Consistent padding (p-3) and gaps (gap-2)
- **Typography**: Font-medium for titles, badge styling
- **Icons**: Heroicons chevron-down and chevron-right
- **Transitions**: Smooth color transitions on hover
- **Badges**: DaisyUI badge variants with semantic colors

### Features
- **State Indication**: Clear chevron direction for expanded/collapsed
- **Badge Support**: Optional badge with variant styling
- **Right Content**: Optional right-aligned content slot
- **Hover Effects**: Interactive feedback on hover
- **Disabled State**: Support for disabled sections
- **Accessibility**: Proper button semantics and keyboard support

### State Management
- **isExpanded**: Controls chevron direction and visual state
- **onToggle**: Callback for state changes
- **badge**: Optional badge with text and variant
- **rightContent**: Optional right-aligned content
- **disabled**: Optional disabled state

### Badge Variants
- **primary**: Default brand color
- **secondary**: Secondary theme color
- **accent**: Accent theme color
- **success**: Success state (green)
- **warning**: Warning state (yellow)
- **error**: Error state (red)
- **info**: Info state (blue)
- **teal**: Custom teal color

### Accessibility
- Semantic button elements for interaction
- Proper ARIA states for expanded/collapsed
- Keyboard navigation support (Tab, Enter, Space)
- Screen reader friendly content
- Disabled state properly communicated

### Atom Guidelines
✓ **Do**: Use for consistent expandable sections  
✓ **Do**: Provide clear toggle feedback  
✓ **Do**: Follow chevron direction conventions  
✓ **Do**: Use appropriate badge variants  
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
      control: { type: 'object' },
      description: 'Optional badge with text and variant',
    },
    rightContent: {
      control: { type: 'text' },
      description: 'Optional right-aligned content',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the header is disabled',
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
    badge: {
      text: '5',
      variant: 'primary',
    },
    onToggle: () => {},
  },
};

export const WithBadgeVariants: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <SectionHeader
        title="Primary Badge"
        isExpanded={false}
        badge={{ text: '5', variant: 'primary' }}
        onToggle={() => {}}
      />
      <SectionHeader
        title="Success Badge"
        isExpanded={false}
        badge={{ text: 'Active', variant: 'success' }}
        onToggle={() => {}}
      />
      <SectionHeader
        title="Warning Badge"
        isExpanded={false}
        badge={{ text: '!', variant: 'warning' }}
        onToggle={() => {}}
      />
      <SectionHeader
        title="Error Badge"
        isExpanded={false}
        badge={{ text: '2', variant: 'error' }}
        onToggle={() => {}}
      />
      <SectionHeader
        title="Info Badge"
        isExpanded={false}
        badge={{ text: 'New', variant: 'info' }}
        onToggle={() => {}}
      />
      <SectionHeader
        title="Teal Badge"
        isExpanded={false}
        badge={{ text: '∞', variant: 'teal' }}
        onToggle={() => {}}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Examples of different badge variants with semantic colors.',
      },
    },
  },
};

export const WithRightContent: Story = {
  args: {
    title: 'Project Files',
    isExpanded: true,
    badge: {
      text: '12',
      variant: 'primary',
    },
    rightContent: (
      <div className="flex gap-1">
        <button className="btn btn-xs btn-ghost">+</button>
        <button className="btn btn-xs btn-ghost">⚙</button>
      </div>
    ),
    onToggle: () => {},
    asButton: false, // Use div instead of button to prevent nested button issues
  },
};

export const Disabled: Story = {
  args: {
    title: 'Disabled Section',
    isExpanded: false,
    badge: {
      text: '0',
      variant: 'secondary',
    },
    disabled: true,
    onToggle: () => {},
  },
};

export const LongTitle: Story = {
  args: {
    title: 'A Very Long Section Title That Might Wrap to Multiple Lines in Narrow Containers',
    isExpanded: false,
    badge: {
      text: '999+',
      variant: 'primary',
    },
    onToggle: () => {},
  },
};

export const Interactive: Story = {
  render: () => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [count, setCount] = useState(5);
    
    return (
      <div className="w-80">
        <SectionHeader
          title="Interactive Section"
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
          badge={{
            text: count,
            variant: isExpanded ? 'success' : 'primary',
          }}
          rightContent={
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => setCount(count + 1)}
            >
              +
            </button>
          }
          asButton={false}
        />
        
        {isExpanded && (
          <div className="p-4 bg-base-100 border-l-2 border-primary">
            <p className="text-sm">This content is revealed when the header is expanded.</p>
            <p className="text-sm text-gray-600 mt-2">Count: {count}</p>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive example showing expand/collapse functionality with dynamic content.',
      },
    },
  },
};

export const NavigationExample: Story = {
  render: () => {
    const [sections, setSections] = useState({
      files: true,
      recent: false,
      favorites: false,
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
        <SectionHeader
          title="Files"
          isExpanded={sections.files}
          onToggle={() => toggleSection('files')}
          badge={{ text: '24', variant: 'primary' }}
          rightContent={
            <button className="btn btn-xs btn-ghost">+</button>
          }
          asButton={false}
        />
        
        <SectionHeader
          title="Recent"
          isExpanded={sections.recent}
          onToggle={() => toggleSection('recent')}
          badge={{ text: '8', variant: 'info' }}
        />
        
        <SectionHeader
          title="Favorites"
          isExpanded={sections.favorites}
          onToggle={() => toggleSection('favorites')}
          badge={{ text: '3', variant: 'warning' }}
        />
        
        <SectionHeader
          title="Settings"
          isExpanded={sections.settings}
          onToggle={() => toggleSection('settings')}
          rightContent={
            <button className="btn btn-xs btn-ghost">⚙</button>
          }
          asButton={false}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Example showing multiple section headers in a navigation context.',
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
        <SectionHeader
          title="Collapsed"
          isExpanded={false}
          onToggle={() => {}}
        />
        
        <SectionHeader
          title="Expanded"
          isExpanded={true}
          onToggle={() => {}}
        />
        
        <SectionHeader
          title="With Badge"
          isExpanded={false}
          badge={{ text: '5', variant: 'primary' }}
          onToggle={() => {}}
        />
        
        <SectionHeader
          title="With Right Content"
          isExpanded={true}
          rightContent={<span className="text-xs text-gray-500">Last modified</span>}
          onToggle={() => {}}
        />
        
        <SectionHeader
          title="Disabled"
          isExpanded={false}
          badge={{ text: '0', variant: 'secondary' }}
          disabled={true}
          onToggle={() => {}}
        />
        
        <SectionHeader
          title="Full Featured"
          isExpanded={true}
          badge={{ text: '99+', variant: 'success' }}
          rightContent={
            <div className="flex gap-1">
              <button className="btn btn-xs btn-ghost">+</button>
              <button className="btn btn-xs btn-ghost">⚙</button>
            </div>
          }
          onToggle={() => {}}
          asButton={false}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all section header states and variations.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 SectionHeader Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the section headers below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">Project Navigation</h4>
          </div>
          <SectionHeader
            title="Source Files"
            isExpanded={true}
            badge={{ text: '24', variant: 'primary' }}
            onToggle={() => alert('Source files toggled')}
            rightContent={
              <button 
                className="btn btn-xs btn-ghost"
                onClick={() => alert('Add file clicked')}
              >
                +
              </button>
            }
            asButton={false}
          />
        </div>
        
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">Task Management</h4>
          </div>
          <SectionHeader
            title="Active Tasks"
            isExpanded={false}
            badge={{ text: '7', variant: 'warning' }}
            onToggle={() => alert('Tasks toggled')}
            rightContent={
              <button 
                className="btn btn-xs btn-ghost"
                onClick={() => alert('View all tasks')}
              >
                👁
              </button>
            }
            asButton={false}
          />
        </div>
        
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">File Explorer</h4>
          </div>
          <SectionHeader
            title="Documents"
            isExpanded={false}
            badge={{ text: '156', variant: 'info' }}
            onToggle={() => alert('Documents toggled')}
            rightContent={
              <div className="flex gap-1">
                <button 
                  className="btn btn-xs btn-ghost"
                  onClick={() => alert('New document')}
                >
                  +
                </button>
                <button 
                  className="btn btn-xs btn-ghost"
                  onClick={() => alert('View options')}
                >
                  ⚙
                </button>
              </div>
            }
            asButton={false}
          />
        </div>
        
        <div className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
          <div className="p-2 bg-base-200">
            <h4 className="font-medium text-sm">Settings Panel</h4>
          </div>
          <SectionHeader
            title="Configuration"
            isExpanded={true}
            badge={{ text: 'Active', variant: 'success' }}
            onToggle={() => alert('Configuration toggled')}
            rightContent={
              <button 
                className="btn btn-xs btn-ghost"
                onClick={() => alert('Advanced settings')}
              >
                ⚙
              </button>
            }
            asButton={false}
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing section headers with tennis commentary. Enable commentary in the toolbar and interact with the headers!',
      },
    },
  },
};