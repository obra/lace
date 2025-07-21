import type { Meta, StoryObj } from '@storybook/react';
import { FeedbackDisplay } from './FeedbackDisplay';
import { FeedbackEvent, FeedbackInsight, PerformanceAnalysis, PredictiveInsight } from '@/feedback/types';

const meta: Meta<typeof FeedbackDisplay> = {
  title: 'Organisms/FeedbackDisplay',
  component: FeedbackDisplay,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Main feedback display component for contextual feedback system. Renders feedback events, insights, and performance analysis in real-time with tabbed navigation, filtering, and comprehensive analytics.',
      },
    },
  },
  argTypes: {
    events: {
      description: 'Array of feedback events to display',
      control: false,
    },
    insights: {
      description: 'Array of feedback insights',
      control: false,
    },
    performanceAnalysis: {
      description: 'Performance analysis data',
      control: false,
    },
    predictiveInsights: {
      description: 'Array of predictive insights',
      control: false,
    },
    showPerformanceMetrics: {
      description: 'Whether to show performance metrics tab',
      control: 'boolean',
    },
    showPredictions: {
      description: 'Whether to show predictions tab',
      control: 'boolean',
    },
    showInsights: {
      description: 'Whether to show insights tab',
      control: 'boolean',
    },
    maxEventsShown: {
      description: 'Maximum number of events to display',
      control: { type: 'number', min: 1, max: 50 },
    },
    className: {
      description: 'Additional CSS classes',
      control: 'text',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FeedbackDisplay>;

// Sample feedback events
const sampleEvents: FeedbackEvent[] = [
  {
    id: '1',
    type: 'optimization',
    title: 'Code Quality Improvement',
    content: 'Detected unused imports in src/components/ui/Button.tsx',
    timestamp: new Date(Date.now() - 300000),
    priority: 'medium',
    tags: ['code-quality', 'imports'],
    context: {
      threadId: 'main',
      currentTool: 'code_analysis',
    },
  },
  {
    id: '2',
    type: 'performance',
    title: 'Performance Optimization',
    content: 'Large component re-renders detected in TimelineView',
    timestamp: new Date(Date.now() - 240000),
    priority: 'high',
    tags: ['performance', 'react'],
    context: {
      threadId: 'main',
      currentTool: 'performance_monitor',
    },
  },
  {
    id: '3',
    type: 'optimization',
    title: 'Accessibility Issue',
    content: 'Missing alt text for images in carousel component',
    timestamp: new Date(Date.now() - 180000),
    priority: 'medium',
    tags: ['accessibility', 'images'],
    context: {
      threadId: 'main',
      currentTool: 'accessibility_checker',
    },
  },
  {
    id: '4',
    type: 'error',
    title: 'Security Alert',
    content: 'Potential XSS vulnerability in user input handling',
    timestamp: new Date(Date.now() - 120000),
    priority: 'high',
    tags: ['security', 'xss'],
    context: {
      threadId: 'main',
      currentTool: 'security_scanner',
    },
  },
  {
    id: '5',
    type: 'insight',
    title: 'Test Coverage',
    content: 'Low test coverage in authentication module',
    timestamp: new Date(Date.now() - 60000),
    priority: 'low',
    tags: ['testing', 'coverage'],
    context: {
      threadId: 'main',
      currentTool: 'test_analyzer',
    },
  },
];

// Sample insights
const sampleInsights: FeedbackInsight[] = [
  {
    id: '1',
    category: 'pattern',
    title: 'Development Pattern Insight',
    description: 'You frequently modify components without updating tests',
    confidence: 0.85,
    actionable: true,
    recommendations: [
      'Consider test-driven development approach',
      'Set up pre-commit hooks for test validation',
      'Create component test templates',
    ],
    impact: 'medium',
  },
  {
    id: '2',
    category: 'performance',
    title: 'Productivity Insight',
    description: 'Most productive hours are between 9-11 AM',
    confidence: 0.92,
    actionable: true,
    recommendations: [
      'Schedule complex tasks during peak hours',
      'Use afternoon for code reviews and documentation',
      'Consider pair programming in the morning',
    ],
    impact: 'high',
  },
  {
    id: '3',
    category: 'optimization',
    title: 'Code Quality Insight',
    description: 'Consistent use of TypeScript strict mode improves code quality',
    confidence: 0.78,
    actionable: true,
    recommendations: [
      'Enable strict mode in all new projects',
      'Gradually migrate existing code to strict mode',
      'Use ESLint rules for TypeScript best practices',
    ],
    impact: 'high',
  },
];

// Sample performance analysis
const samplePerformanceAnalysis: PerformanceAnalysis = {
  responseTimeAnalysis: {
    current: 450,
    average: 450,
    trend: 'stable',
    percentile95: 890,
  },
  toolEfficiency: [
    {
      toolName: 'TimelineView',
      successRate: 0.95,
      averageTime: 1200,
      errorPatterns: ['component_render', 'large lists'],
    },
    {
      toolName: 'api_call',
      successRate: 0.88,
      averageTime: 890,
      errorPatterns: ['/api/messages', 'timeout'],
    },
  ],
  conversationFlow: {
    turnsPerMinute: 2.5,
    contextSwitches: 5,
    backtrackingEvents: 1,
  },
  resourceUsage: {
    tokenUsage: 2400,
    tokenEfficiency: 0.85,
    costEstimate: 0.024,
  },
};

// Sample predictive insights
const samplePredictiveInsights: PredictiveInsight[] = [
  {
    prediction: 'Current velocity suggests tech debt will impact delivery in 2 weeks',
    confidence: 0.73,
    timeframe: 'medium',
    factors: ['increasing complexity', 'decreasing velocity', 'technical debt accumulation'],
    actionable: true,
    preventionSuggestions: [
      'Allocate 20% of sprint capacity to refactoring',
      'Prioritize high-impact debt items',
      'Schedule architecture review session',
    ],
  },
  {
    prediction: 'Memory usage trends indicate potential performance issues',
    confidence: 0.81,
    timeframe: 'short',
    factors: ['increasing memory usage', 'large component tree', 'memory leaks'],
    actionable: true,
    preventionSuggestions: [
      'Review memory-intensive components',
      'Implement performance monitoring',
      'Consider code splitting for large bundles',
    ],
  },
];

export const Default: Story = {
  args: {
    events: sampleEvents,
    insights: sampleInsights,
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights,
    showPerformanceMetrics: true,
    showPredictions: false,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Default feedback display with events, insights, and performance analysis tabs.',
      },
    },
  },
};

