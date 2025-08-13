// ABOUTME: Storybook story for AnimatedTimelineMessage.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedTimelineMessage } from './AnimatedTimelineMessage';
import { TimelineEntry } from '~/types/web-events';

const meta: Meta<typeof AnimatedTimelineMessage> = {
  title: 'Organisms/AnimatedTimelineMessage',
  component: AnimatedTimelineMessage,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Animated timeline message component with Framer Motion animations, supporting various message types including human, AI, tool calls, integrations, and carousels. Features spring physics, staggered animations, and hover effects.',
      },
    },
  },
  argTypes: {
    entry: {
      description: 'Timeline entry data with message content and metadata',
      control: false,
    },
    index: {
      description: 'Index for staggered animations',
      control: { type: 'number', min: 0, max: 10 },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnimatedTimelineMessage>;

// Sample timeline entries for different message types
const humanMessage: TimelineEntry = {
  id: 1,
  type: 'human',
  content: 'Can you help me analyze the recent code changes and create a summary report?',
  timestamp: new Date(Date.now() - 3600000),
};

const aiMessage: TimelineEntry = {
  id: 2,
  type: 'ai',
  content: "I'll analyze the recent code changes for you. Let me examine the commits and create a comprehensive summary.\n\nHere's what I found:\n```typescript\nfunction analyzeChanges() {\n  const changes = getRecentCommits();\n  return changes.map(change => ({\n    impact: calculateImpact(change),\n    complexity: assessComplexity(change)\n  }));\n}\n```\n\nThe analysis shows several important patterns in the recent changes.",
  agent: 'Claude',
  timestamp: new Date(Date.now() - 3500000),
};

const toolMessage: TimelineEntry = {
  id: 3,
  type: 'tool',
  tool: 'bash',
  content: 'git log --oneline --since="1 week ago"',
  result: {
    content: [{ type: 'text', text: `a1b2c3d feat: add user authentication system
e4f5g6h fix: resolve memory leak in timeline component
i7j8k9l refactor: reorganize component structure
m1n2o3p docs: update API documentation
q4r5s6t test: add integration tests for auth flow` }],
    status: 'completed' as const,
  },
  timestamp: new Date(Date.now() - 3400000),
};

const adminMessage: TimelineEntry = {
  id: 4,
  type: 'admin',
  content: 'Timeline started',
  timestamp: new Date(Date.now() - 3700000),
};

const integrationMessage: TimelineEntry = {
  id: 5,
  type: 'integration',
  tool: 'Google Drive',
  action: 'created',
  title: 'Code Analysis Report.docx',
  description: 'Comprehensive analysis of recent code changes with recommendations',
  link: 'https://drive.google.com/file/d/example',
  timestamp: new Date(Date.now() - 3300000),
};

const carouselMessage: TimelineEntry = {
  id: 6,
  type: 'carousel',
  title: 'Recent Code Changes',
  timestamp: new Date(Date.now() - 3200000),
  items: [
    {
      title: 'Authentication Module',
      description: 'Added OAuth2 integration with Google and GitHub providers',
      type: 'feature',
      impact: 'high',
      files: ['src/auth/oauth.ts', 'src/auth/providers.ts', 'src/auth/middleware.ts'],
      commit: 'a1b2c3d',
    },
    {
      title: 'Memory Leak Fix',
      description: 'Resolved timeline component memory leak in production',
      type: 'bugfix',
      impact: 'high',
      files: ['src/timeline/TimelineView.tsx'],
      commit: 'e4f5g6h',
    },
    {
      title: 'Component Refactor',
      description: 'Reorganized components into atomic design structure',
      type: 'refactor',
      impact: 'medium',
      files: ['src/components/atoms/', 'src/components/molecules/', 'src/components/organisms/'],
      commit: 'i7j8k9l',
    },
  ],
};

export const HumanMessage: Story = {
  args: {
    entry: humanMessage,
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Human message with user avatar, smooth entrance animation, and hover effects.',
      },
    },
  },
};

export const AIMessage: Story = {
  args: {
    entry: aiMessage,
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'AI message with agent badge, code highlighting, and staggered content animations.',
      },
    },
  },
};

