// ABOUTME: Storybook story for AccountDropdown.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { AccountDropdown } from './AccountDropdown';

const meta: Meta<typeof AccountDropdown> = {
  title: 'Molecules/AccountDropdown',
  component: AccountDropdown,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## AccountDropdown

**Atomic Classification**: User Navigation Molecule  
**Composed of**: Avatar + Badge + NavigationItem + StatusDot + MessageText atoms  
**Single Responsibility**: User account management interface with profile, settings, and usage information

### Purpose
A comprehensive user account interface molecule that combines user avatar, profile information, account actions, and usage statistics into a unified dropdown component. Perfect for application headers and navigation areas.

### When to Use
- Application headers and navigation bars
- User profile management interfaces
- Account settings and preferences
- Usage monitoring and billing information
- User authentication and session management

### Atomic Composition
- **Avatar**: User profile picture or initials with online status
- **Badge**: Plan type indicators (Pro, Free, etc.)
- **NavigationItem**: Menu items for profile, settings, billing
- **StatusDot**: Connection and plan status indicators
- **MessageText**: User name, plan information, and usage stats
- **IconButton**: Expandable dropdown trigger and menu actions

### Design Tokens Used
- **Colors**: Gradient backgrounds for avatars, semantic colors for plan badges
- **Spacing**: Consistent padding (p-3, p-4) and gaps (gap-3)
- **Typography**: Font-medium for user names, text-xs for usage stats
- **Borders**: Subtle borders for dropdown separation
- **Shadows**: Elevated shadow for dropdown menu
- **Animations**: Smooth transitions for hover and focus states

### Account Features
- **User Profile**: Avatar, name, and status display
- **Plan Information**: Current subscription tier with badges
- **Usage Statistics**: Token usage and billing information
- **Account Actions**: Profile, settings, billing, sign out
- **Real-time Data**: Live usage stats from API integration
- **Responsive Design**: Adapts to different screen sizes

### Integration Points
- **useAgentTokenUsage Hook**: Real-time agent token usage without polling
- **FontAwesome Icons**: Consistent iconography throughout
- **DaisyUI Dropdown**: Accessible dropdown menu implementation
- **Theme System**: Respects current theme settings
- **Authentication**: Integrates with user session management

### Usage Statistics
- **Daily Usage**: Current day token consumption and costs
- **Monthly Usage**: Current month totals and projections
- **Total Usage**: Lifetime usage statistics
- **API Key Display**: Masked API key information
- **Loading States**: Graceful loading and error handling

### Accessibility
- **Keyboard Navigation**: Full keyboard support for all interactions
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators and tab order
- **High Contrast**: Theme-aware styling for accessibility
- **Error Handling**: Clear error messages for failed data loading

### Molecule Guidelines
✓ **Do**: Use in application headers and navigation areas  
✓ **Do**: Integrate with authentication and usage systems  
✓ **Do**: Provide real-time usage and billing information  
✓ **Do**: Support keyboard navigation and accessibility  
✗ **Don't**: Use for simple user display without actions  
✗ **Don't**: Override dropdown positioning without testing  
✗ **Don't**: Skip loading states for usage data
        `,
      },
    },
  },
  argTypes: {
    // AccountDropdown has no props - it's self-contained
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-80 bg-base-100 p-4 rounded-lg border border-base-300">
      <div className="h-96 flex flex-col">
        <div className="flex-1 bg-base-200 rounded-lg mb-4 p-4">
          <div className="text-sm text-base-content/60 mb-2">Sidebar Content</div>
          <div className="space-y-2">
            <div className="h-3 bg-base-300 rounded"></div>
            <div className="h-3 bg-base-300 rounded w-3/4"></div>
            <div className="h-3 bg-base-300 rounded w-1/2"></div>
          </div>
        </div>
        <AccountDropdown />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default account dropdown as it appears in the application sidebar.',
      },
    },
  },
};

export const WithMockData: Story = {
  render: () => (
    <div className="w-80 bg-base-100 p-4 rounded-lg border border-base-300">
      <div className="h-96 flex flex-col">
        <div className="flex-1 bg-base-200 rounded-lg mb-4 p-4">
          <div className="text-sm text-base-content/60 mb-2">Application Content</div>
          <div className="space-y-2">
            <div className="h-3 bg-base-300 rounded"></div>
            <div className="h-3 bg-base-300 rounded w-3/4"></div>
            <div className="h-3 bg-base-300 rounded w-1/2"></div>
          </div>
        </div>
        <AccountDropdown />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Account dropdown with mock usage data and billing information.',
      },
    },
  },
};

export const InSidebar: Story = {
  render: () => (
    <div className="w-80 h-screen bg-base-100 border-r border-base-300 flex flex-col">
      <div className="p-4 border-b border-base-300">
        <h2 className="text-lg font-semibold text-base-content">Lace</h2>
      </div>
      
      <div className="flex-1 p-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium text-base-content/60">Projects</div>
            <div className="space-y-1">
              <div className="p-2 bg-base-200 rounded text-sm">Project Alpha</div>
              <div className="p-2 hover:bg-base-200 rounded text-sm">Project Beta</div>
              <div className="p-2 hover:bg-base-200 rounded text-sm">Project Gamma</div>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="text-sm font-medium text-base-content/60">Timeline</div>
            <div className="space-y-1">
              <div className="p-2 hover:bg-base-200 rounded text-sm">Recent Messages</div>
              <div className="p-2 hover:bg-base-200 rounded text-sm">Archived Chats</div>
            </div>
          </div>
        </div>
      </div>
      
      <AccountDropdown />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Account dropdown in its natural sidebar context with navigation and content.',
      },
    },
  },
};

export const LoadingState: Story = {
  render: () => (
    <div className="w-80 bg-base-100 p-4 rounded-lg border border-base-300">
      <div className="h-96 flex flex-col">
        <div className="flex-1 bg-base-200 rounded-lg mb-4 p-4">
          <div className="text-sm text-base-content/60 mb-2">Loading Usage Data</div>
          <div className="space-y-2">
            <div className="h-3 bg-base-300 rounded animate-pulse"></div>
            <div className="h-3 bg-base-300 rounded w-3/4 animate-pulse"></div>
            <div className="h-3 bg-base-300 rounded w-1/2 animate-pulse"></div>
          </div>
        </div>
        <AccountDropdown />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Account dropdown showing loading state for usage statistics.',
      },
    },
  },
};

export const DarkTheme: Story = {
  render: () => (
    <div className="w-80 bg-base-100 p-4 rounded-lg border border-base-300" data-theme="dark">
      <div className="h-96 flex flex-col">
        <div className="flex-1 bg-base-200 rounded-lg mb-4 p-4">
          <div className="text-sm text-base-content/60 mb-2">Dark Theme</div>
          <div className="space-y-2">
            <div className="h-3 bg-base-300 rounded"></div>
            <div className="h-3 bg-base-300 rounded w-3/4"></div>
            <div className="h-3 bg-base-300 rounded w-1/2"></div>
          </div>
        </div>
        <AccountDropdown />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Account dropdown styled for dark theme with appropriate contrast.',
      },
    },
  },
};

export const UserVariations: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="w-80 bg-base-100 p-4 rounded-lg border border-base-300">
        <div className="text-sm font-medium text-base-content/60 mb-4">Pro User</div>
        <div className="h-80 flex flex-col">
          <div className="flex-1 bg-base-200 rounded-lg mb-4"></div>
          <AccountDropdown />
        </div>
      </div>
      
      <div className="w-80 bg-base-100 p-4 rounded-lg border border-base-300">
        <div className="text-sm font-medium text-base-content/60 mb-4">Free User (Mock)</div>
        <div className="h-80 flex flex-col">
          <div className="flex-1 bg-base-200 rounded-lg mb-4"></div>
          <div className="mt-auto border-t border-base-300 p-4">
            <div className="dropdown dropdown-top w-full">
              <div className="flex items-center gap-3 p-3 hover:bg-base-200 rounded-lg transition-colors cursor-pointer w-full">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center ring-2 ring-base-300 shadow-md">
                    <span className="text-white font-bold text-lg">FS</span>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-gray-400 rounded-full border-2 border-base-100"></div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-base-content truncate">Free Starter</div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-base-content/60">Free Plan</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different user types showing Pro and Free plan variations.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 AccountDropdown Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then click on the account dropdown to explore!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Sidebar Context</h4>
          <div className="w-80 h-96 bg-base-100 border border-base-300 rounded-lg flex flex-col">
            <div className="p-4 border-b border-base-300">
              <h2 className="text-lg font-semibold text-base-content">Lace</h2>
            </div>
            <div className="flex-1 p-4">
              <div className="space-y-2">
                <div className="p-2 bg-base-200 rounded text-sm">Chat History</div>
                <div className="p-2 hover:bg-base-200 rounded text-sm">Settings</div>
                <div className="p-2 hover:bg-base-200 rounded text-sm">Projects</div>
              </div>
            </div>
            <AccountDropdown />
          </div>
        </div>
        
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Standalone Usage</h4>
          <div className="w-80 h-96 bg-base-100 border border-base-300 rounded-lg flex flex-col">
            <div className="flex-1 p-4">
              <div className="text-sm text-base-content/60 mb-4">Account Management</div>
              <div className="space-y-2">
                <div className="p-3 bg-base-200 rounded">
                  <div className="text-sm font-medium">Usage Statistics</div>
                  <div className="text-xs text-base-content/60">View your API usage</div>
                </div>
                <div className="p-3 bg-base-200 rounded">
                  <div className="text-sm font-medium">Billing Information</div>
                  <div className="text-xs text-base-content/60">Manage your subscription</div>
                </div>
              </div>
            </div>
            <AccountDropdown />
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">AccountDropdown Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>User Profile</strong> - Avatar, name, and plan display</li>
          <li>• <strong>Real-time Usage</strong> - Live API usage and billing data</li>
          <li>• <strong>Account Actions</strong> - Profile, settings, billing access</li>
          <li>• <strong>Plan Management</strong> - Current subscription tier display</li>
          <li>• <strong>Responsive Design</strong> - Works in sidebar and standalone</li>
          <li>• <strong>Accessibility</strong> - Full keyboard navigation support</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing AccountDropdown with tennis commentary. Enable commentary in the toolbar and interact with the dropdown!',
      },
    },
  },
};