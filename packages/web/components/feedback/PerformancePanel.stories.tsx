import type { Meta, StoryObj } from '@storybook/react';
import { PerformancePanel } from './PerformancePanel';
import { PerformanceAnalysis } from '@/feedback/types';

const meta: Meta<typeof PerformancePanel> = {
  title: 'Organisms/PerformancePanel',
  component: PerformancePanel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Performance analysis panel for contextual feedback. Displays performance metrics, trends, and resource usage including response times, tool efficiency, conversation flow, and resource consumption.',
      },
    },
  },
  argTypes: {
    analysis: {
      description: 'Performance analysis data to display',
      control: false,
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PerformancePanel>;

// Base performance analysis
const baseAnalysis: PerformanceAnalysis = {
  responseTimeAnalysis: {
    current: 1250,
    average: 1800,
    percentile95: 3200,
    trend: 'improving',
  },
  toolEfficiency: [
    {
      toolName: 'file_read',
      successRate: 0.95,
      averageTime: 800,
      errorPatterns: ['file_not_found', 'permission_denied'],
    },
    {
      toolName: 'code_edit',
      successRate: 0.87,
      averageTime: 2100,
      errorPatterns: ['syntax_error', 'merge_conflict'],
    },
    {
      toolName: 'bash_exec',
      successRate: 0.92,
      averageTime: 1500,
      errorPatterns: ['command_not_found'],
    },
  ],
  conversationFlow: {
    turnsPerMinute: 2.3,
    contextSwitches: 5,
    backtrackingEvents: 2,
  },
  resourceUsage: {
    tokenUsage: 45600,
    tokenEfficiency: 234.5,
    costEstimate: 0.0876,
  },
};

export const Default: Story = {
  args: {
    analysis: baseAnalysis,
  },
  parameters: {
    docs: {
      description: {
        story: 'Default performance panel showing comprehensive metrics and analysis.',
      },
    },
  },
};

export const FastPerformance: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      responseTimeAnalysis: {
        current: 450,
        average: 680,
        percentile95: 1200,
        trend: 'improving',
      },
      toolEfficiency: [
        {
          toolName: 'file_read',
          successRate: 0.98,
          averageTime: 300,
          errorPatterns: [],
        },
        {
          toolName: 'code_edit',
          successRate: 0.95,
          averageTime: 650,
          errorPatterns: ['syntax_error'],
        },
        {
          toolName: 'bash_exec',
          successRate: 0.96,
          averageTime: 400,
          errorPatterns: [],
        },
      ],
      conversationFlow: {
        turnsPerMinute: 3.8,
        contextSwitches: 2,
        backtrackingEvents: 0,
      },
      resourceUsage: {
        tokenUsage: 28400,
        tokenEfficiency: 156.2,
        costEstimate: 0.0523,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'High-performance scenario with fast response times and efficient resource usage.',
      },
    },
  },
};

export const SlowPerformance: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      responseTimeAnalysis: {
        current: 4800,
        average: 3600,
        percentile95: 8500,
        trend: 'degrading',
      },
      toolEfficiency: [
        {
          toolName: 'file_read',
          successRate: 0.78,
          averageTime: 2100,
          errorPatterns: ['file_not_found', 'permission_denied', 'timeout'],
        },
        {
          toolName: 'code_edit',
          successRate: 0.65,
          averageTime: 4200,
          errorPatterns: ['syntax_error', 'merge_conflict', 'validation_error'],
        },
        {
          toolName: 'bash_exec',
          successRate: 0.72,
          averageTime: 3800,
          errorPatterns: ['command_not_found', 'timeout', 'permission_denied'],
        },
      ],
      conversationFlow: {
        turnsPerMinute: 1.2,
        contextSwitches: 12,
        backtrackingEvents: 8,
      },
      resourceUsage: {
        tokenUsage: 89600,
        tokenEfficiency: 445.8,
        costEstimate: 0.1854,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Poor performance scenario with slow response times and high resource usage.',
      },
    },
  },
};

export const StablePerformance: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      responseTimeAnalysis: {
        current: 1800,
        average: 1850,
        percentile95: 2400,
        trend: 'stable',
      },
      toolEfficiency: [
        {
          toolName: 'file_read',
          successRate: 0.91,
          averageTime: 900,
          errorPatterns: ['file_not_found'],
        },
        {
          toolName: 'code_edit',
          successRate: 0.89,
          averageTime: 1800,
          errorPatterns: ['syntax_error'],
        },
        {
          toolName: 'bash_exec',
          successRate: 0.88,
          averageTime: 1600,
          errorPatterns: ['command_not_found'],
        },
      ],
      conversationFlow: {
        turnsPerMinute: 2.1,
        contextSwitches: 6,
        backtrackingEvents: 3,
      },
      resourceUsage: {
        tokenUsage: 52300,
        tokenEfficiency: 267.3,
        costEstimate: 0.1045,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Stable performance with consistent metrics and steady resource usage.',
      },
    },
  },
};

