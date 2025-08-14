/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook stories for UISettingsPanel demonstrating theme selector integration
// ABOUTME: Shows different usage patterns for UI-specific settings panels

import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { UISettingsPanel } from './UISettingsPanel';
import { Modal } from '@/components/ui/Modal';

const meta: Meta<typeof UISettingsPanel> = {
  title: 'Organisms/UISettingsPanel',
  component: UISettingsPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## UISettingsPanel

**Atomic Classification**: Settings Panel Organism  
**Composed of**: SettingsPanel + SettingField + ThemeSelector molecules  
**Single Responsibility**: Provide UI-specific settings including theme selection

### Purpose
A specialized settings panel organism designed for UI and appearance preferences. Integrates the ThemeSelector component within the consistent SettingsPanel structure to provide theme selection and other visual customization options.

### When to Use
- Application theme and appearance settings
- UI customization preferences
- Visual configuration options
- Display settings and preferences
- Color scheme management
- Interface personalization

### Atomic Composition
- **SettingsPanel**: Container with title and description
- **SettingField**: Consistent field wrapper for layout
- **ThemeSelector**: Interactive theme selection component
- **Theme Integration**: Seamless theme switching functionality

### Design Tokens Used
- **Layout**: Consistent spacing and field structure
- **Typography**: Standard heading and label styling
- **Colors**: Theme-aware color tokens
- **Spacing**: Proper field and content spacing
- **Borders**: Subtle separation between elements

### Features
- **Theme Selection**: Interactive theme picker with previews
- **Real-time Updates**: Immediate theme application
- **Persistent Storage**: Theme preferences saved to localStorage
- **Visual Feedback**: Clear indication of selected theme
- **Accessibility**: Full keyboard navigation support
- **Multiple Themes**: Support for all DaisyUI themes

### Behavior
- **currentTheme**: Controls which theme is currently selected
- **onThemeChange**: Callback when user selects a new theme
- **Theme Persistence**: Automatic localStorage integration when no callback provided
- **Visual Updates**: Immediate visual feedback on theme changes

### Accessibility
- **Keyboard Navigation**: Full keyboard support for theme selection
- **Screen Reader**: Proper labeling and descriptions
- **Color Contrast**: High contrast in all theme variations
- **Focus Management**: Clear focus indicators

### Integration
Works seamlessly with:
- SettingsModal for modal dialogs
- SettingsTabs for tabbed interfaces
- Other settings panels for comprehensive settings
- Theme management systems
        `,
      },
    },
  },
  argTypes: {
    currentTheme: {
      control: { type: 'select' },
      options: [
        'light',
        'dark',
        'cupcake',
        'corporate',
        'synthwave',
        'cyberpunk',
        'business',
        'emerald',
        'lofi',
      ],
      description: 'Currently selected theme',
    },
    onThemeChange: {
      action: 'themeChanged',
      description: 'Callback when theme is changed',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [theme, setTheme] = useState(args.currentTheme || 'dark');

    return (
      <div className="w-96 p-6 border border-base-300 rounded-lg bg-base-100">
        <UISettingsPanel
          {...args}
          currentTheme={theme}
          onThemeChange={(newTheme) => {
            setTheme(newTheme);
            args.onThemeChange?.(newTheme);
          }}
        />
      </div>
    );
  },
  args: {
    currentTheme: 'dark',
  },
};

export const LightTheme: Story = {
  render: (args) => {
    const [theme, setTheme] = useState('light');

    return (
      <div className="w-96 p-6 border border-base-300 rounded-lg bg-base-100">
        <UISettingsPanel
          {...args}
          currentTheme={theme}
          onThemeChange={(newTheme) => {
            setTheme(newTheme);
            args.onThemeChange?.(newTheme);
          }}
        />
      </div>
    );
  },
  args: {
    currentTheme: 'light',
  },
  parameters: {
    docs: {
      description: {
        story: 'UI settings panel with light theme selected by default.',
      },
    },
  },
};

export const ColorfulThemes: Story = {
  render: (args) => {
    const [theme, setTheme] = useState('synthwave');

    return (
      <div className="w-96 p-6 border border-base-300 rounded-lg bg-base-100">
        <UISettingsPanel
          {...args}
          currentTheme={theme}
          onThemeChange={(newTheme) => {
            setTheme(newTheme);
            args.onThemeChange?.(newTheme);
          }}
        />
      </div>
    );
  },
  args: {
    currentTheme: 'synthwave',
  },
  parameters: {
    docs: {
      description: {
        story: 'UI settings panel showcasing colorful theme selection.',
      },
    },
  },
};

export const InModal: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    const [theme, setTheme] = useState(args.currentTheme || 'dark');

    return (
      <div>
        <button onClick={() => setIsOpen(true)} className="btn btn-primary vapor-button ring-hover">
          Open UI Settings
        </button>

        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="UI Settings">
          <UISettingsPanel
            {...args}
            currentTheme={theme}
            onThemeChange={(newTheme) => {
              setTheme(newTheme);
              args.onThemeChange?.(newTheme);
            }}
          />
        </Modal>
      </div>
    );
  },
  args: {
    currentTheme: 'dark',
  },
  parameters: {
    docs: {
      description: {
        story: 'UI settings panel integrated within a settings modal for complete user experience.',
      },
    },
  },
};

export const Interactive: Story = {
  render: () => {
    const [theme, setTheme] = useState('dark');
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [autoSave, setAutoSave] = useState(false);

    return (
      <div className="max-w-2xl space-y-6 p-6">
        <div className="border border-base-300 rounded-lg p-6 bg-base-100">
          <UISettingsPanel currentTheme={theme} onThemeChange={setTheme} />
        </div>

        <div className="border border-base-300 rounded-lg p-6 bg-base-100">
          <h3 className="text-lg font-semibold text-base-content mb-4">Additional Settings</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
              />
              <span>Enable notifications</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox"
                checked={autoSave}
                onChange={(e) => setAutoSave(e.target.checked)}
              />
              <span>Auto-save preferences</span>
            </label>
          </div>
        </div>

        <div className="bg-info/10 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Current Settings:</h4>
          <ul className="text-sm space-y-1">
            <li>
              • <strong>Theme:</strong> {theme}
            </li>
            <li>
              • <strong>Notifications:</strong> {notificationsEnabled ? 'Enabled' : 'Disabled'}
            </li>
            <li>
              • <strong>Auto-save:</strong> {autoSave ? 'Enabled' : 'Disabled'}
            </li>
          </ul>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showing the UI settings panel in action with live theme switching and additional settings.',
      },
    },
  },
};

export const AllThemes: Story = {
  render: () => {
    const themes = [
      { name: 'light', label: 'Light' },
      { name: 'dark', label: 'Dark' },
      { name: 'cupcake', label: 'Cupcake' },
      { name: 'corporate', label: 'Corporate' },
      { name: 'synthwave', label: 'Synthwave' },
      { name: 'cyberpunk', label: 'Cyberpunk' },
      { name: 'business', label: 'Business' },
      { name: 'emerald', label: 'Emerald' },
      { name: 'lofi', label: 'Lo-Fi' },
    ];

    return (
      <div className="max-w-4xl space-y-6">
        <div className="text-center mb-6">
          <h3 className="text-lg font-semibold mb-2">All Available Themes</h3>
          <p className="text-sm text-base-content/60">
            Preview of the UI settings panel with different theme selections.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {themes.map((themeOption) => (
            <div
              key={themeOption.name}
              className="border border-base-300 rounded-lg p-4 bg-base-100"
            >
              <h4 className="font-medium mb-3 text-center">{themeOption.label} Theme</h4>
              <UISettingsPanel
                currentTheme={themeOption.name}
                onThemeChange={() => {}} // No-op for demo
              />
            </div>
          ))}
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all available themes with the UI settings panel.',
      },
    },
  },
};
