import type { Meta, StoryObj } from '@storybook/react';
import { PredictivePanel } from './PredictivePanel';
import { PredictiveInsight } from '@/feedback/types';

const meta: Meta<typeof PredictivePanel> = {
  title: 'Organisms/PredictivePanel',
  component: PredictivePanel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Predictive insights panel for contextual feedback. Displays predictions, timeframes, and prevention suggestions based on development patterns and machine learning analysis.',
      },
    },
  },
  argTypes: {
    insights: {
      description: 'Array of predictive insights to display',
      control: false,
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PredictivePanel>;

// Sample predictive insights
const sampleInsights: PredictiveInsight[] = [
  {
    prediction: 'Technical debt will likely impact feature delivery',
    timeframe: 'short',
    confidence: 0.78,
    actionable: true,
    factors: ['increasing_complexity', 'decreasing_test_coverage', 'code_duplication'],
    preventionSuggestions: [
      'Allocate 20% of sprint capacity to refactoring',
      'Implement automated code quality checks',
      'Schedule architecture review sessions',
    ],
  },
  {
    prediction: 'Memory usage will exceed limits during peak hours',
    timeframe: 'immediate',
    confidence: 0.85,
    actionable: true,
    factors: ['memory_leak_pattern', 'increasing_concurrent_users', 'component_mounting_issues'],
    preventionSuggestions: [
      'Implement memory monitoring and alerts',
      'Add cleanup functions to React components',
      'Consider implementing component lazy loading',
    ],
  },
  {
    prediction: 'API rate limits may be exceeded with current usage pattern',
    timeframe: 'medium',
    confidence: 0.67,
    actionable: true,
    factors: ['api_call_frequency', 'user_growth_trend', 'batch_processing_gaps'],
    preventionSuggestions: [
      'Implement request caching strategy',
      'Add rate limiting to client-side requests',
      'Consider API usage optimization',
    ],
  },
];

export const Default: Story = {
  args: {
    insights: sampleInsights,
  },
  parameters: {
    docs: {
      description: {
        story: 'Default predictive panel showing various insights with different timeframes and confidence levels.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    insights: [],
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty state when no predictive insights are available.',
      },
    },
  },
};

export const ImmediateThreats: Story = {
  args: {
    insights: [
      {
        prediction: 'System will run out of disk space',
        timeframe: 'immediate',
        confidence: 0.92,
        actionable: true,
        factors: ['rapid_log_growth', 'temp_file_accumulation', 'backup_size_increase'],
        preventionSuggestions: [
          'Clean up log files immediately',
          'Implement log rotation policy',
          'Add disk space monitoring alerts',
        ],
      },
      {
        prediction: 'Database connection pool will be exhausted',
        timeframe: 'immediate',
        confidence: 0.88,
        actionable: true,
        factors: ['connection_leak', 'increased_traffic', 'long_running_queries'],
        preventionSuggestions: [
          'Audit and fix connection leaks',
          'Optimize long-running queries',
          'Increase connection pool size temporarily',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Immediate threats requiring urgent attention with high confidence levels.',
      },
    },
  },
};

export const ShortTermPredictions: Story = {
  args: {
    insights: [
      {
        prediction: 'Build times will increase significantly',
        timeframe: 'short',
        confidence: 0.74,
        actionable: true,
        factors: ['bundle_size_growth', 'dependency_increase', 'compilation_complexity'],
        preventionSuggestions: [
          'Implement code splitting strategies',
          'Review and optimize build configuration',
          'Consider build caching solutions',
        ],
      },
      {
        prediction: 'Test suite execution time will double',
        timeframe: 'short',
        confidence: 0.81,
        actionable: true,
        factors: ['test_count_growth', 'slow_integration_tests', 'setup_teardown_overhead'],
        preventionSuggestions: [
          'Parallelize test execution',
          'Optimize slow integration tests',
          'Implement test result caching',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Short-term predictions about development workflow impacts.',
      },
    },
  },
};

export const MediumTermPredictions: Story = {
  args: {
    insights: [
      {
        prediction: 'Component library will need major refactoring',
        timeframe: 'medium',
        confidence: 0.69,
        actionable: true,
        factors: ['api_inconsistency', 'duplicate_functionality', 'maintenance_burden'],
        preventionSuggestions: [
          'Create component design system guidelines',
          'Audit existing components for consolidation',
          'Plan incremental refactoring strategy',
        ],
      },
      {
        prediction: 'User experience metrics will decline',
        timeframe: 'medium',
        confidence: 0.72,
        actionable: true,
        factors: ['performance_degradation', 'feature_complexity', 'user_feedback_trends'],
        preventionSuggestions: [
          'Implement performance monitoring',
          'Conduct user experience audits',
          'Simplify complex user flows',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Medium-term predictions about architectural and user experience impacts.',
      },
    },
  },
};

export const LongTermPredictions: Story = {
  args: {
    insights: [
      {
        prediction: 'Current architecture will not scale to projected user base',
        timeframe: 'long',
        confidence: 0.63,
        actionable: true,
        factors: ['scalability_limits', 'resource_constraints', 'growth_projections'],
        preventionSuggestions: [
          'Begin architecture scalability planning',
          'Evaluate microservices migration options',
          'Invest in infrastructure automation',
        ],
      },
      {
        prediction: 'Development team productivity will plateau',
        timeframe: 'long',
        confidence: 0.58,
        actionable: false,
        factors: ['team_growth_challenges', 'knowledge_silos', 'process_inefficiencies'],
        preventionSuggestions: [
          'Implement knowledge sharing initiatives',
          'Invest in developer tooling improvements',
          'Plan team structure optimization',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Long-term strategic predictions about architecture and team dynamics.',
      },
    },
  },
};

export const HighConfidencePredictions: Story = {
  args: {
    insights: [
      {
        prediction: 'Current deployment process will fail under load',
        timeframe: 'short',
        confidence: 0.94,
        actionable: true,
        factors: ['deployment_bottlenecks', 'manual_processes', 'single_point_failure'],
        preventionSuggestions: [
          'Implement automated deployment pipeline',
          'Add deployment monitoring and rollback',
          'Create redundant deployment paths',
        ],
      },
      {
        prediction: 'Security vulnerabilities will increase',
        timeframe: 'medium',
        confidence: 0.89,
        actionable: true,
        factors: ['dependency_vulnerabilities', 'security_debt', 'outdated_libraries'],
        preventionSuggestions: [
          'Implement automated security scanning',
          'Create vulnerability management process',
          'Plan security audit and updates',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'High confidence predictions with strong evidence and clear action items.',
      },
    },
  },
};

export const LowConfidencePredictions: Story = {
  args: {
    insights: [
      {
        prediction: 'Code quality metrics may decline',
        timeframe: 'medium',
        confidence: 0.42,
        actionable: false,
        factors: ['early_indicators', 'team_changes', 'pressure_increases'],
        preventionSuggestions: [
          'Monitor code quality metrics closely',
          'Continue data collection for better analysis',
          'Consider preventive measures if trend continues',
        ],
      },
      {
        prediction: 'User retention might be affected by recent changes',
        timeframe: 'short',
        confidence: 0.38,
        actionable: false,
        factors: ['user_behavior_changes', 'feature_adoption_rates', 'feedback_sentiment'],
        preventionSuggestions: [
          'Gather more user feedback data',
          'Analyze user journey metrics',
          'Prepare rollback plan if needed',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Low confidence predictions requiring more data and careful monitoring.',
      },
    },
  },
};

export const NonActionablePredictions: Story = {
  args: {
    insights: [
      {
        prediction: 'Technology landscape will shift towards new frameworks',
        timeframe: 'long',
        confidence: 0.65,
        actionable: false,
        factors: ['industry_trends', 'framework_adoption', 'developer_preferences'],
        preventionSuggestions: [
          'Stay informed about technology trends',
          'Evaluate new frameworks periodically',
          'Maintain flexible architecture for future changes',
        ],
      },
      {
        prediction: 'Team composition will naturally evolve',
        timeframe: 'medium',
        confidence: 0.71,
        actionable: false,
        factors: ['career_progression', 'market_conditions', 'company_growth'],
        preventionSuggestions: [
          'Prepare for knowledge transfer needs',
          'Document critical processes and decisions',
          'Plan for succession and cross-training',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Non-actionable predictions about natural evolution and external factors.',
      },
    },
  },
};

export const MixedTimeframes: Story = {
  args: {
    insights: [
      {
        prediction: 'Critical bug will surface in production',
        timeframe: 'immediate',
        confidence: 0.87,
        actionable: true,
        factors: ['error_rate_increase', 'edge_case_handling', 'recent_changes'],
        preventionSuggestions: [
          'Increase monitoring and alerting',
          'Prepare hotfix deployment process',
          'Review recent changes for potential issues',
        ],
      },
      {
        prediction: 'Performance bottlenecks will emerge',
        timeframe: 'short',
        confidence: 0.73,
        actionable: true,
        factors: ['traffic_growth', 'resource_utilization', 'optimization_debt'],
        preventionSuggestions: [
          'Implement performance profiling',
          'Plan optimization sprint',
          'Add performance regression tests',
        ],
      },
      {
        prediction: 'Maintenance overhead will become significant',
        timeframe: 'medium',
        confidence: 0.68,
        actionable: true,
        factors: ['technical_debt', 'system_complexity', 'feature_additions'],
        preventionSuggestions: [
          'Audit system for maintenance burden',
          'Plan architectural simplification',
          'Implement automated maintenance tools',
        ],
      },
      {
        prediction: 'Platform migration will become necessary',
        timeframe: 'long',
        confidence: 0.55,
        actionable: false,
        factors: ['platform_evolution', 'vendor_changes', 'scalability_needs'],
        preventionSuggestions: [
          'Monitor platform roadmap and changes',
          'Maintain platform-agnostic architecture',
          'Plan for potential migration scenarios',
        ],
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Mixed timeframes showing predictions from immediate to long-term.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    insights: sampleInsights,
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showing all predictive panel features including timeframes, confidence levels, and prevention suggestions.',
      },
    },
  },
};