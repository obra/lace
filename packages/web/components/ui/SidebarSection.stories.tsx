// ABOUTME: Storybook story for SidebarSection.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import SidebarSection from './SidebarSection';

const meta: Meta<typeof SidebarSection> = {
  title: 'Molecules/SidebarSection',
  component: SidebarSection,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
## SidebarSection

**Molecular Classification**: Layout Molecule  
**Source**: Collapsible sidebar section with header and content  
**Single Responsibility**: Provide structured collapsible content areas for sidebar navigation

### Purpose
A specialized layout molecule that combines SectionHeader atom with collapsible content areas to create organized sidebar sections. Perfect for navigation menus, file trees, settings panels, and other hierarchical content organization.

### When to Use
- Navigation menu sections
- File and folder organization
- Settings category groupings
- Help and documentation sections
- Tool panels with grouped features
- Dashboard widget sections
- Filter and option panels

### Design Tokens Used
- **Spacing**: Consistent padding (p-4) for section container
- **Layout**: Proper spacing between header and content (mt-2)
- **Typography**: Inherits from SectionHeader atom
- **Colors**: Badge variants and semantic colors
- **Animations**: Smooth expand/collapse transitions
- **Hierarchy**: Clear visual hierarchy with nested content

### Features
- **Collapsible Content**: Smooth expand/collapse functionality
- **Badge Support**: Optional badges with semantic color variants
- **Right Content**: Optional right-aligned content or actions
- **Disabled State**: Support for disabled sections
- **Custom Styling**: Flexible className overrides
- **Content Styling**: Separate content area customization

### Integration Points
- **SectionHeader**: Uses SectionHeader atom for consistent header styling
- **Badge System**: Integrates with badge component for status indicators
- **Icon System**: Supports custom right content including icons
- **Navigation**: Perfect for building navigation hierarchies
- **State Management**: Works with parent state for expand/collapse

### Content Structure
- **Header**: SectionHeader with title, badge, and actions
- **Content**: Collapsible content area with custom styling
- **Spacing**: Consistent spacing between items (space-y-1)
- **Padding**: Proper padding for touch-friendly interactions

### State Management
- **isExpanded**: Controls section visibility
- **onToggle**: Callback for expand/collapse actions
- **badge**: Optional badge configuration
- **rightContent**: Optional right-aligned content
- **disabled**: Optional disabled state

### Accessibility
- **Keyboard Navigation**: Full keyboard support through SectionHeader
- **Screen Reader Support**: Proper ARIA attributes and structure
- **Focus Management**: Clear focus indicators
- **Semantic Structure**: Proper heading and content hierarchy
- **Interactive Elements**: Accessible button interactions

### Molecule Guidelines
✓ **Do**: Use for organizing hierarchical content  
✓ **Do**: Provide clear section titles and organization  
✓ **Do**: Use badges for status and counts  
✓ **Do**: Maintain consistent spacing and styling  
✗ **Don't**: Use for non-hierarchical content  
✗ **Don't**: Nest sections too deeply  
✗ **Don't**: Override header functionality unnecessarily
        `,
      },
    },
  },
  argTypes: {
    title: {
      control: { type: 'text' },
      description: 'Section title text',
    },
    isExpanded: {
      control: { type: 'boolean' },
      description: 'Whether the section is expanded',
    },
    onToggle: {
      action: 'toggled',
      description: 'Callback when section is toggled',
    },
    badge: {
      control: { type: 'object' },
      description: 'Optional badge configuration',
    },
    rightContent: {
      control: false,
      description: 'Optional right-aligned content',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the section is disabled',
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes for container',
    },
    contentClassName: {
      control: { type: 'text' },
      description: 'Additional CSS classes for content area',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Files',
    isExpanded: true,
    onToggle: () => {},
    children: (
      <div className="space-y-1">
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 document.txt</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 readme.md</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 config.json</div>
      </div>
    ),
  },
};

export const WithBadge: Story = {
  args: {
    title: 'Recent Files',
    isExpanded: true,
    badge: {
      text: '5',
      variant: 'primary',
    },
    onToggle: () => {},
    children: (
      <div className="space-y-1">
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 report.pdf</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 notes.txt</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 data.csv</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 image.png</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 archive.zip</div>
      </div>
    ),
  },
};

export const WithRightContent: Story = {
  args: {
    title: 'Projects',
    isExpanded: true,
    badge: {
      text: '3',
      variant: 'info',
    },
    rightContent: (
      <div className="flex gap-1">
        <button className="btn btn-xs btn-ghost">+</button>
        <button className="btn btn-xs btn-ghost">⚙</button>
      </div>
    ),
    onToggle: () => {},
    children: (
      <div className="space-y-1">
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🚀 Project Alpha</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔧 Project Beta</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📊 Project Gamma</div>
      </div>
    ),
  },
};

export const Collapsed: Story = {
  args: {
    title: 'Archived Items',
    isExpanded: false,
    badge: {
      text: '12',
      variant: 'secondary',
    },
    onToggle: () => {},
    children: (
      <div className="space-y-1">
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📦 Old Project 1</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📦 Old Project 2</div>
        <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📦 Legacy Files</div>
      </div>
    ),
  },
};

export const Disabled: Story = {
  args: {
    title: 'Locked Section',
    isExpanded: false,
    disabled: true,
    badge: {
      text: '0',
      variant: 'secondary',
    },
    onToggle: () => {},
    children: (
      <div className="space-y-1">
        <div className="p-2 text-gray-400">🔒 Protected content</div>
      </div>
    ),
  },
};

export const BadgeVariants: Story = {
  render: () => {
    const [sections, setSections] = useState({
      active: true,
      warning: false,
      error: false,
      success: false,
      info: false,
    });

    const toggleSection = (section: keyof typeof sections) => {
      setSections(prev => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    return (
      <div className="w-80 bg-base-200 rounded-lg">
        <SidebarSection
          title="Active Items"
          isExpanded={sections.active}
          onToggle={() => toggleSection('active')}
          badge={{ text: '8', variant: 'primary' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">✅ Task 1</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">✅ Task 2</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">✅ Task 3</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Warning Items"
          isExpanded={sections.warning}
          onToggle={() => toggleSection('warning')}
          badge={{ text: '3', variant: 'warning' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">⚠️ Review needed</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">⚠️ Update required</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">⚠️ Missing info</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Error Items"
          isExpanded={sections.error}
          onToggle={() => toggleSection('error')}
          badge={{ text: '1', variant: 'error' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">❌ Failed task</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Completed Items"
          isExpanded={sections.success}
          onToggle={() => toggleSection('success')}
          badge={{ text: '15', variant: 'success' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">✅ Completed A</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">✅ Completed B</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">✅ Completed C</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Info Items"
          isExpanded={sections.info}
          onToggle={() => toggleSection('info')}
          badge={{ text: 'New', variant: 'info' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">ℹ️ Documentation</div>
            <div className="p-2 hover:bg-base-300 rounded cursor-pointer">ℹ️ Help guide</div>
          </div>
        </SidebarSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'All badge variants with semantic colors in a sidebar context.',
      },
    },
  },
};

export const NavigationExample: Story = {
  render: () => {
    const [sections, setSections] = useState({
      dashboard: true,
      projects: false,
      tasks: false,
      settings: false,
    });

    const toggleSection = (section: keyof typeof sections) => {
      setSections(prev => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    return (
      <div className="w-80 bg-base-100 border border-base-300 rounded-lg overflow-hidden">
        <div className="p-4 bg-base-200 border-b border-base-300">
          <h3 className="font-semibold text-base-content">Navigation</h3>
        </div>

        <SidebarSection
          title="Dashboard"
          isExpanded={sections.dashboard}
          onToggle={() => toggleSection('dashboard')}
          badge={{ text: '2', variant: 'primary' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📊 Analytics</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📈 Reports</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Projects"
          isExpanded={sections.projects}
          onToggle={() => toggleSection('projects')}
          badge={{ text: '5', variant: 'info' }}
          rightContent={
            <button className="btn btn-xs btn-ghost">+</button>
          }
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🚀 Web App</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📱 Mobile App</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔧 API Service</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📦 Package</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🎨 Design System</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Tasks"
          isExpanded={sections.tasks}
          onToggle={() => toggleSection('tasks')}
          badge={{ text: '12', variant: 'warning' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📋 To Do</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔄 In Progress</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">✅ Complete</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Settings"
          isExpanded={sections.settings}
          onToggle={() => toggleSection('settings')}
          rightContent={
            <button className="btn btn-xs btn-ghost">⚙</button>
          }
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">👤 Profile</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔒 Security</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🎨 Theme</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔔 Notifications</div>
          </div>
        </SidebarSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Complete navigation sidebar with multiple sections.',
      },
    },
  },
};

export const FileTreeExample: Story = {
  render: () => {
    const [sections, setSections] = useState({
      src: true,
      components: false,
      utils: false,
      assets: false,
    });

    const toggleSection = (section: keyof typeof sections) => {
      setSections(prev => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    return (
      <div className="w-80 bg-base-100 border border-base-300 rounded-lg overflow-hidden">
        <div className="p-4 bg-base-200 border-b border-base-300">
          <h3 className="font-semibold text-base-content">File Explorer</h3>
        </div>

        <SidebarSection
          title="src"
          isExpanded={sections.src}
          onToggle={() => toggleSection('src')}
          badge={{ text: '8', variant: 'primary' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 index.ts</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 app.tsx</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📄 types.ts</div>
            
            <SidebarSection
              title="components"
              isExpanded={sections.components}
              onToggle={() => toggleSection('components')}
              badge={{ text: '12', variant: 'info' }}
              className="ml-4 p-2"
            >
              <div className="space-y-1">
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🧩 Button.tsx</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🧩 Modal.tsx</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🧩 Input.tsx</div>
              </div>
            </SidebarSection>

            <SidebarSection
              title="utils"
              isExpanded={sections.utils}
              onToggle={() => toggleSection('utils')}
              badge={{ text: '4', variant: 'secondary' }}
              className="ml-4 p-2"
            >
              <div className="space-y-1">
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔧 helpers.ts</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔧 constants.ts</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔧 api.ts</div>
              </div>
            </SidebarSection>
          </div>
        </SidebarSection>

        <SidebarSection
          title="assets"
          isExpanded={sections.assets}
          onToggle={() => toggleSection('assets')}
          badge={{ text: '6', variant: 'accent' }}
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🖼️ logo.svg</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🖼️ icon.png</div>
            <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🎨 styles.css</div>
          </div>
        </SidebarSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File tree structure with nested sidebar sections.',
      },
    },
  },
};

export const CustomStyling: Story = {
  render: () => {
    const [sections, setSections] = useState({
      styled: true,
      custom: false,
    });

    const toggleSection = (section: keyof typeof sections) => {
      setSections(prev => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    return (
      <div className="w-80 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-lg overflow-hidden">
        <SidebarSection
          title="Styled Section"
          isExpanded={sections.styled}
          onToggle={() => toggleSection('styled')}
          badge={{ text: 'Custom', variant: 'teal' }}
          className="bg-gradient-to-r from-primary/10 to-secondary/10"
          contentClassName="bg-white/50 rounded-lg p-2"
        >
          <div className="space-y-1">
            <div className="p-2 bg-white/80 rounded cursor-pointer hover:bg-white">Custom item 1</div>
            <div className="p-2 bg-white/80 rounded cursor-pointer hover:bg-white">Custom item 2</div>
            <div className="p-2 bg-white/80 rounded cursor-pointer hover:bg-white">Custom item 3</div>
          </div>
        </SidebarSection>

        <SidebarSection
          title="Custom Styling"
          isExpanded={sections.custom}
          onToggle={() => toggleSection('custom')}
          badge={{ text: '∞', variant: 'accent' }}
          className="bg-gradient-to-r from-accent/10 to-info/10"
          contentClassName="border-l-4 border-accent pl-4"
        >
          <div className="space-y-1">
            <div className="p-2 hover:bg-accent/20 rounded cursor-pointer">Enhanced item A</div>
            <div className="p-2 hover:bg-accent/20 rounded cursor-pointer">Enhanced item B</div>
            <div className="p-2 hover:bg-accent/20 rounded cursor-pointer">Enhanced item C</div>
          </div>
        </SidebarSection>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom styling examples with gradients and custom content styling.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 SidebarSection Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and interact with the sidebar sections below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Navigation Sidebar</h4>
          <div className="w-full bg-base-100 border border-base-300 rounded-lg overflow-hidden">
            <SidebarSection
              title="Dashboard"
              isExpanded={true}
              onToggle={() => alert('Dashboard toggled')}
              badge={{ text: '3', variant: 'primary' }}
            >
              <div className="space-y-1">
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📊 Analytics</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📈 Reports</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🎯 Goals</div>
              </div>
            </SidebarSection>
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">File Explorer</h4>
          <div className="w-full bg-base-100 border border-base-300 rounded-lg overflow-hidden">
            <SidebarSection
              title="Projects"
              isExpanded={false}
              onToggle={() => alert('Projects toggled')}
              badge={{ text: '8', variant: 'info' }}
              rightContent={
                <button 
                  className="btn btn-xs btn-ghost"
                  onClick={() => alert('Add project clicked')}
                >
                  +
                </button>
              }
            >
              <div className="space-y-1">
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🚀 Web App</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📱 Mobile App</div>
              </div>
            </SidebarSection>
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Task Management</h4>
          <div className="w-full bg-base-100 border border-base-300 rounded-lg overflow-hidden">
            <SidebarSection
              title="Active Tasks"
              isExpanded={true}
              onToggle={() => alert('Tasks toggled')}
              badge={{ text: '5', variant: 'warning' }}
            >
              <div className="space-y-1">
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">📋 Review code</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔄 Update docs</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">✅ Test feature</div>
              </div>
            </SidebarSection>
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Settings Panel</h4>
          <div className="w-full bg-base-100 border border-base-300 rounded-lg overflow-hidden">
            <SidebarSection
              title="Configuration"
              isExpanded={false}
              onToggle={() => alert('Settings toggled')}
              rightContent={
                <button 
                  className="btn btn-xs btn-ghost"
                  onClick={() => alert('Settings opened')}
                >
                  ⚙
                </button>
              }
            >
              <div className="space-y-1">
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">👤 Profile</div>
                <div className="p-2 hover:bg-base-200 rounded cursor-pointer">🔒 Security</div>
              </div>
            </SidebarSection>
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">SidebarSection Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Collapsible Content</strong> - Smooth expand/collapse with state management</li>
          <li>• <strong>Badge Support</strong> - Status indicators with semantic colors</li>
          <li>• <strong>Right Content</strong> - Action buttons and additional controls</li>
          <li>• <strong>Custom Styling</strong> - Flexible styling for different contexts</li>
          <li>• <strong>Nested Sections</strong> - Support for hierarchical organization</li>
          <li>• <strong>Accessibility</strong> - Full keyboard navigation and screen reader support</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing SidebarSection with tennis commentary. Enable commentary in the toolbar and interact with the sections!',
      },
    },
  },
};