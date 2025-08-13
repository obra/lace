// ABOUTME: Storybook story for NavigationButton.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import NavigationButton from './NavigationButton';
import { faHome, faUser, faCog, faSearch, faPlus, faBell, faHeart, faBookmark, faFolder, faChart } from '@/lib/fontawesome';

const meta: Meta<typeof NavigationButton> = {
  title: 'Atoms/NavigationButton',
  component: NavigationButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## NavigationButton

**Atomic Classification**: Interactive Atom  
**Source**: Core UI primitive for navigation actions  
**Single Responsibility**: Clickable icon button with navigation-specific styling

### Purpose
A fundamental interactive atom designed specifically for navigation interfaces. Provides consistent icon-based navigation buttons with active states, multiple variants, and accessibility features tailored for navigation contexts.

### When to Use
- Sidebar navigation items
- Toolbar navigation buttons
- Tab navigation interfaces
- Menu navigation actions
- Action buttons in navigation bars
- Modal navigation controls

### Design Tokens Used
- **Colors**: Base-content, primary colors for active states
- **Spacing**: Consistent padding for touch targets
- **Typography**: Icon sizing and positioning
- **Borders**: Subtle borders for toolbar variant
- **Transitions**: Smooth hover and state transitions
- **Opacity**: Disabled state indication

### Features
- **Active States**: Clear visual indication of current selection
- **Multiple Variants**: Sidebar, toolbar, and minimal styling
- **Size Options**: Small, medium, and large sizes
- **Hover Effects**: Interactive feedback on hover
- **Disabled State**: Support for disabled navigation items
- **Accessibility**: Proper ARIA labels and keyboard support

### Variants
- **sidebar**: Optimized for sidebar navigation with subtle styling
- **toolbar**: Bold styling for toolbar navigation with borders
- **minimal**: Clean minimal styling for subtle navigation

### Sizes
- **sm**: Small size (p-1.5, w-4 h-4 icon)
- **md**: Medium size (p-2, w-5 h-5 icon) - default
- **lg**: Large size (p-3, w-6 h-6 icon)

### State Management
- **isActive**: Controls active visual state
- **disabled**: Controls disabled state
- **onClick**: Callback for navigation action

### Accessibility
- Semantic button elements for interaction
- ARIA labels with title attribute
- Keyboard navigation support (Tab, Enter, Space)
- Screen reader friendly with proper labeling
- Focus indicators for keyboard users

### Atom Guidelines
✓ **Do**: Use for navigation-specific actions  
✓ **Do**: Provide clear active state indication  
✓ **Do**: Use appropriate variant for context  
✓ **Do**: Include descriptive titles/labels  
✗ **Don't**: Use for non-navigation actions  
✗ **Don't**: Override active state styling  
✗ **Don't**: Use without proper labeling
        `,
      },
    },
  },
  argTypes: {
    icon: {
      control: { type: 'select' },
      options: ['faHome', 'faUser', 'faCog', 'faSearch', 'faPlus'],
      mapping: {
        faHome,
        faUser,
        faCog,
        faSearch,
        faPlus,
      },
      description: 'FontAwesome icon to display',
    },
    onClick: {
      action: 'clicked',
      description: 'Callback when button is clicked',
    },
    title: {
      control: { type: 'text' },
      description: 'Button title for accessibility',
    },
    isActive: {
      control: { type: 'boolean' },
      description: 'Whether the button is in active state',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the button is disabled',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'Button size',
    },
    variant: {
      control: { type: 'select' },
      options: ['sidebar', 'toolbar', 'minimal'],
      description: 'Button variant style',
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
    icon: faHome,
    onClick: () => {},
    title: 'Home',
    isActive: false,
    disabled: false,
    size: 'md',
    variant: 'sidebar',
  },
};

export const Active: Story = {
  args: {
    icon: faHome,
    onClick: () => {},
    title: 'Home',
    isActive: true,
    size: 'md',
    variant: 'sidebar',
  },
};

export const Disabled: Story = {
  args: {
    icon: faHome,
    onClick: () => {},
    title: 'Home',
    isActive: false,
    disabled: true,
    size: 'md',
    variant: 'sidebar',
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <NavigationButton
        icon={faHome}
        onClick={() => {}}
        title="Small"
        size="sm"
        variant="sidebar"
      />
      <NavigationButton
        icon={faHome}
        onClick={() => {}}
        title="Medium"
        size="md"
        variant="sidebar"
      />
      <NavigationButton
        icon={faHome}
        onClick={() => {}}
        title="Large"
        size="lg"
        variant="sidebar"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different button sizes: small, medium, and large.',
      },
    },
  },
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium w-16">Sidebar:</span>
        <NavigationButton
          icon={faHome}
          onClick={() => {}}
          title="Home"
          variant="sidebar"
        />
        <NavigationButton
          icon={faHome}
          onClick={() => {}}
          title="Home Active"
          variant="sidebar"
          isActive={true}
        />
      </div>
      
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium w-16">Toolbar:</span>
        <NavigationButton
          icon={faHome}
          onClick={() => {}}
          title="Home"
          variant="toolbar"
        />
        <NavigationButton
          icon={faHome}
          onClick={() => {}}
          title="Home Active"
          variant="toolbar"
          isActive={true}
        />
      </div>
      
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium w-16">Minimal:</span>
        <NavigationButton
          icon={faHome}
          onClick={() => {}}
          title="Home"
          variant="minimal"
        />
        <NavigationButton
          icon={faHome}
          onClick={() => {}}
          title="Home Active"
          variant="minimal"
          isActive={true}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different button variants: sidebar, toolbar, and minimal.',
      },
    },
  },
};

export const IconVariations: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <NavigationButton
        icon={faHome}
        onClick={() => {}}
        title="Home"
        variant="sidebar"
      />
      <NavigationButton
        icon={faUser}
        onClick={() => {}}
        title="Profile"
        variant="sidebar"
      />
      <NavigationButton
        icon={faCog}
        onClick={() => {}}
        title="Settings"
        variant="sidebar"
      />
      <NavigationButton
        icon={faSearch}
        onClick={() => {}}
        title="Search"
        variant="sidebar"
      />
      <NavigationButton
        icon={faPlus}
        onClick={() => {}}
        title="Add"
        variant="sidebar"
      />
      <NavigationButton
        icon={faBell}
        onClick={() => {}}
        title="Notifications"
        variant="sidebar"
      />
      <NavigationButton
        icon={faHeart}
        onClick={() => {}}
        title="Favorites"
        variant="sidebar"
      />
      <NavigationButton
        icon={faBookmark}
        onClick={() => {}}
        title="Bookmarks"
        variant="sidebar"
      />
      <NavigationButton
        icon={faFolder}
        onClick={() => {}}
        title="Files"
        variant="sidebar"
      />
      <NavigationButton
        icon={faChart}
        onClick={() => {}}
        title="Analytics"
        variant="sidebar"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different icons commonly used in navigation buttons.',
      },
    },
  },
};

export const Interactive: Story = {
  render: () => {
    const [activeItem, setActiveItem] = useState('home');
    
    const navItems = [
      { id: 'home', icon: faHome, title: 'Home' },
      { id: 'profile', icon: faUser, title: 'Profile' },
      { id: 'settings', icon: faCog, title: 'Settings' },
      { id: 'search', icon: faSearch, title: 'Search' },
    ];
    
    return (
      <div className="flex gap-2">
        {navItems.map(item => (
          <NavigationButton
            key={item.id}
            icon={item.icon}
            onClick={() => setActiveItem(item.id)}
            title={item.title}
            isActive={activeItem === item.id}
            variant="sidebar"
          />
        ))}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive navigation buttons with active state management.',
      },
    },
  },
};

export const SidebarExample: Story = {
  render: () => {
    const [activeItem, setActiveItem] = useState('home');
    
    const navItems = [
      { id: 'home', icon: faHome, title: 'Home' },
      { id: 'profile', icon: faUser, title: 'Profile' },
      { id: 'files', icon: faFolder, title: 'Files' },
      { id: 'settings', icon: faCog, title: 'Settings' },
    ];
    
    return (
      <div className="w-64 bg-base-200 p-4 rounded-lg">
        <h3 className="font-semibold mb-4">Navigation</h3>
        <div className="space-y-2">
          {navItems.map(item => (
            <div key={item.id} className="flex items-center gap-3">
              <NavigationButton
                icon={item.icon}
                onClick={() => setActiveItem(item.id)}
                title={item.title}
                isActive={activeItem === item.id}
                variant="sidebar"
              />
              <span className="text-sm">{item.title}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Navigation buttons in a sidebar context with labels.',
      },
    },
  },
};

export const ToolbarExample: Story = {
  render: () => {
    const [activeItem, setActiveItem] = useState('home');
    
    const navItems = [
      { id: 'home', icon: faHome, title: 'Home' },
      { id: 'search', icon: faSearch, title: 'Search' },
      { id: 'add', icon: faPlus, title: 'Add' },
      { id: 'notifications', icon: faBell, title: 'Notifications' },
      { id: 'profile', icon: faUser, title: 'Profile' },
    ];
    
    return (
      <div className="bg-base-100 border border-base-300 rounded-lg p-2">
        <div className="flex gap-1">
          {navItems.map(item => (
            <NavigationButton
              key={item.id}
              icon={item.icon}
              onClick={() => setActiveItem(item.id)}
              title={item.title}
              isActive={activeItem === item.id}
              variant="toolbar"
            />
          ))}
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Navigation buttons in a toolbar context.',
      },
    },
  },
};

export const StatesShowcase: Story = {
  render: () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-4">All States</h3>
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center space-y-2">
          <h4 className="font-medium text-sm">Normal</h4>
          <NavigationButton
            icon={faHome}
            onClick={() => {}}
            title="Home"
            variant="sidebar"
          />
        </div>
        
        <div className="text-center space-y-2">
          <h4 className="font-medium text-sm">Active</h4>
          <NavigationButton
            icon={faHome}
            onClick={() => {}}
            title="Home"
            isActive={true}
            variant="sidebar"
          />
        </div>
        
        <div className="text-center space-y-2">
          <h4 className="font-medium text-sm">Disabled</h4>
          <NavigationButton
            icon={faHome}
            onClick={() => {}}
            title="Home"
            disabled={true}
            variant="sidebar"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center space-y-2">
          <h4 className="font-medium text-sm">Small</h4>
          <NavigationButton
            icon={faHome}
            onClick={() => {}}
            title="Home"
            size="sm"
            variant="sidebar"
          />
        </div>
        
        <div className="text-center space-y-2">
          <h4 className="font-medium text-sm">Medium</h4>
          <NavigationButton
            icon={faHome}
            onClick={() => {}}
            title="Home"
            size="md"
            variant="sidebar"
          />
        </div>
        
        <div className="text-center space-y-2">
          <h4 className="font-medium text-sm">Large</h4>
          <NavigationButton
            icon={faHome}
            onClick={() => {}}
            title="Home"
            size="lg"
            variant="sidebar"
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all navigation button states and sizes.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 NavigationButton Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the navigation buttons below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Sidebar Navigation</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <NavigationButton
                icon={faHome}
                onClick={() => alert('Home clicked')}
                title="Home"
                isActive={true}
                variant="sidebar"
              />
              <span className="text-sm">Home</span>
            </div>
            <div className="flex items-center gap-3">
              <NavigationButton
                icon={faUser}
                onClick={() => alert('Profile clicked')}
                title="Profile"
                variant="sidebar"
              />
              <span className="text-sm">Profile</span>
            </div>
            <div className="flex items-center gap-3">
              <NavigationButton
                icon={faCog}
                onClick={() => alert('Settings clicked')}
                title="Settings"
                variant="sidebar"
              />
              <span className="text-sm">Settings</span>
            </div>
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Toolbar Navigation</h4>
          <div className="bg-base-100 border border-base-300 rounded-lg p-2">
            <div className="flex gap-1">
              <NavigationButton
                icon={faHome}
                onClick={() => alert('Home clicked')}
                title="Home"
                variant="toolbar"
              />
              <NavigationButton
                icon={faSearch}
                onClick={() => alert('Search clicked')}
                title="Search"
                isActive={true}
                variant="toolbar"
              />
              <NavigationButton
                icon={faPlus}
                onClick={() => alert('Add clicked')}
                title="Add"
                variant="toolbar"
              />
              <NavigationButton
                icon={faBell}
                onClick={() => alert('Notifications clicked')}
                title="Notifications"
                variant="toolbar"
              />
            </div>
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Minimal Navigation</h4>
          <div className="flex gap-4">
            <NavigationButton
              icon={faHome}
              onClick={() => alert('Home clicked')}
              title="Home"
              variant="minimal"
            />
            <NavigationButton
              icon={faUser}
              onClick={() => alert('Profile clicked')}
              title="Profile"
              isActive={true}
              variant="minimal"
            />
            <NavigationButton
              icon={faBookmark}
              onClick={() => alert('Bookmarks clicked')}
              title="Bookmarks"
              variant="minimal"
            />
            <NavigationButton
              icon={faHeart}
              onClick={() => alert('Favorites clicked')}
              title="Favorites"
              variant="minimal"
            />
          </div>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Size Variations</h4>
          <div className="flex items-center gap-4">
            <NavigationButton
              icon={faHome}
              onClick={() => alert('Small clicked')}
              title="Small"
              size="sm"
              variant="sidebar"
            />
            <NavigationButton
              icon={faUser}
              onClick={() => alert('Medium clicked')}
              title="Medium"
              size="md"
              variant="sidebar"
            />
            <NavigationButton
              icon={faCog}
              onClick={() => alert('Large clicked')}
              title="Large"
              size="lg"
              variant="sidebar"
            />
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing navigation buttons with tennis commentary. Enable commentary in the toolbar and interact with the buttons!',
      },
    },
  },
};