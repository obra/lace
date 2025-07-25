// ABOUTME: Storybook stories for SettingsModal component demonstrating usage patterns
// ABOUTME: Shows various configurations and interactive examples for settings modal

import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { SettingsModal } from './SettingsModal';

const meta: Meta<typeof SettingsModal> = {
  title: 'Molecules/SettingsModal',
  component: SettingsModal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## SettingsModal

**Atomic Classification**: Settings Layout Molecule  
**Composed of**: Modal Container + Header + Content Area + Close Button atoms  
**Single Responsibility**: Provide consistent modal structure specifically for settings panels

### Purpose
A specialized modal molecule designed specifically for settings interfaces. Provides consistent header styling, proper content area management, and standardized close functionality for all settings-related dialogs.

### When to Use
- Application settings and preferences
- User profile configuration
- System configuration panels
- Theme and appearance settings
- Advanced options and toggles
- Multi-tab settings interfaces

### Atomic Composition
- **Modal Container**: Fixed positioning with backdrop overlay
- **Header Section**: Consistent title styling with close button
- **Content Area**: Scrollable content container for settings panels
- **Close Button**: Standardized X button with hover states
- **Backdrop**: Click-to-close overlay with blur effect
- **Keyboard Handling**: Escape key support for accessibility

### Design Tokens Used
- **Layout**: Full viewport modal with centered positioning
- **Typography**: Consistent header text styling
- **Colors**: Base colors with proper contrast ratios
- **Spacing**: Standard padding and margins for content
- **Borders**: Subtle borders and rounded corners
- **Shadows**: Elevated shadow for modal depth

### Features
- **Accessibility**: ARIA dialog attributes and keyboard navigation
- **Escape Key**: Keyboard dismissal with escape key handling
- **Backdrop Close**: Optional backdrop click to close
- **Scrollable Content**: Automatic overflow handling for tall content
- **Responsive Design**: Adapts to different screen sizes
- **Focus Management**: Proper focus handling on open/close

### Behavior
- **isOpen**: Controls modal visibility and accessibility
- **onClose**: Callback for all close interactions (backdrop, escape, button)
- **children**: Content area for settings panels and forms

### Accessibility
- **ARIA Attributes**: Proper dialog role and labeling
- **Keyboard Support**: Escape key and focus management
- **Screen Reader**: Proper content structure and navigation
- **Color Contrast**: High contrast text and backgrounds

### Integration
Works seamlessly with:
- SettingsTabs for tabbed interfaces
- SettingsPanel for content sections
- SettingField for form controls
- Theme management systems
        `,
      },
    },
  },
  argTypes: {
    isOpen: {
      control: { type: 'boolean' },
      description: 'Whether the settings modal is open',
    },
    onClose: {
      action: 'closed',
      description: 'Callback when modal is closed',
    },
    children: {
      control: { type: 'text' },
      description: 'Settings content to display',
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
          Open Settings
        </button>
        
        <SettingsModal
          {...args}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        >
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-semibold">General Settings</h3>
            <p>This is a basic settings modal with default styling.</p>
            <p>You can close it by clicking the X button, pressing Escape, or clicking outside the modal.</p>
            
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox" />
                <span>Enable notifications</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox" />
                <span>Auto-save changes</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox" />
                <span>Show advanced options</span>
              </label>
            </div>
          </div>
        </SettingsModal>
      </div>
    );
  },
  args: {},
};

export const WithTabs: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('general');
    
    const tabs = [
      { id: 'general', name: 'General', icon: '⚙️' },
      { id: 'appearance', name: 'Appearance', icon: '🎨' },
      { id: 'privacy', name: 'Privacy', icon: '🔒' },
      { id: 'advanced', name: 'Advanced', icon: '🔧' },
    ];
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          Open Settings with Tabs
        </button>
        
        <SettingsModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        >
          <div className="flex">
            {/* Tab navigation */}
            <div className="w-48 border-r border-base-300 p-4">
              <nav className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-primary text-primary-content'
                        : 'hover:bg-base-200'
                    }`}
                  >
                    <span className="mr-2">{tab.icon}</span>
                    {tab.name}
                  </button>
                ))}
              </nav>
            </div>
            
            {/* Tab content */}
            <div className="flex-1 p-6">
              {activeTab === 'general' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">General Settings</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" defaultChecked />
                      <span>Enable notifications</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" />
                      <span>Auto-save changes</span>
                    </label>
                    <div>
                      <label className="label">
                        <span className="label-text">Default language</span>
                      </label>
                      <select className="select select-bordered w-full max-w-xs">
                        <option>English</option>
                        <option>Spanish</option>
                        <option>French</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'appearance' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Appearance Settings</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="label">
                        <span className="label-text">Theme</span>
                      </label>
                      <div className="flex gap-2">
                        <button className="btn btn-sm btn-outline">Light</button>
                        <button className="btn btn-sm btn-primary">Dark</button>
                        <button className="btn btn-sm btn-outline">Auto</button>
                      </div>
                    </div>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" />
                      <span>Use system theme</span>
                    </label>
                  </div>
                </div>
              )}
              
              {activeTab === 'privacy' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Privacy Settings</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" defaultChecked />
                      <span>Analytics tracking</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" />
                      <span>Share usage data</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" defaultChecked />
                      <span>Error reporting</span>
                    </label>
                  </div>
                </div>
              )}
              
              {activeTab === 'advanced' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Advanced Settings</h3>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" />
                      <span>Developer mode</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" />
                      <span>Debug logging</span>
                    </label>
                    <div>
                      <label className="label">
                        <span className="label-text">Cache size (MB)</span>
                      </label>
                      <input type="number" className="input input-bordered w-full max-w-xs" defaultValue={100} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SettingsModal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Settings modal with tabbed navigation for organizing different setting categories.',
      },
    },
  },
};

