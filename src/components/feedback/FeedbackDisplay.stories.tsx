import type { Meta, StoryObj } from '@storybook/react';
import { FeedbackDisplay } from './FeedbackDisplay';
import { FeedbackEvent, FeedbackInsight, PerformanceAnalysis, PredictiveInsight } from '~/feedback/types';

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
    type: 'code_quality',
    title: 'Code Quality Improvement',
    description: 'Detected unused imports in src/components/ui/Button.tsx',
    timestamp: new Date(Date.now() - 300000),
    severity: 'medium',
    context: {
      file: 'src/components/ui/Button.tsx',
      line: 5,
      suggestion: 'Remove unused import: import { unused } from "library"',
    },
  },
  {
    id: '2',
    type: 'performance',
    title: 'Performance Optimization',
    description: 'Large component re-renders detected in TimelineView',
    timestamp: new Date(Date.now() - 240000),
    severity: 'high',
    context: {
      component: 'TimelineView',
      renderCount: 45,
      suggestion: 'Consider memoization with useMemo or React.memo',
    },
  },
  {
    id: '3',
    type: 'accessibility',
    title: 'Accessibility Issue',
    description: 'Missing alt text for images in carousel component',
    timestamp: new Date(Date.now() - 180000),
    severity: 'medium',
    context: {
      component: 'Carousel',
      element: 'img',
      suggestion: 'Add descriptive alt text for screen readers',
    },
  },
  {
    id: '4',
    type: 'security',
    title: 'Security Alert',
    description: 'Potential XSS vulnerability in user input handling',
    timestamp: new Date(Date.now() - 120000),
    severity: 'high',
    context: {
      file: 'src/components/chat/ChatInput.tsx',
      vulnerability: 'Unescaped user input in dangerouslySetInnerHTML',
      suggestion: 'Use DOMPurify or remove dangerouslySetInnerHTML',
    },
  },
  {
    id: '5',
    type: 'testing',
    title: 'Test Coverage',
    description: 'Low test coverage in authentication module',
    timestamp: new Date(Date.now() - 60000),
    severity: 'low',
    context: {
      module: 'src/auth/',
      coverage: 45,
      suggestion: 'Add tests for edge cases and error handling',
    },
  },
];

// Sample insights
const sampleInsights: FeedbackInsight[] = [
  {
    id: '1',
    type: 'pattern_recognition',
    title: 'Development Pattern Insight',
    description: 'You frequently modify components without updating tests',
    confidence: 0.85,
    timestamp: new Date(Date.now() - 600000),
    suggestions: [
      'Consider test-driven development approach',
      'Set up pre-commit hooks for test validation',
      'Create component test templates',
    ],
    impact: 'medium',
  },
  {
    id: '2',
    type: 'productivity',
    title: 'Productivity Insight',
    description: 'Most productive hours are between 9-11 AM',
    confidence: 0.92,
    timestamp: new Date(Date.now() - 480000),
    suggestions: [
      'Schedule complex tasks during peak hours',
      'Use afternoon for code reviews and documentation',
      'Consider pair programming in the morning',
    ],
    impact: 'high',
  },
  {
    id: '3',
    type: 'code_quality',
    title: 'Code Quality Insight',
    description: 'Consistent use of TypeScript strict mode improves code quality',
    confidence: 0.78,
    timestamp: new Date(Date.now() - 360000),
    suggestions: [
      'Enable strict mode in all new projects',
      'Gradually migrate existing code to strict mode',
      'Use ESLint rules for TypeScript best practices',
    ],
    impact: 'high',
  },
];

