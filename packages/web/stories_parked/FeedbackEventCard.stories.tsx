/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for FeedbackEventCard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { FeedbackEventCard } from './FeedbackEventCard';
import { FeedbackEvent } from '@/feedback/types';

const meta: Meta<typeof FeedbackEventCard> = {
  title: 'Organisms/FeedbackEventCard',
  component: FeedbackEventCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Individual feedback event card component that displays a single feedback event with contextual styling and information. Supports compact mode and expandable context details.',
      },
    },
  },
  argTypes: {
    event: {
      description: 'The feedback event to display',
      control: false,
    },
    showContext: {
      description: 'Whether to show expandable context details',
      control: 'boolean',
    },
    compact: {
      description: 'Whether to use compact display mode',
      control: 'boolean',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FeedbackEventCard>;

// Base event template
const baseEvent = {
  id: '1',
  timestamp: new Date(Date.now() - 300000), // 5 minutes ago
  context: {
    threadId: 'lace_20250101_thrd01',
    agentState: 'thinking',
    currentTool: 'file_read',
    turnMetrics: {
      startTime: new Date(Date.now() - 1250),
      elapsedMs: 1250,
      tokensIn: 120,
      tokensOut: 185,
      turnId: 'turn-456',
    },
  },
  metadata: {
    confidence: 0.85,
    source: 'pattern_detector',
    version: '1.0.0',
  },
};

export const ActionEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'action',
      priority: 'high',
      title: 'Quick Action Available',
      content:
        'You can optimize this code by extracting the common validation logic into a reusable function.',
      tags: ['optimization', 'refactoring', 'code-quality'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Action event card with high priority and optimization suggestions.',
      },
    },
  },
};

export const PerformanceEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'performance',
      priority: 'medium',
      title: 'Performance Insight',
      content:
        'The TimelineView component is re-rendering frequently. Consider memoizing expensive calculations.',
      tags: ['performance', 'react', 'optimization'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Performance event showing rendering optimization suggestions.',
      },
    },
  },
};

export const EducationalEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'educational',
      priority: 'low',
      title: 'Learning Opportunity',
      content:
        "Did you know? TypeScript's strict mode can help catch common errors at compile time. Consider enabling it for better type safety.",
      tags: ['typescript', 'learning', 'best-practices'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Educational event providing learning opportunities and best practices.',
      },
    },
  },
};

export const PredictiveEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'predictive',
      priority: 'high',
      title: 'Potential Issue Ahead',
      content:
        'Based on current patterns, this component might have memory leaks. Consider adding cleanup in useEffect.',
      tags: ['prediction', 'memory-leak', 'react-hooks'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Predictive event warning about potential future issues.',
      },
    },
  },
};

export const ErrorEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'error',
      priority: 'high',
      title: 'Error Detected',
      content:
        'Unhandled promise rejection in async function. This could cause the application to crash.',
      tags: ['error', 'promise', 'async'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Error event highlighting critical issues that need immediate attention.',
      },
    },
  },
};

export const OptimizationEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'optimization',
      priority: 'medium',
      title: 'Optimization Opportunity',
      content:
        'Bundle size can be reduced by 15% by implementing tree shaking for unused utility functions.',
      tags: ['optimization', 'bundle-size', 'tree-shaking'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Optimization event suggesting ways to improve code efficiency.',
      },
    },
  },
};

export const InsightEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'insight',
      priority: 'medium',
      title: 'Development Insight',
      content:
        'You tend to write longer functions on Fridays. Consider breaking down complex logic into smaller, more testable functions.',
      tags: ['insight', 'patterns', 'code-quality'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Insight event providing personalized development patterns and suggestions.',
      },
    },
  },
};

export const CelebrationEvent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'celebration',
      priority: 'low',
      title: 'Great Work!',
      content:
        "You've successfully implemented error boundaries across all major components. This will greatly improve user experience!",
      tags: ['celebration', 'milestone', 'error-handling'],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Celebration event acknowledging achievements and milestones.',
      },
    },
  },
};

export const WithContext: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'action',
      priority: 'high',
      title: 'Context-Rich Event',
      content:
        'This event includes detailed context information that can be expanded for debugging.',
      tags: ['context', 'debugging', 'detailed'],
    },
    showContext: true,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Event card with expandable context details showing thread information, agent state, and metadata.',
      },
    },
  },
};

export const CompactMode: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'performance',
      priority: 'medium',
      title: 'Compact Event',
      content: 'This is how the event appears in compact mode for dense layouts.',
      tags: ['compact', 'layout'],
    },
    showContext: false,
    compact: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Compact version of the event card suitable for dense layouts and lists.',
      },
    },
  },
};