export const EventsOnly: Story = {
  args: {
    events: sampleEvents,
    insights: [],
    predictiveInsights: [],
    showPerformanceMetrics: false,
    showPredictions: false,
    showInsights: false,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Feedback display showing only events with filtering and type counts.',
      },
    },
  },
};

export const WithPredictions: Story = {
  args: {
    events: sampleEvents,
    insights: sampleInsights,
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights,
    showPerformanceMetrics: true,
    showPredictions: true,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Complete feedback display with all tabs including predictive insights.',
      },
    },
  },
};

export const LimitedEvents: Story = {
  args: {
    events: sampleEvents,
    insights: sampleInsights,
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights,
    showPerformanceMetrics: true,
    showPredictions: false,
    showInsights: true,
    maxEventsShown: 3,
  },
  parameters: {
    docs: {
      description: {
        story: 'Feedback display with limited number of events shown (3 max).',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    events: [],
    insights: [],
    predictiveInsights: [],
    showPerformanceMetrics: false,
    showPredictions: false,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state when no feedback data is available.',
      },
    },
  },
};

export const HighSeverityEvents: Story = {
  args: {
    events: sampleEvents.filter(event => event.priority === 'high'),
    insights: sampleInsights,
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights,
    showPerformanceMetrics: true,
    showPredictions: false,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Feedback display filtered to show only high-severity events.',
      },
    },
  },
};

