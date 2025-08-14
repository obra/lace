// ABOUTME: Storybook story for LaceApp.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { LaceApp } from './LaceApp';

const meta: Meta<typeof LaceApp> = {
  title: 'Pages/LaceApp',
  component: LaceApp,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## LaceApp

**Atomic Classification**: Main Application Page  
**Composed of**: Sidebar + TimelineView + EnhancedChatInput + StreamingIndicator + VoiceRecognitionUI + TaskBoardModal + DragDropOverlay organisms  
**Single Responsibility**: Complete chat application interface with sidebar navigation, timeline display, and enhanced input capabilities

### Purpose
The main application page that combines all core functionality into a complete chat interface. Provides the primary user experience for interacting with the Lace AI assistant, including conversation management, file handling, voice recognition, and task organization.

### When to Use
- Primary application interface
- Full-featured chat experience
- Complete AI assistant interaction
- Production application deployment
- User-facing chat interface

### Page Composition
- **Sidebar**: Navigation and project management
- **MobileSidebar**: Mobile-optimized navigation
- **TimelineView**: Conversation history and message display
- **EnhancedChatInput**: Advanced chat input with voice and file support
- **StreamingIndicator**: Real-time response indicators
- **VoiceRecognitionUI**: Voice input interface
- **TaskBoardModal**: Task management overlay
- **DragDropOverlay**: File drag and drop handling

### Features
- **Responsive Design**: Desktop and mobile layouts
- **Voice Recognition**: Speech-to-text input capabilities
- **File Handling**: Drag and drop file attachments
- **Real-time Streaming**: Live AI response streaming
- **Task Management**: Integrated task board functionality
- **Theme Support**: Multiple theme options
- **Sidebar Navigation**: Collapsible sidebar with project management

### State Management
- **UI State**: Sidebar visibility, mobile navigation, theme selection
- **Chat State**: Current prompt, streaming content, attached files
- **Voice State**: Recognition status, transcript, confidence
- **Timeline State**: Conversation entries, tool calls, AI responses
- **Task State**: Task board visibility and management

### Integration Points
- **Voice Recognition Hook**: Speech-to-text functionality
- **Conversation Stream Hook**: Real-time AI streaming
- **FontAwesome Icons**: Consistent iconography
- **Theme System**: DaisyUI theme integration
- **File System**: Drag and drop file handling

### Visual Features
- **Sidebar Layout**: Collapsible navigation with project management
- **Timeline Display**: Conversation history with message types
- **Input Area**: Advanced chat input with voice and file support
- **Streaming UI**: Real-time response indicators
- **Mobile Responsive**: Optimized for all screen sizes
- **Theme Aware**: Supports multiple visual themes

### Page Guidelines
✓ **Do**: Use as the main application interface  
✓ **Do**: Provide complete chat functionality  
✓ **Do**: Support responsive design across devices  
✓ **Do**: Include voice and file handling capabilities  
✗ **Don't**: Use for simple chat interfaces (use simpler components)  
✗ **Don't**: Skip accessibility features  
✗ **Don't**: Modify without testing voice and file features  
✗ **Don't**: Remove responsive design considerations

### Page Hierarchy
- **Application Level**: Complete user interface
- **Template Level**: Layout and structure
- **Organism Level**: Individual feature components
- **Molecule Level**: UI component combinations
- **Atom Level**: Basic UI elements

### Performance Considerations
- **Lazy Loading**: Components loaded as needed
- **State Optimization**: Efficient state management
- **Stream Handling**: Optimized real-time updates
- **Memory Management**: Proper cleanup of hooks and listeners
- **Responsive Images**: Optimized for different screen sizes
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <LaceApp />,
  parameters: {
    docs: {
      description: {
        story: 'Complete Lace application interface with all features enabled.',
      },
    },
  },
};

export const DesktopLayout: Story = {
  render: () => (
    <div className="h-screen w-full">
      <LaceApp />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Desktop layout showing full sidebar and timeline interface.',
      },
    },
  },
};

export const MobileLayout: Story = {
  render: () => (
    <div className="h-screen w-full max-w-sm mx-auto border-x border-base-300">
      <LaceApp />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Mobile layout with responsive design and mobile sidebar.',
      },
    },
  },
};

export const DarkTheme: Story = {
  render: () => (
    <div className="h-screen w-full" data-theme="dark">
      <LaceApp />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Lace application with dark theme styling.',
      },
    },
  },
};

export const LightTheme: Story = {
  render: () => (
    <div className="h-screen w-full" data-theme="light">
      <LaceApp />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Lace application with light theme styling.',
      },
    },
  },
};

export const CyberpunkTheme: Story = {
  render: () => (
    <div className="h-screen w-full" data-theme="cyberpunk">
      <LaceApp />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Lace application with cyberpunk theme styling.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-6xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 LaceApp Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then explore the complete Lace interface!
        </p>
      </div>

      <div className="h-96 border border-base-300 rounded-lg overflow-hidden">
        <LaceApp />
      </div>

      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">LaceApp Features:</h4>
        <ul className="text-sm space-y-1">
          <li>
            • <strong>Complete Interface</strong> - Full chat application with all features
          </li>
          <li>
            • <strong>Voice Recognition</strong> - Speech-to-text input capabilities
          </li>
          <li>
            • <strong>File Handling</strong> - Drag and drop file attachments
          </li>
          <li>
            • <strong>Real-time Streaming</strong> - Live AI response streaming
          </li>
          <li>
            • <strong>Task Management</strong> - Integrated task board functionality
          </li>
          <li>
            • <strong>Responsive Design</strong> - Desktop and mobile layouts
          </li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing the complete LaceApp with tennis commentary. Enable commentary in the toolbar and explore all features!',
      },
    },
  },
};
