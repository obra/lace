import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { MobileSidebar } from './MobileSidebar';
import { Timeline, Project, Task } from '@/types';

const meta: Meta<typeof MobileSidebar> = {
  title: 'Organisms/MobileSidebar',
  component: MobileSidebar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## MobileSidebar

**Atomic Classification**: Mobile Navigation Organism  
**Composed of**: Modal overlay + Navigation sections + Quick actions + Theme selector  
**Single Responsibility**: Mobile-optimized sidebar navigation with project/timeline switching and quick actions

### Purpose
A mobile-optimized sidebar navigation component that provides full application navigation capabilities in a touch-friendly interface with overlay presentation and comprehensive project management features.

### When to Use
- Mobile and small screen navigation
- Touch-first interaction patterns
- Overlay-based navigation systems
- Quick access to projects and timelines
- Mobile task management interfaces

### Organism Composition
- **Modal Overlay**: Full-screen overlay with backdrop dismissal
- **Header Section**: Lace branding with animated close button
- **Project Selector**: Dropdown for project switching
- **Timeline Selector**: Dropdown for timeline/agent selection
- **Quick Actions**: Grid of common tool actions
- **Task Preview**: Active tasks with priority indicators
- **Theme Selector**: Visual theme switching with color previews

### Features
- **Overlay Presentation**: Full-screen modal with backdrop dismissal
- **Animated Transitions**: Smooth slide-in animation from left
- **Project Management**: Quick project and timeline switching
- **Quick Actions**: One-tap access to common tools
- **Task Preview**: Shows active tasks with priority indicators
- **Theme Switching**: Visual theme selection with color previews
- **Touch Optimization**: All controls optimized for touch interaction

### State Management
- **Visibility State**: Open/closed state with overlay
- **Current Project**: Active project selection
- **Current Timeline**: Active timeline and agent
- **Theme State**: Current theme selection
- **Task Data**: Active tasks for preview section
- **Action Handlers**: Event callbacks for all interactions

### Integration Points
- **FontAwesome Icons**: Consistent iconography for actions
- **Heroicons**: Navigation and UI icons
- **Theme System**: DaisyUI theme integration
- **Project Types**: Shared project and timeline types
- **Task Types**: Integrated task management types

### Visual Features
- **Lace Branding**: Geometric logo design with gradient
- **Slide Animation**: Smooth left-to-right slide transition
- **Visual Selectors**: Color-coded theme previews
- **Priority Indicators**: Color-coded task priority badges
- **Grid Layout**: Organized quick actions in 2x2 grid
- **Responsive Heights**: Adapts to different mobile screen sizes

### Organism Guidelines
✓ **Do**: Use for mobile navigation interfaces  
✓ **Do**: Provide touch-optimized interaction areas  
✓ **Do**: Include backdrop dismissal for overlay behavior  
✓ **Do**: Show current selection states clearly  
✗ **Don't**: Use on desktop screens (use Sidebar instead)  
✗ **Don't**: Skip touch accessibility features  
✗ **Don't**: Modify without testing slide animations  
✗ **Don't**: Remove overlay backdrop functionality

### Organism Hierarchy
- **Organism Level**: Complete mobile navigation interface
- **Molecule Level**: Section groups, selectors, quick actions
- **Atom Level**: Buttons, dropdowns, badges, icons
- **System Level**: Overlay, animations, touch handling

### Performance Considerations
- **Animation Performance**: Smooth CSS transitions
- **Touch Responsiveness**: Optimized touch event handling
- **Memory Management**: Proper cleanup of overlay events
- **Render Optimization**: Efficient list rendering for options
- **Gesture Support**: Swipe and tap gesture handling
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample data for stories
const sampleProjects: Project[] = [
  { id: 1, name: 'AI Research', path: '/projects/ai-research' },
  { id: 2, name: 'Web Application', path: '/projects/webapp' },
  { id: 3, name: 'Data Pipeline', path: '/projects/data-pipeline' },
  { id: 4, name: 'Mobile App', path: '/projects/mobile' },
];

const sampleTimelines: Timeline[] = [
  { id: 2, name: 'Code Review', agent: 'Claude' },
  { id: 3, name: 'Research', agent: 'Gemini' },
  { id: 4, name: 'Testing', agent: 'GPT-4' },
  { id: 5, name: 'Data Analysis', agent: 'Claude' },
  { id: 6, name: 'Tennis Commentary Demo', agent: 'Claude' },
  { id: 7, name: 'Design System Demo', agent: 'Claude' },
];

const sampleTasks: Task[] = [
  {
    id: 1,
    title: 'AI Model Integration',
    description: 'Integrate latest language model',
    priority: 'high',
    assignee: 'Claude',
    status: 'in_progress',
  },
  {
    id: 2,
    title: 'Auth Bug Fix',
    description: 'Fix login timeout',
    priority: 'medium',
    assignee: 'Human',
    status: 'pending',
  },
  {
    id: 3,
    title: 'Update Documentation',
    description: 'API documentation',
    priority: 'low',
    assignee: 'Claude',
    status: 'review',
  },
  {
    id: 4,
    title: 'Performance Optimization',
    description: 'Database query optimization',
    priority: 'high',
    assignee: 'Human',
    status: 'pending',
  },
  {
    id: 5,
    title: 'Mobile Responsive Design',
    description: 'Responsive layout fixes',
    priority: 'medium',
    assignee: 'Claude',
    status: 'completed',
  },
];

const availableThemes = [
  { name: 'light', colors: { primary: '#570DF8', secondary: '#F000B8', accent: '#37CDBE' } },
  { name: 'dark', colors: { primary: '#661AE6', secondary: '#D926AA', accent: '#1FB2A5' } },
  { name: 'cupcake', colors: { primary: '#65C3C8', secondary: '#EF9FBC', accent: '#EEAF3A' } },
  { name: 'corporate', colors: { primary: '#4B6BFB', secondary: '#7C3AED', accent: '#37CDBE' } },
  { name: 'synthwave', colors: { primary: '#E779C1', secondary: '#58C7F3', accent: '#F7CC50' } },
  { name: 'cyberpunk', colors: { primary: '#FF7598', secondary: '#75D1F0', accent: '#C07F00' } },
];

const defaultArgs = {
  isOpen: true,
  onClose: () => {},
  currentProject: sampleProjects[0],
  projects: sampleProjects,
  currentTimeline: { id: 1, name: 'Main Dev', agent: 'Claude' as const },
  timelines: sampleTimelines,
  activeTasks: sampleTasks,
  currentTheme: 'dark',
  availableThemes,
  onProjectChange: (project: Project) => console.log('Project changed:', project),
  onTimelineChange: (timeline: Timeline) => console.log('Timeline changed:', timeline),
  onThemeChange: (theme: string) => console.log('Theme changed:', theme),
  onTriggerTool: (tool: string) => console.log('Tool triggered:', tool),
  onOpenTaskBoard: () => console.log('Task board opened'),
  onOpenFileManager: () => console.log('File manager opened'),
  onOpenTaskDetail: (task: Task) => console.log('Task detail opened:', task),
};

export const Default: Story = {
  args: defaultArgs,
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">📱 MobileSidebar Default</h3>
          <p className="text-sm text-gray-600 mb-4">
            Default mobile sidebar with all navigation sections and sample data.
          </p>
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="btn btn-primary"
          >
            {isOpen ? 'Close' : 'Open'} Mobile Sidebar
          </button>
        </div>
        
        <MobileSidebar 
          {...args} 
          isOpen={isOpen} 
          onClose={() => setIsOpen(false)}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Default mobile sidebar with all navigation sections and sample data.',
      },
    },
  },
};