// Sample performance analysis
const samplePerformanceAnalysis: PerformanceAnalysis = {
  overall_score: 78,
  response_time: {
    average: 450,
    p95: 890,
    p99: 1200,
  },
  memory_usage: {
    peak: 120,
    average: 85,
    trend: 'stable',
  },
  cpu_usage: {
    peak: 65,
    average: 35,
    trend: 'improving',
  },
  bottlenecks: [
    {
      type: 'component_render',
      component: 'TimelineView',
      impact: 'high',
      suggestion: 'Implement virtualization for large lists',
    },
    {
      type: 'api_call',
      endpoint: '/api/messages',
      impact: 'medium',
      suggestion: 'Add response caching and pagination',
    },
  ],
  improvements: [
    {
      description: 'Reduced bundle size by 23%',
      impact: 15,
      implemented: new Date(Date.now() - 86400000),
    },
    {
      description: 'Optimized image loading',
      impact: 8,
      implemented: new Date(Date.now() - 43200000),
    },
  ],
};

// Sample predictive insights
const samplePredictiveInsights: PredictiveInsight[] = [
  {
    id: '1',
    type: 'technical_debt',
    title: 'Technical Debt Prediction',
    description: 'Current velocity suggests tech debt will impact delivery in 2 weeks',
    confidence: 0.73,
    probability: 0.68,
    timeframe: '2 weeks',
    timestamp: new Date(Date.now() - 900000),
    recommendations: [
      'Allocate 20% of sprint capacity to refactoring',
      'Prioritize high-impact debt items',
      'Schedule architecture review session',
    ],
    impact: 'high',
  },
  {
    id: '2',
    type: 'performance_degradation',
    title: 'Performance Degradation Risk',
    description: 'Memory usage trends indicate potential performance issues',
    confidence: 0.81,
    probability: 0.45,
    timeframe: '1 week',
    timestamp: new Date(Date.now() - 720000),
    recommendations: [
      'Review memory-intensive components',
      'Implement performance monitoring',
      'Consider code splitting for large bundles',
    ],
    impact: 'medium',
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
    events: sampleEvents.filter(event => event.severity === 'high'),
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
    insights: sampleInsights.filter(insight => insight.type === 'productivity'),
    performanceAnalysis: samplePerformanceAnalysis,
    predictiveInsights: samplePredictiveInsights.filter(insight => insight.type === 'performance_degradation'),
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
      ...sampleEvents.filter(event => event.type === 'security'),
      {
        id: '6',
        type: 'security',
        title: 'Dependency Vulnerability',
        description: 'Outdated package with known security vulnerabilities',
        timestamp: new Date(Date.now() - 90000),
        severity: 'high',
        context: {
          package: 'lodash@4.17.15',
          vulnerability: 'CVE-2021-23337',
          suggestion: 'Update to lodash@4.17.21 or later',
        },
      },
      {
        id: '7',
        type: 'security',
        title: 'Insecure API Endpoint',
        description: 'API endpoint missing authentication',
        timestamp: new Date(Date.now() - 30000),
        severity: 'high',
        context: {
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
        type: 'code_quality',
        title: 'Code Review Feedback',
        description: 'Pull request #123 needs attention',
        timestamp: new Date(Date.now() - 150000),
        severity: 'medium',
        context: {
          pr: 123,
          reviewer: 'senior-dev',
          suggestion: 'Address comments about error handling',
        },
      },
      {
        id: '9',
        type: 'testing',
        title: 'Test Failure',
        description: 'Unit test failing in CI pipeline',
        timestamp: new Date(Date.now() - 100000),
        severity: 'high',
        context: {
          test: 'should handle async operations',
          file: 'src/utils/api.test.ts',
          suggestion: 'Update test to handle Promise.resolve properly',
        },
      },
      {
        id: '10',
        type: 'deployment',
        title: 'Deployment Success',
        description: 'Application deployed to staging environment',
        timestamp: new Date(Date.now() - 50000),
        severity: 'low',
        context: {
          environment: 'staging',
          branch: 'feature/new-ui',
          suggestion: 'Ready for QA testing',
        },
      },
    ],
    insights: [
      {
        id: '4',
        type: 'workflow',
        title: 'Development Workflow Insight',
        description: 'Tests are frequently failing due to async timing issues',
        confidence: 0.89,
        timestamp: new Date(Date.now() - 800000),
        suggestions: [
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