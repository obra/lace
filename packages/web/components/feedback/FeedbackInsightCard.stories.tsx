import type { Meta, StoryObj } from '@storybook/react';
import { FeedbackInsightCard } from './FeedbackInsightCard';
import { FeedbackInsight } from '~/feedback/types';

const meta: Meta<typeof FeedbackInsightCard> = {
  title: 'Organisms/FeedbackInsightCard',
  component: FeedbackInsightCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Insight card component for displaying contextual insights with confidence levels, recommendations, and actionable items. Shows machine learning-generated insights about development patterns and opportunities.',
      },
    },
  },
  argTypes: {
    insight: {
      description: 'The feedback insight to display',
      control: false,
    },
    showRecommendations: {
      description: 'Whether to show recommendations section',
      control: 'boolean',
    },
    showRelatedEvents: {
      description: 'Whether to show related events section',
      control: 'boolean',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FeedbackInsightCard>;

// Base insight template
const baseInsight = {
  id: '1',
  timestamp: new Date(Date.now() - 900000), // 15 minutes ago
  relatedEvents: ['event-123', 'event-456', 'event-789'],
};

export const PatternInsight: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'pattern',
      title: 'Development Pattern Detected',
      description: 'You frequently refactor components after initial implementation. This suggests a pattern of iterative improvement, which is good practice for code quality.',
      confidence: 0.87,
      impact: 'medium',
      actionable: true,
      recommendations: [
        'Consider test-driven development to reduce refactoring cycles',
        'Plan component architecture more thoroughly before implementation',
        'Use TypeScript interfaces to define component contracts upfront',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Pattern recognition insight showing development behavior patterns with actionable recommendations.',
      },
    },
  },
};

export const PerformanceInsight: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'performance',
      title: 'Performance Optimization Opportunity',
      description: 'Your recent code changes have improved render performance by 23%. The use of React.memo and useMemo is particularly effective.',
      confidence: 0.94,
      impact: 'high',
      actionable: true,
      recommendations: [
        'Apply similar optimization patterns to other components',
        'Consider implementing virtualization for large lists',
        'Profile components regularly to identify bottlenecks',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Performance insight highlighting successful optimizations and suggesting further improvements.',
      },
    },
  },
};

export const ErrorInsight: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'error',
      title: 'Error Pattern Analysis',
      description: 'Async operations are causing 60% of runtime errors. Most errors occur during component unmounting when promises resolve.',
      confidence: 0.76,
      impact: 'high',
      actionable: true,
      recommendations: [
        'Use cleanup functions in useEffect to cancel pending operations',
        'Implement proper error boundaries around async components',
        'Consider using React Query for better async state management',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Error analysis insight identifying common error patterns and providing solutions.',
      },
    },
  },
};

export const OptimizationInsight: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'optimization',
      title: 'Bundle Size Optimization',
      description: 'Your application bundle has grown by 15% over the past week. Most growth comes from unused utility functions and duplicate dependencies.',
      confidence: 0.82,
      impact: 'medium',
      actionable: true,
      recommendations: [
        'Implement tree shaking for utility libraries',
        'Remove unused dependencies from package.json',
        'Use dynamic imports for code splitting',
        'Consider switching to smaller alternative libraries',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Bundle optimization insight suggesting ways to reduce application size.',
      },
    },
  },
};

export const PredictionInsight: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'prediction',
      title: 'Technical Debt Prediction',
      description: 'Based on current development velocity and complexity growth, technical debt will likely impact feature delivery within 2 weeks.',
      confidence: 0.68,
      impact: 'high',
      actionable: true,
      recommendations: [
        'Allocate 20% of next sprint to refactoring',
        'Focus on high-impact debt items first',
        'Schedule architecture review with team',
        'Consider implementing coding standards checks',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Predictive insight forecasting potential technical debt issues.',
      },
    },
  },
};

export const HighConfidence: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'performance',
      title: 'High Confidence Insight',
      description: 'Component memoization has consistently improved performance across all measured scenarios.',
      confidence: 0.96,
      impact: 'high',
      actionable: true,
      recommendations: [
        'Apply memoization patterns to similar components',
        'Document successful optimization patterns',
        'Share knowledge with team members',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'High confidence insight (96%) showing strong evidence for recommendations.',
      },
    },
  },
};

export const MediumConfidence: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'pattern',
      title: 'Medium Confidence Insight',
      description: 'There appears to be a correlation between commit frequency and code quality metrics.',
      confidence: 0.72,
      impact: 'medium',
      actionable: false,
      recommendations: [
        'Continue monitoring for more data',
        'Consider tracking additional metrics',
        'Validate findings with team review',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Medium confidence insight (72%) requiring more data for validation.',
      },
    },
  },
};

export const LowConfidence: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'optimization',
      title: 'Low Confidence Insight',
      description: 'Initial data suggests that afternoon coding sessions may be less productive, but more data is needed.',
      confidence: 0.45,
      impact: 'low',
      actionable: false,
      recommendations: [
        'Continue data collection for better analysis',
        'Consider external factors affecting productivity',
        'Track more detailed metrics over longer period',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Low confidence insight (45%) showing preliminary findings that need more data.',
      },
    },
  },
};