export const NoTags: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'insight',
      priority: 'low',
      title: 'Simple Event',
      content: 'This event has no tags and shows the minimal layout.',
      tags: [],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Event card without tags showing the minimal layout.',
      },
    },
  },
};

export const LongContent: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'educational',
      priority: 'medium',
      title: 'Detailed Learning Content',
      content:
        'This is a longer educational event that demonstrates how the card handles extended content. It includes multiple sentences and provides comprehensive information about React performance optimization techniques, including the use of useMemo, useCallback, and React.memo for preventing unnecessary re-renders in complex component hierarchies.',
      tags: [
        'education',
        'react',
        'performance',
        'optimization',
        'useMemo',
        'useCallback',
        'React.memo',
      ],
    },
    showContext: false,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Event card with longer content and multiple tags demonstrating text wrapping and tag layout.',
      },
    },
  },
};

export const AllPriorities: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">High Priority</h3>
      <FeedbackEventCard
        event={{
          ...baseEvent,
          type: 'error',
          priority: 'high',
          title: 'Critical Error',
          content: 'This is a high priority error event.',
          tags: ['error', 'critical'],
        }}
      />

      <h3 className="text-lg font-semibold">Medium Priority</h3>
      <FeedbackEventCard
        event={{
          ...baseEvent,
          type: 'performance',
          priority: 'medium',
          title: 'Performance Issue',
          content: 'This is a medium priority performance event.',
          tags: ['performance', 'optimization'],
        }}
      />

      <h3 className="text-lg font-semibold">Low Priority</h3>
      <FeedbackEventCard
        event={{
          ...baseEvent,
          type: 'educational',
          priority: 'low',
          title: 'Learning Tip',
          content: 'This is a low priority educational event.',
          tags: ['education', 'tip'],
        }}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of all priority levels showing different visual indicators.',
      },
    },
  },
};

export const AllTypes: Story = {
  render: () => (
    <div className="space-y-4">
      {[
        { type: 'action' as const, title: 'Action Event', content: 'Quick action available' },
        {
          type: 'performance' as const,
          title: 'Performance Event',
          content: 'Performance optimization suggestion',
        },
        {
          type: 'educational' as const,
          title: 'Educational Event',
          content: 'Learning opportunity',
        },
        {
          type: 'predictive' as const,
          title: 'Predictive Event',
          content: 'Potential future issue',
        },
        { type: 'error' as const, title: 'Error Event', content: 'Critical error detected' },
        {
          type: 'optimization' as const,
          title: 'Optimization Event',
          content: 'Code optimization opportunity',
        },
        {
          type: 'insight' as const,
          title: 'Insight Event',
          content: 'Development pattern insight',
        },
        {
          type: 'celebration' as const,
          title: 'Celebration Event',
          content: 'Achievement unlocked!',
        },
      ].map((eventData, index) => (
        <FeedbackEventCard
          key={index}
          event={{
            ...baseEvent,
            id: `event-${index}`,
            type: eventData.type,
            priority: 'medium',
            title: eventData.title,
            content: eventData.content,
            tags: [eventData.type, 'demo'],
          }}
        />
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all event types with their distinctive icons and colors.',
      },
    },
  },
};

export const CompactList: Story = {
  render: () => (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold mb-4">Compact Event List</h3>
      {[
        {
          type: 'action' as const,
          priority: 'high' as const,
          content: 'Quick action available for optimization',
        },
        {
          type: 'performance' as const,
          priority: 'medium' as const,
          content: 'Component re-render detected',
        },
        {
          type: 'educational' as const,
          priority: 'low' as const,
          content: 'Learning tip about TypeScript',
        },
        {
          type: 'error' as const,
          priority: 'high' as const,
          content: 'Unhandled promise rejection',
        },
        {
          type: 'celebration' as const,
          priority: 'low' as const,
          content: 'Test coverage milestone reached!',
        },
      ].map((eventData, index) => (
        <FeedbackEventCard
          key={index}
          event={{
            ...baseEvent,
            id: `compact-${index}`,
            type: eventData.type,
            priority: eventData.priority,
            title: `Event ${index + 1}`,
            content: eventData.content,
            tags: [eventData.type],
          }}
          compact={true}
        />
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'List of events in compact mode suitable for sidebar or dense layouts.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    event: {
      ...baseEvent,
      type: 'action',
      priority: 'high',
      title: 'Interactive Demo Event',
      content:
        'Try toggling the context and compact modes using the controls below to see how the card adapts.',
      tags: ['demo', 'interactive', 'storybook'],
    },
    showContext: true,
    compact: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showing all features including context expansion and compact mode toggle.',
      },
    },
  },
};
