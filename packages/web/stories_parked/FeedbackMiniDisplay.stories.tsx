/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for FeedbackMiniDisplay.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { FeedbackMiniDisplay } from './FeedbackMiniDisplay';
import { FeedbackEvent } from '@/feedback/types';

const meta: Meta<typeof FeedbackMiniDisplay> = {
  title: 'Organisms/FeedbackMiniDisplay',
  component: FeedbackMiniDisplay,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Compact feedback display for minimal UI space. Shows latest feedback events in a streamlined format with expandable view and priority filtering.',
      },
    },
  },
  argTypes: {
    events: {
      description: 'Array of feedback events to display',
      control: false,
    },
    maxEvents: {
      description: 'Maximum number of events to display initially',
      control: { type: 'number', min: 1, max: 10 },
    },
    showOnlyHighPriority: {
      description: 'Whether to show only high priority events',
      control: 'boolean',
    },
    className: {
      description: 'Additional CSS classes',
      control: 'text',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FeedbackMiniDisplay>;

// Sample events for stories
const sampleEvents: FeedbackEvent[] = [
  {
    id: '1',
    type: 'action',
    priority: 'high',
    title: 'Quick Action Available',
    content: 'You can optimize this component by memoizing expensive calculations.',
    timestamp: new Date(Date.now() - 60000), // 1 minute ago
    tags: ['optimization', 'performance'],
    context: {
      threadId: 'lace_20250101_thrd01',
      agentState: 'thinking',
      currentTool: 'code_analysis',
    },
  },
  {
    id: '2',
    type: 'performance',
    priority: 'medium',
    title: 'Performance Insight',
    content: 'Component re-renders detected in TimelineView.',
    timestamp: new Date(Date.now() - 120000), // 2 minutes ago
    tags: ['performance', 'react'],
    context: {
      threadId: 'lace_20250101_thrd01',
      agentState: 'analyzing',
      currentTool: 'performance_monitor',
    },
  },
  {
    id: '3',
    type: 'educational',
    priority: 'low',
    title: 'Learning Opportunity',
    content: 'TypeScript strict mode can help catch errors at compile time.',
    timestamp: new Date(Date.now() - 180000), // 3 minutes ago
    tags: ['typescript', 'learning'],
    context: {
      threadId: 'lace_20250101_thrd01',
      agentState: 'idle',
      currentTool: 'code_review',
    },
  },
  {
    id: '4',
    type: 'error',
    priority: 'high',
    title: 'Error Detected',
    content: 'Unhandled promise rejection in async function.',
    timestamp: new Date(Date.now() - 240000), // 4 minutes ago
    tags: ['error', 'async'],
    context: {
      threadId: 'lace_20250101_thrd01',
      agentState: 'analyzing',
      currentTool: 'error_detector',
    },
  },
  {
    id: '5',
    type: 'celebration',
    priority: 'low',
    title: 'Great Work!',
    content: 'Successfully implemented error boundaries across components.',
    timestamp: new Date(Date.now() - 300000), // 5 minutes ago
    tags: ['celebration', 'milestone'],
    context: {
      threadId: 'lace_20250101_thrd01',
      agentState: 'idle',
      currentTool: 'achievement_tracker',
    },
  },
  {
    id: '6',
    type: 'optimization',
    priority: 'medium',
    title: 'Bundle Size Optimization',
    content: 'Consider implementing tree shaking for utility functions.',
    timestamp: new Date(Date.now() - 360000), // 6 minutes ago
    tags: ['optimization', 'bundle'],
    context: {
      threadId: 'lace_20250101_thrd01',
      agentState: 'analyzing',
      currentTool: 'bundle_analyzer',
    },
  },
];

export const Default: Story = {
  args: {
    events: sampleEvents,
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Default mini display showing latest 3 events with expandable view.',
      },
    },
  },
};

