import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Timeline, Project, Task, RecentFile } from '~/types';

const meta: Meta<typeof Sidebar> = {
  title: 'Organisms/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## Sidebar

**Atomic Classification**: Navigation Organism  
**Composed of**: Multiple molecules and atoms forming distinct interface sections  
**Business Logic**: Project management, timeline switching, task tracking, settings

### Purpose
A complex, self-contained component that forms the primary navigation interface. Composes multiple molecules and atoms to create a standalone section that handles project navigation, timeline management, task tracking, and user settings.

### When to Use
- Primary application navigation
- Project-based interfaces
- Multi-timeline applications
- Any interface requiring hierarchical navigation

### Atomic Composition
- **SectionHeader** atoms for collapsible sections
- **NavigationItem** molecules for timeline/project listings
- **ProjectBadge** atoms for visual project identification
- **TaskCard** molecules for task preview
- **ToggleButton** atoms for expand/collapse
- **AccountDropdown** molecule for user management
- **ThemeSelector** molecule for preference management

### Design Tokens Used
- **Layout**: Flexbox with responsive width (collapsed: 64px, expanded: 350px)
- **Colors**: Base-100 background, teal accents, agent-specific colors
- **Spacing**: Consistent padding and gap scales throughout
- **Typography**: Hierarchical text sizing for different content types
- **Shadows**: Subtle elevation with smooth transitions

### Accessibility
- Keyboard navigation through all interactive elements
- Screen reader support for section states
- Focus management during expand/collapse
- High contrast mode support
- Proper ARIA labels for dynamic content

### State Management
- **isOpen**: Controls expanded/collapsed state
- **currentProject**: Active project selection
- **currentTimeline**: Active conversation timeline
- **expandedSections**: Individual section states
- **activeTasks**: Dynamic task list
- **recentFiles**: File history tracking

### Business Logic
- Project switching and persistence
- Timeline management and creation
- Task filtering and interaction
- File access and organization
- Settings and preferences
- Theme management

### Organism Guidelines
✓ **Do**: Self-contained with clear boundaries  
✓ **Do**: Handle own state and interactions  
✓ **Do**: Responsive and accessible by default  
✓ **Do**: Include business logic when appropriate  
✓ **Do**: Function independently  
✗ **Don't**: Tightly couple to specific contexts  
✗ **Don't**: Mix unrelated functionality  
✗ **Don't**: Create inconsistent interaction patterns
        `,
      },
    },
  },
  argTypes: {
    isOpen: {
      control: { type: 'boolean' },
      description: 'Whether the sidebar is expanded or collapsed',
    },
    currentProject: {
      control: { type: 'object' },
      description: 'The currently selected project',
    },
    projects: {
      control: { type: 'object' },
      description: 'Available projects',
    },
    currentTimeline: {
      control: { type: 'object' },
      description: 'The currently active timeline',
    },
    timelines: {
      control: { type: 'object' },
      description: 'Available timelines',
    },
    activeTasks: {
      control: { type: 'object' },
      description: 'Active tasks to display',
    },
    recentFiles: {
      control: { type: 'object' },
      description: 'Recent files to display',
    },
    currentTheme: {
      control: { type: 'select' },
      options: ['light', 'dark', 'system'],
      description: 'Current theme setting',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data for stories
const mockProjects: Project[] = [
  {
    id: '1',
    name: 'Lace AI Assistant',
    description: 'Main AI assistant project',
    path: '/Users/user/code/lace',
    language: 'TypeScript',
    framework: 'Next.js',
    lastOpened: '2024-01-15T10:00:00Z',
  },
  {
    id: '2',
    name: 'E-commerce Platform',
    description: 'Online store platform',
    path: '/Users/user/code/ecommerce',
    language: 'Python',
    framework: 'Django',
    lastOpened: '2024-01-14T15:30:00Z',
  },
  {
    id: '3',
    name: 'Mobile App',
    description: 'React Native mobile app',
    path: '/Users/user/code/mobile',
    language: 'JavaScript',
    framework: 'React Native',
    lastOpened: '2024-01-13T09:15:00Z',
  },
];

const mockTimelines: Timeline[] = [
  {
    id: '1',
    name: 'Feature Development',
    agent: 'Claude',
    created: '2024-01-15T10:00:00Z',
    lastMessage: '2024-01-15T10:30:00Z',
    messageCount: 15,
    isActive: true,
  },
  {
    id: '2',
    name: 'Bug Fixes',
    agent: 'GPT-4',
    created: '2024-01-14T14:00:00Z',
    lastMessage: '2024-01-14T16:45:00Z',
    messageCount: 8,
    isActive: false,
  },
  {
    id: '3',
    name: 'Code Review',
    agent: 'Gemini',
    created: '2024-01-13T09:00:00Z',
    lastMessage: '2024-01-13T11:20:00Z',
    messageCount: 12,
    isActive: false,
  },
];

const mockTasks: Task[] = [
  {
    id: '1',
    title: 'Implement user authentication',
    description: 'Add JWT-based authentication with login/logout',
    priority: 'high',
    status: 'in-progress',
    assignee: 'Claude',
    created: '2024-01-15T09:00:00Z',
    deadline: '2024-01-20T17:00:00Z',
  },
  {
    id: '2',
    title: 'Fix database connection pool',
    description: 'Resolve memory leak in connection pool',
    priority: 'medium',
    status: 'pending',
    assignee: 'GPT-4',
    created: '2024-01-14T13:00:00Z',
    deadline: '2024-01-18T17:00:00Z',
  },
  {
    id: '3',
    title: 'Update documentation',
    description: 'Update API documentation with new endpoints',
    priority: 'low',
    status: 'completed',
    assignee: 'Gemini',
    created: '2024-01-13T10:00:00Z',
    deadline: '2024-01-17T17:00:00Z',
  },
];

const mockRecentFiles: RecentFile[] = [
  {
    name: 'app.tsx',
    path: '/src/app.tsx',
    lastModified: '2024-01-15T10:30:00Z',
    size: 2048,
  },
  {
    name: 'sidebar.tsx',
    path: '/src/components/layout/sidebar.tsx',
    lastModified: '2024-01-15T10:15:00Z',
    size: 8192,
  },
  {
    name: 'auth.py',
    path: '/backend/auth.py',
    lastModified: '2024-01-15T09:45:00Z',
    size: 1024,
  },
  {
    name: 'package.json',
    path: '/package.json',
    lastModified: '2024-01-14T16:20:00Z',
    size: 512,
  },
];

// Interactive wrapper component
const SidebarWrapper = ({ initialOpen = true, ...props }: any) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [currentProject, setCurrentProject] = useState(mockProjects[0]);
  const [currentTimeline, setCurrentTimeline] = useState(mockTimelines[0]);
  const [currentTheme, setCurrentTheme] = useState('light');

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleProjectChange = (project: Project) => {
    setCurrentProject(project);
    console.log('Project changed:', project.name);
  };

  const handleTimelineChange = (timeline: Timeline) => {
    setCurrentTimeline(timeline);
    console.log('Timeline changed:', timeline.name);
  };

  const handleNewTimeline = () => {
    console.log('New timeline requested');
  };

  const handleOpenTask = (task: Task) => {
    console.log('Task opened:', task.title);
  };

  const handleOpenFile = (file: RecentFile) => {
    console.log('File opened:', file.name);
  };

  const handleTriggerTool = (tool: string) => {
    console.log('Tool triggered:', tool);
  };

  const handleOpenTaskBoard = () => {
    console.log('Task board opened');
  };

  const handleOpenFileManager = () => {
    console.log('File manager opened');
  };

  const handleOpenRulesFile = () => {
    console.log('Rules file opened');
  };

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    console.log('Theme changed:', theme);
  };

  return (
    <div className="flex h-screen bg-base-100">
      <Sidebar
        isOpen={isOpen}
        onToggle={handleToggle}
        currentProject={currentProject}
        projects={mockProjects}
        currentTimeline={currentTimeline}
        timelines={mockTimelines}
        activeTasks={mockTasks}
        recentFiles={mockRecentFiles}
        currentTheme={currentTheme}
        onProjectChange={handleProjectChange}
        onTimelineChange={handleTimelineChange}
        onNewTimeline={handleNewTimeline}
        onOpenTask={handleOpenTask}
        onOpenFile={handleOpenFile}
        onTriggerTool={handleTriggerTool}
        onOpenTaskBoard={handleOpenTaskBoard}
        onOpenFileManager={handleOpenFileManager}
        onOpenRulesFile={handleOpenRulesFile}
        onThemeChange={handleThemeChange}
        {...props}
      />
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold mb-4">Main Content Area</h1>
          <p className="text-gray-600 mb-4">
            This is the main content area. The sidebar can be toggled open/closed and contains
            various sections for navigation and project management.
          </p>
          
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold mb-2">Current State:</h3>
              <p>Project: {currentProject.name}</p>
              <p>Timeline: {currentTimeline.name}</p>
              <p>Theme: {currentTheme}</p>
              <p>Sidebar: {isOpen ? 'Open' : 'Closed'}</p>
            </div>
            
            <div className="p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold mb-2">Try These Actions:</h3>
              <ul className="text-sm space-y-1">
                <li>• Toggle the sidebar open/closed</li>
                <li>• Switch between projects</li>
                <li>• Change timelines</li>
                <li>• Click on tasks and files</li>
                <li>• Expand/collapse different sections</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Default: Story = {
  render: () => <SidebarWrapper />,
};

export const Collapsed: Story = {
  render: () => <SidebarWrapper initialOpen={false} />,
};

export const Expanded: Story = {
  render: () => <SidebarWrapper initialOpen={true} />,
};

export const WithManyTasks: Story = {
  render: () => (
    <SidebarWrapper
      activeTasks={[
        ...mockTasks,
        {
          id: '4',
          title: 'Optimize performance',
          description: 'Improve app loading time',
          priority: 'high',
          status: 'in-progress',
          assignee: 'Claude',
          created: '2024-01-15T11:00:00Z',
          deadline: '2024-01-19T17:00:00Z',
        },
        {
          id: '5',
          title: 'Add unit tests',
          description: 'Increase test coverage to 80%',
          priority: 'medium',
          status: 'pending',
          assignee: 'GPT-4',
          created: '2024-01-15T12:00:00Z',
          deadline: '2024-01-22T17:00:00Z',
        },
      ]}
    />
  ),
};

export const WithManyTimelines: Story = {
  render: () => (
    <SidebarWrapper
      timelines={[
        ...mockTimelines,
        {
          id: '4',
          name: 'Performance Optimization',
          agent: 'Claude',
          created: '2024-01-15T11:00:00Z',
          lastMessage: '2024-01-15T11:30:00Z',
          messageCount: 5,
          isActive: false,
        },
        {
          id: '5',
          name: 'UI/UX Improvements',
          agent: 'GPT-4',
          created: '2024-01-15T12:00:00Z',
          lastMessage: '2024-01-15T12:15:00Z',
          messageCount: 3,
          isActive: false,
        },
      ]}
    />
  ),
};

export const DarkTheme: Story = {
  render: () => (
    <div data-theme="dark">
      <SidebarWrapper currentTheme="dark" />
    </div>
  ),
};

export const SidebarStates: Story = {
  render: () => (
    <div className="flex gap-8 p-8 bg-base-200 min-h-screen">
      <div className="flex flex-col items-center">
        <h3 className="text-lg font-semibold mb-4">Collapsed</h3>
        <div className="bg-base-100 rounded-lg shadow-lg overflow-hidden">
          <SidebarWrapper initialOpen={false} />
        </div>
      </div>
      
      <div className="flex flex-col items-center">
        <h3 className="text-lg font-semibold mb-4">Expanded</h3>
        <div className="bg-base-100 rounded-lg shadow-lg overflow-hidden">
          <SidebarWrapper initialOpen={true} />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of collapsed and expanded sidebar states.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(true);
    const [currentProject, setCurrentProject] = useState(mockProjects[0]);
    const [currentTimeline, setCurrentTimeline] = useState(mockTimelines[0]);
    const [currentTheme, setCurrentTheme] = useState('light');
    const [actions, setActions] = useState<string[]>([]);

    const addAction = (action: string) => {
      setActions(prev => [...prev.slice(-4), `${new Date().toLocaleTimeString()}: ${action}`]);
    };

    const handleToggle = () => {
      setIsOpen(!isOpen);
      addAction(`Sidebar ${isOpen ? 'collapsed' : 'expanded'}`);
    };

    const handleProjectChange = (project: Project) => {
      setCurrentProject(project);
      addAction(`Project changed to: ${project.name}`);
    };

    const handleTimelineChange = (timeline: Timeline) => {
      setCurrentTimeline(timeline);
      addAction(`Timeline changed to: ${timeline.name}`);
    };

    const handleNewTimeline = () => {
      addAction('New timeline requested');
    };

    const handleOpenTask = (task: Task) => {
      addAction(`Task opened: ${task.title}`);
    };

    const handleOpenFile = (file: RecentFile) => {
      addAction(`File opened: ${file.name}`);
    };

    const handleTriggerTool = (tool: string) => {
      addAction(`Tool triggered: ${tool}`);
    };

    const handleOpenTaskBoard = () => {
      addAction('Task board opened');
    };

    const handleOpenFileManager = () => {
      addAction('File manager opened');
    };

    const handleOpenRulesFile = () => {
      addAction('Rules file opened');
    };

    const handleThemeChange = (theme: string) => {
      setCurrentTheme(theme);
      addAction(`Theme changed to: ${theme}`);
    };

    return (
      <div className="flex flex-col h-screen bg-base-100">
        <div className="text-center p-6 bg-base-200 border-b">
          <h3 className="text-lg font-semibold mb-2">🎾 Sidebar Tennis Commentary Demo</h3>
          <p className="text-sm text-gray-600">
            Enable tennis commentary in the toolbar above, then interact with the sidebar below!
          </p>
        </div>
        
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            isOpen={isOpen}
            onToggle={handleToggle}
            currentProject={currentProject}
            projects={mockProjects}
            currentTimeline={currentTimeline}
            timelines={mockTimelines}
            activeTasks={mockTasks}
            recentFiles={mockRecentFiles}
            currentTheme={currentTheme}
            onProjectChange={handleProjectChange}
            onTimelineChange={handleTimelineChange}
            onNewTimeline={handleNewTimeline}
            onOpenTask={handleOpenTask}
            onOpenFile={handleOpenFile}
            onTriggerTool={handleTriggerTool}
            onOpenTaskBoard={handleOpenTaskBoard}
            onOpenFileManager={handleOpenFileManager}
            onOpenRulesFile={handleOpenRulesFile}
            onThemeChange={handleThemeChange}
          />
          
          <div className="flex-1 p-8 overflow-y-auto">
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold mb-4">Interactive Sidebar Demo</h1>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-semibold mb-2">Current State:</h3>
                  <p className="text-sm">Project: {currentProject.name}</p>
                  <p className="text-sm">Timeline: {currentTimeline.name}</p>
                  <p className="text-sm">Theme: {currentTheme}</p>
                  <p className="text-sm">Sidebar: {isOpen ? 'Open' : 'Closed'}</p>
                </div>
                
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h3 className="font-semibold mb-2">Recent Actions:</h3>
                  <div className="text-sm space-y-1 max-h-32 overflow-y-auto">
                    {actions.length === 0 ? (
                      <p className="text-gray-500">No actions yet</p>
                    ) : (
                      actions.map((action, index) => (
                        <div key={index} className="text-xs font-mono">
                          {action}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-green-50 rounded-lg">
                <h3 className="font-semibold mb-2">Try These Interactions:</h3>
                <ul className="text-sm space-y-1">
                  <li>• <strong>Toggle sidebar</strong> - Click the chevron button</li>
                  <li>• <strong>Switch projects</strong> - Use the project dropdown</li>
                  <li>• <strong>Change timelines</strong> - Click on different conversations</li>
                  <li>• <strong>Expand sections</strong> - Click on Tasks, Files, Settings</li>
                  <li>• <strong>Click tasks and files</strong> - Interact with list items</li>
                  <li>• <strong>Change theme</strong> - Use the theme selector in Settings</li>
                  <li>• <strong>Hover and click</strong> everything for tennis commentary!</li>
                </ul>
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
        story: 'Interactive demo showcasing the sidebar with tennis commentary. Enable commentary in the toolbar and interact with all the sidebar elements!',
      },
    },
  },
};