export const ClaudeMessage: Story = {
  args: {
    entry: {
      ...aiMessage,
      agent: 'Claude',
      content: 'I can help you with that! Let me analyze the codebase and provide insights.\n\n```python\ndef analyze_code(repo_path):\n    """Analyze code quality and patterns"""\n    metrics = {\n        "complexity": calculate_complexity(repo_path),\n        "coverage": get_test_coverage(repo_path),\n        "maintainability": assess_maintainability(repo_path)\n    }\n    return generate_report(metrics)\n```\n\nThis analysis will help identify areas for improvement.',
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Claude AI message with orange branding, animated agent badge, and syntax-highlighted code.',
      },
    },
  },
};

export const GPT4Message: Story = {
  args: {
    entry: {
      ...aiMessage,
      agent: 'GPT-4',
      content: 'I\'ll help you optimize this code. Here\'s a more efficient approach:\n\n```javascript\nconst optimizedFunction = useMemo(() => {\n  return data.reduce((acc, item) => {\n    acc[item.id] = processItem(item);\n    return acc;\n  }, {});\n}, [data]);\n```\n\nThis reduces computational complexity from O(n²) to O(n).',
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'GPT-4 message with green branding and technical code optimization content.',
      },
    },
  },
};

export const GeminiMessage: Story = {
  args: {
    entry: {
      ...aiMessage,
      agent: 'Gemini',
      content: 'Let me provide a comprehensive analysis of your request:\n\n**Key Points:**\n- Performance optimization opportunities\n- Code structure improvements\n- Testing strategy recommendations\n\n```css\n.optimized-layout {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n  gap: 1rem;\n  container-type: inline-size;\n}\n```',
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Gemini message with blue branding and mixed content formatting.',
      },
    },
  },
};

export const ToolMessage: Story = {
  args: {
    entry: toolMessage,
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Tool execution message with terminal-style display, pulsing avatar, and command output.',
      },
    },
  },
};

export const BashToolMessage: Story = {
  args: {
    entry: {
      ...toolMessage,
      tool: 'bash',
      content: 'find src/ -name "*.tsx" -type f | wc -l',
      result: {
        content: [{ type: 'text', text: '47' }],
        status: 'completed' as const,
      },
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Bash command execution with file counting and simple output.',
      },
    },
  },
};

export const ComplexToolMessage: Story = {
  args: {
    entry: {
      ...toolMessage,
      tool: 'file-read',
      content: 'package.json',
      result: {
        content: [{ type: 'text', text: `{
  "name": "lace",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^18.2.0",
    "next": "^14.0.0",
    "framer-motion": "^10.16.0"
  }
}` }],
        status: 'completed' as const,
      },
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'File reading tool with JSON content and proper formatting.',
      },
    },
  },
};

export const AdminMessage: Story = {
  args: {
    entry: adminMessage,
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Admin system message with centered layout, icon animation, and subtle styling.',
      },
    },
  },
};

export const IntegrationMessage: Story = {
  args: {
    entry: integrationMessage,
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Google Drive integration message with document creation and sharing details.',
      },
    },
  },
};

export const SlackIntegration: Story = {
  args: {
    entry: {
      ...integrationMessage,
      tool: 'Slack',
      action: 'updated',
      title: 'Development Team',
      description: 'Code review completed, changes deployed to staging',
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Slack integration message with team notification and deployment status.',
      },
    },
  },
};

export const GitHubIntegration: Story = {
  args: {
    entry: {
      ...integrationMessage,
      tool: 'GitHub',
      action: 'created',
      title: 'Pull Request #123',
      description: 'Feature: Add user authentication system',
    },
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'GitHub integration message with pull request creation notification.',
      },
    },
  },
};

export const CarouselMessage: Story = {
  args: {
    entry: carouselMessage,
    index: 0,
  },
  parameters: {
    docs: {
      description: {
        story: 'Carousel message with multiple code change cards, animations, and interactive elements.',
      },
    },
  },
};