export const HighPriorityOnly: Story = {
  args: {
    events: sampleEvents,
    maxEvents: 3,
    showOnlyHighPriority: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display filtered to show only high priority events.',
      },
    },
  },
};

export const SingleEvent: Story = {
  args: {
    events: [sampleEvents[0]],
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display with only one event showing minimal layout.',
      },
    },
  },
};

export const TwoEvents: Story = {
  args: {
    events: sampleEvents.slice(0, 2),
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display with two events showing typical usage.',
      },
    },
  },
};

export const MaxEventsLimit: Story = {
  args: {
    events: sampleEvents,
    maxEvents: 2,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display with maxEvents set to 2, showing expand/collapse functionality.',
      },
    },
  },
};

export const LargeEventList: Story = {
  args: {
    events: sampleEvents,
    maxEvents: 4,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display with larger event list demonstrating scrolling and expansion.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    events: [],
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state when no events are available (component returns null).',
      },
    },
  },
};

export const ErrorsOnly: Story = {
  args: {
    events: sampleEvents.filter((event) => event.type === 'error'),
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display showing only error events for focused debugging.',
      },
    },
  },
};

export const PerformanceOnly: Story = {
  args: {
    events: sampleEvents.filter((event) => event.type === 'performance'),
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display showing only performance events for optimization focus.',
      },
    },
  },
};

export const ActionableEvents: Story = {
  args: {
    events: sampleEvents.filter((event) => event.type === 'action'),
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display showing only actionable events for immediate attention.',
      },
    },
  },
};

export const MixedPriorities: Story = {
  args: {
    events: [
      { ...sampleEvents[0], priority: 'high' },
      { ...sampleEvents[1], priority: 'medium' },
      { ...sampleEvents[2], priority: 'low' },
      { ...sampleEvents[3], priority: 'high' },
    ],
    maxEvents: 4,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display with mixed priority events showing different visual indicators.',
      },
    },
  },
};

export const RecentActivity: Story = {
  args: {
    events: sampleEvents.map((event, index) => ({
      ...event,
      timestamp: new Date(Date.now() - index * 30000), // 30 seconds apart
    })),
    maxEvents: 5,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display with recent activity showing time-based ordering.',
      },
    },
  },
};

export const CompactLayout: Story = {
  args: {
    events: sampleEvents.slice(0, 4),
    maxEvents: 2,
    showOnlyHighPriority: false,
    className: 'max-w-xs',
  },
  parameters: {
    docs: {
      description: {
        story: 'Mini display in compact layout suitable for narrow sidebars.',
      },
    },
  },
};

export const SidebarIntegration: Story = {
  render: () => (
    <div className="w-64 bg-gray-50 p-4 rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Development Sidebar</h2>
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Project Status</h3>
          <div className="text-sm text-gray-600">All systems operational</div>
        </div>
        <FeedbackMiniDisplay events={sampleEvents} maxEvents={3} showOnlyHighPriority={false} />
        <div>
          <h3 className="text-sm font-medium mb-2">Quick Actions</h3>
          <button className="text-sm text-blue-600 hover:text-blue-700">Run Tests</button>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Mini display integrated into a sidebar layout showing contextual placement.',
      },
    },
  },
};

export const Dashboard: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white p-4 rounded-lg border">
        <h3 className="font-semibold mb-3">High Priority Feedback</h3>
        <FeedbackMiniDisplay events={sampleEvents} maxEvents={3} showOnlyHighPriority={true} />
      </div>
      <div className="bg-white p-4 rounded-lg border">
        <h3 className="font-semibold mb-3">All Recent Feedback</h3>
        <FeedbackMiniDisplay events={sampleEvents} maxEvents={4} showOnlyHighPriority={false} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Dashboard layout with multiple mini displays showing different filtering options.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    events: sampleEvents,
    maxEvents: 3,
    showOnlyHighPriority: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showing expandable functionality and priority filtering controls.',
      },
    },
  },
};
