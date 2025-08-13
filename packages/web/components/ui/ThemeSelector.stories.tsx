// ABOUTME: Storybook story for ThemeSelector.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ThemeSelector } from './ThemeSelector';

const meta: Meta<typeof ThemeSelector> = {
  title: 'Molecules/ThemeSelector',
  component: ThemeSelector,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## ThemeSelector

**Atomic Classification**: Theme Control Molecule  
**Composed of**: IconButton + Badge + MessageText + StatusDot + Container atoms  
**Single Responsibility**: Theme selection and management interface with visual preview and state management

### Purpose
A comprehensive theme selection molecule that provides visual theme previews, state management, and seamless theme switching. Combines color swatches, theme names, and selection indicators into a cohesive interface for theme customization.

### When to Use
- Application settings and preferences
- User customization interfaces
- Theme management panels
- Style configuration screens
- Design system demonstrations

### Atomic Composition
- **IconButton**: Theme selection buttons with hover states
- **Badge**: Theme name labels and current selection indicators
- **MessageText**: Theme names and current theme display
- **StatusDot**: Active theme selection indicators
- **Container**: Grid layout for theme options
- **Color Swatches**: Visual theme color previews

### Design Tokens Used
- **Colors**: All available theme color palettes with primary, secondary, accent colors
- **Layout**: Grid layout (grid-cols-3) for organized theme display
- **Spacing**: Consistent gaps (gap-2) and padding (p-2)
- **Borders**: Selection borders and hover states
- **Animations**: Smooth transitions and hover effects (hover:scale-105)
- **Typography**: Consistent text sizing for theme names

### Theme Support
- **Built-in Themes**: Light, Dark, Cupcake, Corporate, Synthwave, Cyberpunk, Business, Emerald, Lofi
- **Color Previews**: Primary, secondary, and accent color swatches
- **Current Selection**: Visual indicator for active theme
- **Responsive Grid**: Organized 3-column layout
- **State Management**: Controlled and uncontrolled modes

### State Management
- **Controlled Mode**: External theme state management via props
- **Uncontrolled Mode**: Internal state with localStorage persistence
- **Theme Persistence**: Automatic localStorage saving
- **DOM Updates**: Automatic data-theme attribute updates
- **Callback Support**: Theme change notifications

### Integration Points
- **localStorage**: Persistent theme storage
- **DOM Manipulation**: data-theme attribute updates
- **DaisyUI Themes**: Compatible with DaisyUI theme system
- **CSS Variables**: Supports CSS custom property themes
- **Theme Context**: Can integrate with theme context providers

### Visual Features
- **Color Swatches**: Three-color preview strips
- **Active Indicators**: Checkmark on selected theme
- **Hover Effects**: Scale animations on hover
- **Border States**: Different border colors for selection
- **Capitalized Names**: Proper theme name formatting

### Accessibility
- **Keyboard Navigation**: Full keyboard support for theme selection
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators and tab order
- **High Contrast**: Works with high contrast themes
- **Color Blind Support**: Text labels complement color swatches

### Molecule Guidelines
✓ **Do**: Use in settings and preference interfaces  
✓ **Do**: Provide visual previews of theme colors  
✓ **Do**: Support both controlled and uncontrolled modes  
✓ **Do**: Persist theme selection across sessions  
✗ **Don't**: Use for simple theme toggles (use atoms instead)  
✗ **Don't**: Override theme colors without updating previews  
✗ **Don't**: Skip accessibility features for theme selection
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
  render: () => (
    <div className="w-full max-w-md p-6 bg-base-100 rounded-lg border border-base-300">
      <ThemeSelector />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default theme selector with all available themes and automatic persistence.',
      },
    },
  },
};