export const ConversationFlow: Story = {
  render: () => (
    <div className="space-y-6 max-w-4xl">
      <AnimatedTimelineMessage entry={adminMessage} index={0} />
      <AnimatedTimelineMessage entry={humanMessage} index={1} />
      <AnimatedTimelineMessage entry={aiMessage} index={2} />
      <AnimatedTimelineMessage entry={toolMessage} index={3} />
      <AnimatedTimelineMessage entry={integrationMessage} index={4} />
      <AnimatedTimelineMessage entry={carouselMessage} index={5} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Complete conversation flow showing all message types with staggered entrance animations.',
      },
    },
  },
};

export const MultiAgentConversation: Story = {
  render: () => (
    <div className="space-y-6 max-w-4xl">
      <AnimatedTimelineMessage 
        entry={{
          id: 1,
          type: 'human',
          content: 'Compare the performance of different AI models for code analysis',
          timestamp: new Date(Date.now() - 600000),
        }} 
        index={0} 
      />
      <AnimatedTimelineMessage 
        entry={{
          id: 2,
          type: 'ai',
          content: 'I\'ll analyze code complexity and suggest optimizations:\n\n```typescript\ninterface PerformanceMetrics {\n  latency: number;\n  throughput: number;\n  accuracy: number;\n}\n```',
          agent: 'Claude',
          timestamp: new Date(Date.now() - 550000),
        }} 
        index={1} 
      />
      <AnimatedTimelineMessage 
        entry={{
          id: 3,
          type: 'ai',
          content: 'Based on benchmarks, here are my findings:\n\n**Model Comparison:**\n- Processing speed: 95% faster\n- Memory usage: 40% reduction\n- Error rate: 99.2% accuracy',
          agent: 'GPT-4',
          timestamp: new Date(Date.now() - 500000),
        }} 
        index={2} 
      />
      <AnimatedTimelineMessage 
        entry={{
          id: 4,
          type: 'ai',
          content: 'I can provide additional context on optimization strategies:\n\n```python\ndef optimize_pipeline(data):\n    return pipeline.transform(data, parallel=True)\n```',
          agent: 'Gemini',
          timestamp: new Date(Date.now() - 450000),
        }} 
        index={3} 
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multi-agent conversation showing different AI assistants with distinct branding and animations.',
      },
    },
  },
};

export const AnimationShowcase: Story = {
  render: () => (
    <div className="space-y-8 max-w-4xl">
      <div className="text-lg font-semibold mb-4">🎬 Animation Features Showcase</div>
      
      <div className="space-y-6">
        <div>
          <div className="text-sm font-medium mb-2 text-base-content/70">Staggered Entrance (index: 0-3)</div>
          <div className="space-y-4">
            <AnimatedTimelineMessage entry={humanMessage} index={0} />
            <AnimatedTimelineMessage entry={aiMessage} index={1} />
            <AnimatedTimelineMessage entry={toolMessage} index={2} />
            <AnimatedTimelineMessage entry={adminMessage} index={3} />
          </div>
        </div>
        
        <div>
          <div className="text-sm font-medium mb-2 text-base-content/70">Different Agent Styles</div>
          <div className="space-y-4">
            <AnimatedTimelineMessage 
              entry={{...aiMessage, agent: 'Claude'}} 
              index={0} 
            />
            <AnimatedTimelineMessage 
              entry={{...aiMessage, agent: 'GPT-4', content: 'GPT-4 response with green branding'}} 
              index={0} 
            />
            <AnimatedTimelineMessage 
              entry={{...aiMessage, agent: 'Gemini', content: 'Gemini response with blue branding'}} 
              index={0} 
            />
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of animation features including staggered entrances and agent-specific styling.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-base-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-2">🎮 Interactive Features</h3>
        <ul className="text-sm text-base-content/70 space-y-1">
          <li>• Hover over avatars for scale and rotation effects</li>
          <li>• Code blocks have syntax highlighting and hover lift</li>
          <li>• Tool messages show pulsing animation effects</li>
          <li>• Carousel cards have hover animations and buttons</li>
        </ul>
      </div>
      
      <AnimatedTimelineMessage entry={aiMessage} index={0} />
      <AnimatedTimelineMessage entry={toolMessage} index={1} />
      <AnimatedTimelineMessage entry={carouselMessage} index={2} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demonstration of hover effects, animations, and user interaction features.',
      },
    },
  },
};