export const WithRelatedEvents: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'pattern',
      title: 'Insight with Related Events',
      description: 'This insight is derived from multiple related events in your development session.',
      confidence: 0.84,
      impact: 'medium',
      actionable: true,
      recommendations: [
        'Review related events for context',
        'Consider patterns across multiple sessions',
        'Document insights for future reference',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Insight card with expandable related events section showing data sources.',
      },
    },
  },
};

export const NoRecommendations: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'pattern',
      title: 'Simple Insight',
      description: 'This insight provides information without specific recommendations.',
      confidence: 0.78,
      impact: 'low',
      actionable: false,
      recommendations: [],
    },
    showRecommendations: false,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Simple insight without recommendations showing minimal layout.',
      },
    },
  },
};

export const NonActionable: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'pattern',
      title: 'Non-Actionable Insight',
      description: 'This is an informational insight that doesn\'t require immediate action.',
      confidence: 0.81,
      impact: 'low',
      actionable: false,
      recommendations: [
        'Keep this information in mind for future development',
        'Consider tracking this metric over time',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Non-actionable insight without the actionable badge.',
      },
    },
  },
};

export const AllCategories: Story = {
  render: () => (
    <div className="space-y-4">
      {[
        { category: 'pattern', title: 'Pattern Analysis', description: 'Development pattern detected' },
        { category: 'performance', title: 'Performance Insight', description: 'Performance optimization opportunity' },
        { category: 'error', title: 'Error Analysis', description: 'Error pattern identified' },
        { category: 'optimization', title: 'Optimization Insight', description: 'Code optimization suggestion' },
        { category: 'prediction', title: 'Predictive Insight', description: 'Future outcome prediction' },
      ].map((data, index) => (
        <FeedbackInsightCard
          key={index}
          insight={{
            ...baseInsight,
            id: `insight-${index}`,
            category: data.category,
            title: data.title,
            description: data.description,
            confidence: 0.8,
            impact: 'medium',
            actionable: true,
            recommendations: [`Sample recommendation for ${data.category}`],
          }}
          showRecommendations={true}
          showRelatedEvents={false}
        />
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all insight categories with their distinctive icons and colors.',
      },
    },
  },
};

export const AllImpactLevels: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">High Impact</h3>
      <FeedbackInsightCard
        insight={{
          ...baseInsight,
          category: 'error',
          title: 'High Impact Insight',
          description: 'This insight has high impact on your development process.',
          confidence: 0.9,
          impact: 'high',
          actionable: true,
          recommendations: ['Take immediate action on this insight'],
        }}
        showRecommendations={true}
      />
      
      <h3 className="text-lg font-semibold">Medium Impact</h3>
      <FeedbackInsightCard
        insight={{
          ...baseInsight,
          category: 'optimization',
          title: 'Medium Impact Insight',
          description: 'This insight has medium impact on your development process.',
          confidence: 0.75,
          impact: 'medium',
          actionable: true,
          recommendations: ['Consider addressing this when convenient'],
        }}
        showRecommendations={true}
      />
      
      <h3 className="text-lg font-semibold">Low Impact</h3>
      <FeedbackInsightCard
        insight={{
          ...baseInsight,
          category: 'pattern',
          title: 'Low Impact Insight',
          description: 'This insight has low impact on your development process.',
          confidence: 0.65,
          impact: 'low',
          actionable: false,
          recommendations: ['Keep this in mind for future reference'],
        }}
        showRecommendations={true}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of all impact levels showing different visual indicators.',
      },
    },
  },
};

export const ConfidenceRange: Story = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Confidence Levels</h3>
      {[
        { confidence: 0.95, label: 'Very High (95%)' },
        { confidence: 0.82, label: 'High (82%)' },
        { confidence: 0.68, label: 'Medium (68%)' },
        { confidence: 0.45, label: 'Low (45%)' },
        { confidence: 0.23, label: 'Very Low (23%)' },
      ].map((data, index) => (
        <div key={index}>
          <h4 className="text-sm font-medium mb-2">{data.label}</h4>
          <FeedbackInsightCard
            insight={{
              ...baseInsight,
              id: `confidence-${index}`,
              category: 'pattern',
              title: `${data.label} Confidence Insight`,
              description: `This insight has ${data.confidence * 100}% confidence level.`,
              confidence: data.confidence,
              impact: 'medium',
              actionable: data.confidence > 0.7,
              recommendations: ['Recommendation based on confidence level'],
            }}
            showRecommendations={true}
            showRelatedEvents={false}
          />
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Demonstration of confidence levels with different visual indicators.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    insight: {
      ...baseInsight,
      category: 'pattern',
      title: 'Interactive Demo Insight',
      description: 'Use the controls below to toggle recommendations and related events visibility.',
      confidence: 0.85,
      impact: 'medium',
      actionable: true,
      recommendations: [
        'Toggle recommendations to see how the layout changes',
        'Enable related events to show data sources',
        'Experiment with different display options',
      ],
    },
    showRecommendations: true,
    showRelatedEvents: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showing all features including recommendations and related events.',
      },
    },
  },
};