export const ControlledMode: Story = {
  render: () => {
    const [theme, setTheme] = useState('dark');

    return (
      <div className="w-full max-w-md p-6 bg-base-100 rounded-lg border border-base-300">
        <div className="mb-4">
          <div className="text-sm text-base-content/60">External Controls:</div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setTheme('light')}
              className={`btn btn-xs ${theme === 'light' ? 'btn-primary' : 'btn-ghost'}`}
            >
              Light
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`btn btn-xs ${theme === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
            >
              Dark
            </button>
            <button
              onClick={() => setTheme('synthwave')}
              className={`btn btn-xs ${theme === 'synthwave' ? 'btn-primary' : 'btn-ghost'}`}
            >
              Synthwave
            </button>
          </div>
        </div>
        <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Theme selector in controlled mode with external state management.',
      },
    },
  },
};

export const AllThemes: Story = {
  render: () => {
    const [selectedTheme, setSelectedTheme] = useState('dark');

    return (
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Available Themes</h3>
          <p className="text-sm text-base-content/60">All 9 built-in themes with color previews</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 bg-base-100 rounded-lg border border-base-300">
            <div className="mb-4">
              <div className="text-sm font-medium text-base-content">Theme Selector</div>
              <div className="text-xs text-base-content/60">Current: {selectedTheme}</div>
            </div>
            <ThemeSelector currentTheme={selectedTheme} onThemeChange={setSelectedTheme} />
          </div>

          <div className="p-6 bg-base-100 rounded-lg border border-base-300">
            <div className="mb-4">
              <div className="text-sm font-medium text-base-content">Preview</div>
              <div className="text-xs text-base-content/60">How components look</div>
            </div>
            <div className="space-y-3" data-theme={selectedTheme}>
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm">Primary</button>
                <button className="btn btn-secondary btn-sm">Secondary</button>
                <button className="btn btn-accent btn-sm">Accent</button>
              </div>
              <div className="p-3 bg-base-200 rounded text-sm">
                This is how content looks in the selected theme
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-success rounded-full"></div>
                <span className="text-sm">Success color</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'All themes displayed with live preview of how they affect components.',
      },
    },
  },
};

export const InSettingsPanel: Story = {
  render: () => {
    const [settings, setSettings] = useState({
      theme: 'dark',
      fontSize: 'medium',
      notifications: true,
      autoSave: true,
    });

    return (
      <div className="w-full max-w-lg bg-base-100 rounded-lg border border-base-300">
        <div className="p-4 border-b border-base-300">
          <h3 className="text-lg font-semibold">Application Settings</h3>
        </div>

        <div className="p-4 space-y-6">
          <div>
            <label className="block text-sm font-medium text-base-content mb-2">Font Size</label>
            <select
              value={settings.fontSize}
              onChange={(e) => setSettings((prev) => ({ ...prev, fontSize: e.target.value }))}
              className="select select-bordered w-full"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-base-content mb-2">Appearance</label>
            <ThemeSelector
              currentTheme={settings.theme}
              onThemeChange={(theme) => setSettings((prev) => ({ ...prev, theme }))}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, notifications: e.target.checked }))
                }
                className="checkbox"
              />
              <label className="text-sm">Enable notifications</label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.autoSave}
                onChange={(e) => setSettings((prev) => ({ ...prev, autoSave: e.target.checked }))}
                className="checkbox"
              />
              <label className="text-sm">Auto-save changes</label>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-base-300">
          <button className="btn btn-primary w-full">Save Settings</button>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Theme selector integrated into a comprehensive settings panel.',
      },
    },
  },
};

export const CompactMode: Story = {
  render: () => (
    <div className="w-full max-w-sm p-4 bg-base-100 rounded-lg border border-base-300">
      <div className="space-y-3">
        <div className="text-sm font-medium text-base-content">Quick Theme Switch</div>
        <ThemeSelector />
        <div className="text-xs text-base-content/60">
          Changes apply immediately and persist across sessions
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Compact theme selector for smaller spaces and quick access.',
      },
    },
  },
};

export const WithAnimation: Story = {
  render: () => {
    const [theme, setTheme] = useState('dark');

    return (
      <div className="w-full max-w-md p-6 bg-base-100 rounded-lg border border-base-300">
        <div className="mb-4">
          <div className="text-sm font-medium text-base-content mb-2">Animated Theme Changes</div>
          <div className="text-xs text-base-content/60">
            Watch the hover and selection animations
          </div>
        </div>

        <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />

        <div className="mt-4 p-3 bg-base-200 rounded transition-all duration-300">
          <div className="text-sm">
            Current theme: <span className="font-medium capitalize">{theme}</span>
          </div>
          <div className="text-xs text-base-content/60 mt-1">
            Notice how the background color changes smoothly
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Theme selector with focus on animations and smooth transitions.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 ThemeSelector Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then click on different themes to see them
          in action!
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer hover:shadow-lg transition-shadow border rounded-lg p-4">
          <h4 className="font-medium mb-3">Theme Selection</h4>
          <ThemeSelector />
        </div>

        <div className="cursor-pointer hover:shadow-lg transition-shadow border rounded-lg p-4">
          <h4 className="font-medium mb-3">Settings Integration</h4>
          <div className="space-y-4">
            <div className="text-sm text-base-content/60">Appearance Settings</div>
            <ThemeSelector />
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm">Primary</button>
              <button className="btn btn-secondary btn-sm">Secondary</button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">ThemeSelector Features:</h4>
        <ul className="text-sm space-y-1">
          <li>
            • <strong>Visual Previews</strong> - Color swatches show theme colors
          </li>
          <li>
            • <strong>Instant Changes</strong> - Themes apply immediately
          </li>
          <li>
            • <strong>Persistence</strong> - Saves selection to localStorage
          </li>
          <li>
            • <strong>Controlled Mode</strong> - External state management support
          </li>
          <li>
            • <strong>9 Built-in Themes</strong> - Complete theme collection
          </li>
          <li>
            • <strong>Hover Effects</strong> - Smooth animations and feedback
          </li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing ThemeSelector with tennis commentary. Enable commentary in the toolbar and try different themes!',
      },
    },
  },
};