export const Closed: Story = {
  args: {
    ...defaultArgs,
    isOpen: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar in closed state - renders nothing.',
      },
    },
  },
};

export const MinimalProjects: Story = {
  args: {
    ...defaultArgs,
    projects: sampleProjects.slice(0, 2),
    timelines: sampleTimelines.slice(0, 2),
  },
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">📱 Minimal Projects</h3>
          <p className="text-sm text-gray-600 mb-4">
            Mobile sidebar with minimal project and timeline options.
          </p>
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="btn btn-primary"
          >
            {isOpen ? 'Close' : 'Open'} Mobile Sidebar
          </button>
        </div>
        
        <MobileSidebar 
          {...args} 
          isOpen={isOpen} 
          onClose={() => setIsOpen(false)}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar with minimal project and timeline options.',
      },
    },
  },
};

export const NoActiveTasks: Story = {
  args: {
    ...defaultArgs,
    activeTasks: [],
  },
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">📱 No Active Tasks</h3>
          <p className="text-sm text-gray-600 mb-4">
            Mobile sidebar with no active tasks to display.
          </p>
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="btn btn-primary"
          >
            {isOpen ? 'Close' : 'Open'} Mobile Sidebar
          </button>
        </div>
        
        <MobileSidebar 
          {...args} 
          isOpen={isOpen} 
          onClose={() => setIsOpen(false)}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar with no active tasks to display.',
      },
    },
  },
};

