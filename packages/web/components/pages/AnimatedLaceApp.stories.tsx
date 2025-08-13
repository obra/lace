// ABOUTME: Storybook story for AnimatedLaceApp.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedLaceApp } from './AnimatedLaceApp';
import { asThreadId } from '@/types/core';
import type { Timeline, RecentFile } from '@/types/design-system';
import type { ProjectInfo as Project, Task } from '@/types/core';

// Mock data for stories
const mockProjects: Project[] = [
  {
    id: 'ai-research-project',
    name: 'AI Research',
    description: 'Advanced AI research and development project',
    workingDirectory: '/projects/ai-research',
    isArchived: false,
    createdAt: new Date('2024-01-01T08:00:00Z'),
    lastUsedAt: new Date('2024-01-15T10:00:00Z'),
    sessionCount: 42,
  },
  {
    id: 'web-app-project',
    name: 'Web App',
    description: 'Full-stack web application development',
    workingDirectory: '/projects/webapp',
    isArchived: false,
    createdAt: new Date('2023-12-20T10:00:00Z'),
    lastUsedAt: new Date('2024-01-14T15:30:00Z'),
    sessionCount: 28,
  },
  {
    id: 'data-pipeline-project',
    name: 'Data Pipeline',
    description: 'ETL data processing pipeline',
    workingDirectory: '/projects/data-pipeline',
    isArchived: false,
    createdAt: new Date('2023-11-15T12:00:00Z'),
    lastUsedAt: new Date('2024-01-13T09:15:00Z'),
    sessionCount: 32,
  },
];

const mockCurrentProject: Project = mockProjects[0];

const mockTimelines: Timeline[] = [
  { id: 2, name: 'Code Review', agent: 'Claude' },
  { id: 3, name: 'Research', agent: 'Gemini' },
  { id: 4, name: 'Testing', agent: 'Claude' },
  { id: 5, name: 'Data Analysis', agent: 'GPT-4' },
];

const mockCurrentTimeline: Timeline = { id: 1, name: 'Main Dev', agent: 'Claude' };

const mockRecentFiles: RecentFile[] = [
  { name: 'app.py', path: '/src/app.py' },
  { name: 'config.yaml', path: '/config/config.yaml' },
  { name: 'README.md', path: '/README.md' },
  { name: 'test_models.py', path: '/tests/test_models.py' },
];

const mockTasks: Task[] = [
  {
    id: 'animated-task-001',
    title: 'AI Model Integration',
    description: 'Integrate latest language model',
    prompt:
      'Integrate the latest language model API with our existing codebase, ensuring proper error handling and performance optimization',
    priority: 'high',
    assignedTo: asThreadId('lace_20240115_claude001'),
    status: 'in_progress',
    createdBy: asThreadId('lace_20240115_session001'),
    threadId: asThreadId('lace_20240115_session001'),
    createdAt: new Date('2024-01-15T09:00:00Z'),
    updatedAt: new Date('2024-01-15T10:30:00Z'),
    notes: [],
  },
  {
    id: 'animated-task-002',
    title: 'Auth Bug Fix',
    description: 'Fix login timeout',
    prompt:
      'Investigate and fix the authentication timeout issue occurring in production environment',
    priority: 'medium',
    assignedTo: undefined,
    status: 'pending',
    createdBy: asThreadId('lace_20240115_session001'),
    threadId: asThreadId('lace_20240115_session001'),
    createdAt: new Date('2024-01-14T14:00:00Z'),
    updatedAt: new Date('2024-01-14T14:00:00Z'),
    notes: [],
  },
  {
    id: 'animated-task-003',
    title: 'Update Docs',
    description: 'API documentation',
    prompt:
      'Update the API documentation to reflect the recent changes in authentication endpoints and response formats',
    priority: 'low',
    assignedTo: asThreadId('lace_20240115_claude001'),
    status: 'blocked',
    createdBy: asThreadId('lace_20240115_session001'),
    threadId: asThreadId('lace_20240115_session001'),
    createdAt: new Date('2024-01-13T16:00:00Z'),
    updatedAt: new Date('2024-01-13T16:30:00Z'),
    notes: [],
  },
];

const meta: Meta<typeof AnimatedLaceApp> = {
  title: 'Pages/AnimatedLaceApp',
  component: AnimatedLaceApp,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Enhanced animated version of the main Lace application with Framer Motion animations, smooth transitions, and interactive elements. Features animated timeline view, voice recognition, task management, and comprehensive UI animations.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnimatedLaceApp>;

export const Default: Story = {
  args: {
    initialProjects: mockProjects,
    initialCurrentProject: mockCurrentProject,
    initialTimelines: mockTimelines,
    initialCurrentTimeline: mockCurrentTimeline,
    initialTasks: mockTasks,
    initialRecentFiles: mockRecentFiles,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Default animated Lace application with enhanced animations, transitions, and interactive features. Includes animated timeline, voice recognition, and task management.',
      },
    },
  },
};

export const MobileView: Story = {
  args: {
    initialProjects: mockProjects,
    initialCurrentProject: mockCurrentProject,
    initialTimelines: mockTimelines,
    initialCurrentTimeline: mockCurrentTimeline,
    initialTasks: mockTasks,
    initialRecentFiles: mockRecentFiles,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story:
          'Animated Lace application optimized for mobile devices with mobile sidebar, touch interactions, and responsive animations.',
      },
    },
  },
};

export const TabletView: Story = {
  args: {
    initialProjects: mockProjects,
    initialCurrentProject: mockCurrentProject,
    initialTimelines: mockTimelines,
    initialCurrentTimeline: mockCurrentTimeline,
    initialTasks: mockTasks,
    initialRecentFiles: mockRecentFiles,
  },
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
    docs: {
      description: {
        story:
          'Animated Lace application on tablet devices showing responsive layout transitions and touch-optimized interactions.',
      },
    },
  },
};

export const DarkTheme: Story = {
  args: {
    initialProjects: mockProjects,
    initialCurrentProject: mockCurrentProject,
    initialTimelines: mockTimelines,
    initialCurrentTimeline: mockCurrentTimeline,
    initialTasks: mockTasks,
    initialRecentFiles: mockRecentFiles,
  },
  parameters: {
    backgrounds: {
      default: 'dark',
    },
    docs: {
      description: {
        story:
          'Animated Lace application with dark theme showing theme-aware animations and color transitions.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="dark">
        <Story />
      </div>
    ),
  ],
};

export const LightTheme: Story = {
  args: {
    initialProjects: mockProjects,
    initialCurrentProject: mockCurrentProject,
    initialTimelines: mockTimelines,
    initialCurrentTimeline: mockCurrentTimeline,
    initialTasks: mockTasks,
    initialRecentFiles: mockRecentFiles,
  },
  parameters: {
    backgrounds: {
      default: 'light',
    },
    docs: {
      description: {
        story:
          'Animated Lace application with light theme showing bright, clean animations and transitions.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="light">
        <Story />
      </div>
    ),
  ],
};

export const CyberpunkTheme: Story = {
  args: {
    initialProjects: mockProjects,
    initialCurrentProject: mockCurrentProject,
    initialTimelines: mockTimelines,
    initialCurrentTimeline: mockCurrentTimeline,
    initialTasks: mockTasks,
    initialRecentFiles: mockRecentFiles,
  },
  parameters: {
    backgrounds: {
      default: 'dark',
    },
    docs: {
      description: {
        story:
          'Animated Lace application with cyberpunk theme featuring neon colors and futuristic animations.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div data-theme="cyberpunk">
        <Story />
      </div>
    ),
  ],
};