export const HighTokenUsage: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      resourceUsage: {
        tokenUsage: 1250000,
        tokenEfficiency: 567.8,
        costEstimate: 2.1345,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'High token usage scenario showing large numbers formatted appropriately.',
      },
    },
  },
};

export const MinimalTokenUsage: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      resourceUsage: {
        tokenUsage: 850,
        tokenEfficiency: 45.2,
        costEstimate: 0.0023,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Low token usage scenario with minimal resource consumption.',
      },
    },
  },
};

export const NoCostEstimate: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      resourceUsage: {
        tokenUsage: 32400,
        tokenEfficiency: 189.6,
        costEstimate: undefined,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Performance panel without cost estimate showing fallback layout.',
      },
    },
  },
};

export const HighErrorRate: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      toolEfficiency: [
        {
          toolName: 'file_read',
          successRate: 0.45,
          averageTime: 1200,
          errorPatterns: ['file_not_found', 'permission_denied', 'timeout', 'corrupted_file'],
        },
        {
          toolName: 'code_edit',
          successRate: 0.38,
          averageTime: 2800,
          errorPatterns: ['syntax_error', 'merge_conflict', 'validation_error', 'format_error'],
        },
        {
          toolName: 'bash_exec',
          successRate: 0.52,
          averageTime: 2200,
          errorPatterns: ['command_not_found', 'timeout', 'permission_denied'],
        },
      ],
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'High error rate scenario showing tools with multiple error patterns.',
      },
    },
  },
};

export const PerfectTools: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      toolEfficiency: [
        {
          toolName: 'file_read',
          successRate: 1.0,
          averageTime: 250,
          errorPatterns: [],
        },
        {
          toolName: 'code_edit',
          successRate: 0.99,
          averageTime: 480,
          errorPatterns: [],
        },
        {
          toolName: 'bash_exec',
          successRate: 0.98,
          averageTime: 320,
          errorPatterns: [],
        },
      ],
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Perfect tool performance with high success rates and no error patterns.',
      },
    },
  },
};

export const BusyConversation: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      conversationFlow: {
        turnsPerMinute: 5.7,
        contextSwitches: 18,
        backtrackingEvents: 12,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Busy conversation with high turn rate and frequent context switches.',
      },
    },
  },
};

export const SmoothConversation: Story = {
  args: {
    analysis: {
      ...baseAnalysis,
      conversationFlow: {
        turnsPerMinute: 1.8,
        contextSwitches: 1,
        backtrackingEvents: 0,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Smooth conversation flow with minimal context switches and no backtracking.',
      },
    },
  },
};

export const ComprehensiveAnalysis: Story = {
  args: {
    analysis: {
      responseTimeAnalysis: {
        current: 2100,
        average: 1950,
        percentile95: 3800,
        trend: 'stable',
      },
      toolEfficiency: [
        {
          toolName: 'file_read',
          successRate: 0.93,
          averageTime: 650,
          errorPatterns: ['file_not_found'],
        },
        {
          toolName: 'code_edit',
          successRate: 0.85,
          averageTime: 1800,
          errorPatterns: ['syntax_error', 'merge_conflict'],
        },
        {
          toolName: 'bash_exec',
          successRate: 0.89,
          averageTime: 1200,
          errorPatterns: ['command_not_found'],
        },
        {
          toolName: 'web_search',
          successRate: 0.97,
          averageTime: 2800,
          errorPatterns: ['rate_limit'],
        },
        {
          toolName: 'api_call',
          successRate: 0.91,
          averageTime: 1900,
          errorPatterns: ['timeout', 'auth_error'],
        },
      ],
      conversationFlow: {
        turnsPerMinute: 2.4,
        contextSwitches: 7,
        backtrackingEvents: 3,
      },
      resourceUsage: {
        tokenUsage: 67800,
        tokenEfficiency: 298.4,
        costEstimate: 0.1456,
      },
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'Comprehensive analysis with multiple tools and detailed metrics.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    analysis: baseAnalysis,
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showing all performance metrics and analysis features.',
      },
    },
  },
};