export const HighPriorityTasks: Story = {
  args: {
    ...defaultArgs,
    activeTasks: sampleTasks.filter(task => task.priority === 'high'),
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar showing only high priority tasks.',
      },
    },
  },
};

export const LightTheme: Story = {
  args: {
    ...defaultArgs,
    currentTheme: 'light',
  },
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">📱 Light Theme</h3>
          <p className="text-sm text-gray-600 mb-4">
            Mobile sidebar with light theme selected.
          </p>
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="btn btn-primary"
          >
            {isOpen ? 'Close' : 'Open'} Mobile Sidebar
          </button>
        </div>
        
        <MobileSidebar 
          {...args} 
          isOpen={isOpen} 
          onClose={() => setIsOpen(false)}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar with light theme selected.',
      },
    },
  },
};

export const CyberpunkTheme: Story = {
  args: {
    ...defaultArgs,
    currentTheme: 'cyberpunk',
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar with cyberpunk theme selected.',
      },
    },
  },
};

export const SingleProject: Story = {
  args: {
    ...defaultArgs,
    projects: [sampleProjects[0]],
    timelines: [sampleTimelines[0]],
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar with single project and timeline (selectors still shown).',
      },
    },
  },
};

export const ManyTasks: Story = {
  args: {
    ...defaultArgs,
    activeTasks: [
      ...sampleTasks,
      ...Array.from({ length: 5 }, (_, i) => ({
        id: i + 10,
        title: `Additional Task ${i + 1}`,
        description: `Task description ${i + 1}`,
        priority: ['high', 'medium', 'low'][i % 3] as Task['priority'],
        assignee: ['Claude', 'Human'][i % 2],
        status: 'pending' as const,
      })),
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Mobile sidebar with many tasks (only first 3 shown in preview).',
      },
    },
  },
};

export const InteractionDemo: Story = {
  args: defaultArgs,
  render: (args) => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">📱 MobileSidebar Interactive Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Mobile-optimized navigation with touch-friendly controls!
        </p>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Interaction Guide:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Project/Timeline</strong> - Use dropdowns to switch context</li>
          <li>• <strong>Quick Actions</strong> - Tap any action button to trigger tools</li>
          <li>• <strong>Tasks</strong> - Tap task cards to view details</li>
          <li>• <strong>Themes</strong> - Tap theme colors to change appearance</li>
          <li>• <strong>Close</strong> - Tap backdrop or close button to dismiss</li>
        </ul>
      </div>
      
      <MobileSidebar {...args} />
      
      <div className="bg-green-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">MobileSidebar Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Overlay Presentation</strong> - Full-screen modal with backdrop</li>
          <li>• <strong>Animated Transitions</strong> - Smooth slide-in from left</li>
          <li>• <strong>Project Management</strong> - Quick project/timeline switching</li>
          <li>• <strong>Quick Actions</strong> - One-tap access to common tools</li>
          <li>• <strong>Task Preview</strong> - Active tasks with priority indicators</li>
          <li>• <strong>Theme Switching</strong> - Visual theme selection</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing the complete MobileSidebar mobile navigation organism.',
      },
    },
  },
};

export const AnimationDemo: Story = {
  args: {
    ...defaultArgs,
    isOpen: false,
  },
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">🎬 Animation Demo</h3>
          <p className="text-sm text-gray-600 mb-4">
            Watch the smooth slide-in animation!
          </p>
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="btn btn-primary"
          >
            {isOpen ? 'Close' : 'Open'} Mobile Sidebar
          </button>
        </div>
        
        <MobileSidebar 
          {...args} 
          isOpen={isOpen} 
          onClose={() => setIsOpen(false)}
        />
        
        <div className="bg-purple-50 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Animation Features:</h4>
          <ul className="text-sm space-y-1">
            <li>• <strong>Slide Transition</strong> - Smooth left-to-right animation</li>
            <li>• <strong>Backdrop Fade</strong> - Overlay appears with fade effect</li>
            <li>• <strong>Transform Animation</strong> - CSS transform for performance</li>
            <li>• <strong>Easing</strong> - Smooth ease-out timing function</li>
          </ul>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Demo showing the slide-in animation when opening the mobile sidebar.',
      },
    },
  },
};