export const ScrollableContent: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          Open Scrollable Settings
        </button>
        
        <SettingsModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        >
          <div className="p-6 space-y-6">
            <h3 className="text-lg font-semibold">All Settings</h3>
            
            {/* Generate many sections to demonstrate scrolling */}
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="space-y-3">
                <h4 className="font-medium">Section {i + 1}</h4>
                <div className="space-y-2">
                  {Array.from({ length: 5 }, (_, j) => (
                    <label key={j} className="flex items-center gap-2">
                      <input type="checkbox" className="checkbox" />
                      <span>Setting {i + 1}.{j + 1}: Enable feature option</span>
                    </label>
                  ))}
                </div>
                
                <div>
                  <label className="label">
                    <span className="label-text">Configuration value {i + 1}</span>
                  </label>
                  <input type="text" className="input input-bordered w-full" placeholder="Enter value..." />
                </div>
              </div>
            ))}
          </div>
        </SettingsModal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Settings modal with scrollable content to handle many settings options.',
      },
    },
  },
};

export const ThemeSettings: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedTheme, setSelectedTheme] = useState('dark');
    
    const themes = [
      { id: 'light', name: 'Light', colors: ['#ffffff', '#f3f4f6', '#1f2937'] },
      { id: 'dark', name: 'Dark', colors: ['#1f2937', '#374151', '#ffffff'] },
      { id: 'cupcake', name: 'Cupcake', colors: ['#fef2f2', '#fbcfe8', '#ec4899'] },
      { id: 'bumblebee', name: 'Bumblebee', colors: ['#fef3c7', '#fbbf24', '#1f2937'] },
      { id: 'emerald', name: 'Emerald', colors: ['#ecfdf5', '#10b981', '#1f2937'] },
      { id: 'corporate', name: 'Corporate', colors: ['#f8fafc', '#3b82f6', '#1e293b'] },
      { id: 'synthwave', name: 'Synthwave', colors: ['#2d1b69', '#e879f9', '#facc15'] },
      { id: 'retro', name: 'Retro', colors: ['#f4f4f4', '#ef4444', '#1f2937'] },
      { id: 'cyberpunk', name: 'Cyberpunk', colors: ['#0f0f0f', '#ff007f', '#ffff00'] },
    ];
    
    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary">
          Open Theme Settings
        </button>
        
        <SettingsModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        >
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">Theme Settings</h3>
              <p className="text-sm text-base-content/60">Choose your preferred color theme for the application.</p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setSelectedTheme(theme.id)}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedTheme === theme.id
                      ? 'border-primary bg-primary/10'
                      : 'border-base-300 hover:border-base-400'
                  }`}
                >
                  <div className="flex gap-1 mb-2">
                    {theme.colors.map((color, i) => (
                      <div
                        key={i}
                        className="w-4 h-4 rounded-full border"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div className="text-sm font-medium">{theme.name}</div>
                </button>
              ))}
            </div>
            
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox" />
                <span>Use system theme</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox" defaultChecked />
                <span>Apply theme to all windows</span>
              </label>
            </div>
            
            <div className="flex gap-3 justify-end pt-4 border-t border-base-300">
              <button onClick={() => setIsOpen(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button className="btn btn-primary">
                Apply Theme
              </button>
            </div>
          </div>
        </SettingsModal>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Settings modal specifically designed for theme selection with visual color swatches.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">⚙️ Settings Modal Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Interactive examples of settings modals for different use cases.
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">🎨 Theme Settings</h4>
          <p className="text-sm text-gray-600 mb-3">
            Configure appearance and theme preferences.
          </p>
          <button className="btn btn-primary btn-sm">Open Theme Settings</button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">📱 General Settings</h4>
          <p className="text-sm text-gray-600 mb-3">
            Basic application settings and preferences.
          </p>
          <button className="btn btn-secondary btn-sm">Open General Settings</button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">🔒 Privacy Settings</h4>
          <p className="text-sm text-gray-600 mb-3">
            Data privacy and security options.
          </p>
          <button className="btn btn-accent btn-sm">Open Privacy Settings</button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">🔧 Advanced Settings</h4>
          <p className="text-sm text-gray-600 mb-3">
            Developer and advanced configuration options.
          </p>
          <button className="btn btn-warning btn-sm">Open Advanced Settings</button>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">SettingsModal Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Consistent Layout</strong> - Standardized header and content area</li>
          <li>• <strong>Accessibility</strong> - Full keyboard navigation and ARIA support</li>
          <li>• <strong>Scrollable Content</strong> - Handles long settings lists gracefully</li>
          <li>• <strong>Escape Key</strong> - Quick dismissal with keyboard</li>
          <li>• <strong>Backdrop Close</strong> - Click outside to close</li>
          <li>• <strong>Responsive Design</strong> - Adapts to different screen sizes</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing different settings modal configurations and use cases.',
      },
    },
  },
};