export const PerformanceFocused: Story = {
  args: {
    events: sampleEvents.filter(event => event.type === 'performance'),
    insights: sampleInsights.filter(insight => insight.category === 'performance'),
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights.filter(insight => 
      insight.prediction.toLowerCase().includes('performance')),
    showPerformanceMetrics: true,
    showPredictions: true,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Performance-focused feedback display with relevant events, insights, and predictions.',
      },
    },
  },
};

export const SecurityFocused: Story = {
  args: {
    events: [
      ...sampleEvents.filter(event => event.type === 'error' && event.tags.includes('security')),
      {
        id: '6',
        type: 'error',
        title: 'Dependency Vulnerability',
        content: 'Outdated package with known security vulnerabilities',
        timestamp: new Date(Date.now() - 90000),
        priority: 'high',
        tags: ['security', 'dependency'],
        context: {
          threadId: 'main',
          currentTool: 'security_scanner',
        },
        metadata: {
          package: 'lodash@4.17.15',
          vulnerability: 'CVE-2021-23337',
          suggestion: 'Update to lodash@4.17.21 or later',
        },
      },
      {
        id: '7',
        type: 'error',
        title: 'Insecure API Endpoint',
        content: 'API endpoint missing authentication',
        timestamp: new Date(Date.now() - 30000),
        priority: 'high',
        tags: ['security', 'api'],
        context: {
          threadId: 'main',
          currentTool: 'security_scanner',
        },
        metadata: {
          endpoint: '/api/admin/users',
          issue: 'No authentication middleware',
          suggestion: 'Add authentication middleware to protect endpoint',
        },
      },
    ],
    insights: [],
    predictiveInsights: [],
    showPerformanceMetrics: false,
    showPredictions: false,
    showInsights: false,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Security-focused feedback display showing security-related events and alerts.',
      },
    },
  },
};

export const DevelopmentWorkflow: Story = {
  args: {
    events: [
      {
        id: '8',
        type: 'optimization',
        title: 'Code Review Feedback',
        content: 'Pull request #123 needs attention',
        timestamp: new Date(Date.now() - 150000),
        priority: 'medium',
        tags: ['code-quality', 'review'],
        context: {
          threadId: 'main',
          currentTool: 'code_review',
        },
        metadata: {
          pr: 123,
          reviewer: 'senior-dev',
          suggestion: 'Address comments about error handling',
        },
      },
      {
        id: '9',
        type: 'error',
        title: 'Test Failure',
        content: 'Unit test failing in CI pipeline',
        timestamp: new Date(Date.now() - 100000),
        priority: 'high',
        tags: ['testing', 'ci'],
        context: {
          threadId: 'main',
          currentTool: 'test_runner',
        },
        metadata: {
          test: 'should handle async operations',
          file: 'src/utils/api.test.ts',
          suggestion: 'Update test to handle Promise.resolve properly',
        },
      },
      {
        id: '10',
        type: 'celebration',
        title: 'Deployment Success',
        content: 'Application deployed to staging environment',
        timestamp: new Date(Date.now() - 50000),
        priority: 'low',
        tags: ['deployment', 'success'],
        context: {
          threadId: 'main',
          currentTool: 'deployment',
        },
        metadata: {
          environment: 'staging',
          branch: 'feature/new-ui',
          suggestion: 'Ready for QA testing',
        },
      },
    ],
    insights: [
      {
        id: '4',
        category: 'pattern',
        title: 'Development Workflow Insight',
        description: 'Tests are frequently failing due to async timing issues',
        confidence: 0.89,
        actionable: true,
        recommendations: [
          'Use async/await consistently in tests',
          'Add proper test cleanup and timeouts',
          'Consider using testing library utilities',
        ],
        impact: 'medium',
      },
    ],
    predictiveInsights: [],
    showPerformanceMetrics: false,
    showPredictions: false,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Development workflow feedback showing code review, testing, and deployment events.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    events: sampleEvents,
    insights: sampleInsights,
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights,
    showPerformanceMetrics: true,
    showPredictions: true,
    showInsights: true,
    maxEventsShown: 10,
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showing all features: tab navigation, event filtering, and comprehensive feedback data.',
      },
    },
  },
};