import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedTimelineView } from './AnimatedTimelineView';
import { TimelineEntry } from '@/types/design-system';

const meta: Meta<typeof AnimatedTimelineView> = {
  title: 'Organisms/AnimatedTimelineView',
  component: AnimatedTimelineView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Animated timeline view component with Framer Motion animations, auto-scrolling, typing indicators, and scroll-to-bottom functionality. Features staggered message entrance, smooth transitions, and performance-optimized animations.',
      },
    },
  },
  argTypes: {
    entries: {
      description: 'Array of timeline entries to display',
      control: false,
    },
    isTyping: {
      description: 'Whether to show typing indicator',
      control: 'boolean',
    },
    currentAgent: {
      description: 'Current agent name for typing indicator',
      control: { type: 'select', options: ['Claude', 'GPT-4', 'Gemini'] },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnimatedTimelineView>;

// Sample conversation data
const sampleEntries: TimelineEntry[] = [
  {
    id: 1,
    type: 'admin',
    content: 'Timeline started',
    timestamp: new Date(Date.now() - 3600000),
  },
  {
    id: 2,
    type: 'human',
    content: 'Help me optimize the performance of our React application',
    timestamp: new Date(Date.now() - 3500000),
  },
  {
    id: 3,
    type: 'ai',
    content: "I'll help you optimize your React application. Let me analyze the performance bottlenecks.\n\n```typescript\nfunction OptimizedComponent() {\n  const memoizedValue = useMemo(() => {\n    return expensiveCalculation(data);\n  }, [data]);\n  \n  return <div>{memoizedValue}</div>;\n}\n```\n\nThis approach reduces unnecessary re-renders.",
    agent: 'Claude',
    timestamp: new Date(Date.now() - 3400000),
  },
  {
    id: 4,
    type: 'tool',
    tool: 'bash',
    content: 'npm run build -- --analyze',
    result: {
      content: [{ type: 'text', text: `Bundle Analysis:
┌─────────────────────────────────────────────────────────────┐
│                      Bundle Size Report                     │
├─────────────────────────────────────────────────────────────┤
│ Total bundle size: 1.2MB                                   │
│ Main chunk: 850KB                                          │
│ Vendor chunk: 350KB                                        │
│                                                             │
│ Largest modules:                                            │
│ • react-dom: 120KB                                         │
│ • framer-motion: 95KB                                      │
│ • lodash: 70KB (consider tree-shaking)                     │
└─────────────────────────────────────────────────────────────┘` }],
      isError: false,
    },
    timestamp: new Date(Date.now() - 3300000),
  },
  {
    id: 5,
    type: 'integration',
    tool: 'Google Drive',
    action: 'created',
    title: 'Performance Optimization Report.docx',
    description: 'Comprehensive analysis and recommendations for React app optimization',
    link: 'https://drive.google.com/file/d/example',
    timestamp: new Date(Date.now() - 3200000),
  },
];

const longConversation: TimelineEntry[] = [
  ...sampleEntries,
  {
    id: 6,
    type: 'human',
    content: 'Can you explain the bundle analysis results?',
    timestamp: new Date(Date.now() - 3100000),
  },
  {
    id: 7,
    type: 'ai',
    content: "The bundle analysis shows several optimization opportunities:\n\n**Key Findings:**\n1. **Lodash (70KB)** - Consider using individual imports\n2. **Large main chunk** - Implement code splitting\n3. **Vendor bundle** - Good separation of dependencies\n\n```javascript\n// Instead of:\nimport _ from 'lodash';\n\n// Use specific imports:\nimport { debounce, throttle } from 'lodash';\n```",
    agent: 'Claude',
    timestamp: new Date(Date.now() - 3000000),
  },
  {
    id: 8,
    type: 'carousel',
    title: 'Optimization Strategies',
    timestamp: new Date(Date.now() - 2900000),
    items: [
      {
        title: 'Code Splitting',
        description: 'Implement dynamic imports for route-based chunks',
        type: 'feature',
        impact: 'high',
        files: ['src/pages/', 'next.config.js'],
        commit: 'abc123',
      },
      {
        title: 'Tree Shaking',
        description: 'Remove unused code from dependencies',
        type: 'refactor',
        impact: 'medium',
        files: ['package.json', 'webpack.config.js'],
        commit: 'def456',
      },
      {
        title: 'Image Optimization',
        description: 'Implement next/image for automatic optimization',
        type: 'feature',
        impact: 'medium',
        files: ['src/components/ui/', 'public/images/'],
        commit: 'ghi789',
      },
    ],
  },
  {
    id: 9,
    type: 'tool',
    tool: 'file-write',
    content: 'next.config.js',
    result: {
      content: [{ type: 'text', text: `Configuration updated with:
- Bundle analyzer plugin
- Image optimization settings  
- Tree shaking configuration
- Compression middleware` }],
      isError: false,
    },
    timestamp: new Date(Date.now() - 2800000),
  },
  {
    id: 10,
    type: 'ai',
    content: "Great! I've implemented the optimizations. Here's what we accomplished:\n\n✅ **Reduced bundle size by 40%**\n✅ **Improved First Contentful Paint by 1.2s**\n✅ **Better code splitting implementation**\n\nYour app should now load significantly faster!",
    agent: 'Claude',
    timestamp: new Date(Date.now() - 2700000),
  },
];

const multiAgentEntries: TimelineEntry[] = [
  {
    id: 1,
    type: 'human',
    content: 'I need help with a complex architecture decision. Can multiple agents provide different perspectives?',
    timestamp: new Date(Date.now() - 1800000),
  },
  {
    id: 2,
    type: 'ai',
    content: "I'll provide a perspective focused on maintainability and developer experience:\n\n```typescript\ninterface ArchitectureDecision {\n  maintainability: 'high' | 'medium' | 'low';\n  scalability: number;\n  complexity: number;\n}\n```\n\nFocus on clean abstractions and clear separation of concerns.",
    agent: 'Claude',
    timestamp: new Date(Date.now() - 1700000),
  },
  {
    id: 3,
    type: 'ai',
    content: "From a performance optimization standpoint:\n\n**Key Considerations:**\n- Memory usage patterns\n- CPU-intensive operations\n- Network request optimization\n- Caching strategies\n\n```python\n@lru_cache(maxsize=128)\ndef optimized_computation(input_data):\n    return complex_algorithm(input_data)\n```",
    agent: 'GPT-4',
    timestamp: new Date(Date.now() - 1600000),
  },
  {
    id: 4,
    type: 'ai',
    content: "I'll focus on user experience and accessibility:\n\n**UX Priorities:**\n- Progressive loading strategies\n- Error state handling\n- Responsive design considerations\n- Accessibility compliance\n\n```css\n.accessible-architecture {\n  /* Focus management */\n  outline: 2px solid var(--focus-color);\n  outline-offset: 2px;\n  \n  /* Screen reader support */\n  @media (prefers-reduced-motion: reduce) {\n    transition: none;\n  }\n}\n```",
    agent: 'Gemini',
    timestamp: new Date(Date.now() - 1500000),
  },
];

export const Default: Story = {
  args: {
    entries: sampleEntries,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Default animated timeline view with various message types and smooth entrance animations.',
      },
    },
  },
};

export const WithTypingIndicator: Story = {
  args: {
    entries: sampleEntries,
    isTyping: true,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline view with animated typing indicator showing AI is currently responding.',
      },
    },
  },
};

export const GPTTypingIndicator: Story = {
  args: {
    entries: sampleEntries,
    isTyping: true,
    currentAgent: 'GPT-4',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline view with GPT-4 typing indicator featuring green branding.',
      },
    },
  },
};

export const GeminiTypingIndicator: Story = {
  args: {
    entries: sampleEntries,
    isTyping: true,
    currentAgent: 'Gemini',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline view with Gemini typing indicator featuring blue branding.',
      },
    },
  },
};

export const LongConversation: Story = {
  args: {
    entries: longConversation,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Long conversation demonstrating auto-scroll behavior and scroll-to-bottom button.',
      },
    },
  },
};

export const MultiAgentConversation: Story = {
  args: {
    entries: multiAgentEntries,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Multi-agent conversation showing different AI assistants with distinct styling and animations.',
      },
    },
  },
};

export const EmptyTimeline: Story = {
  args: {
    entries: [],
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty timeline view showing clean state with no messages.',
      },
    },
  },
};

export const SingleMessage: Story = {
  args: {
    entries: [sampleEntries[2]], // Just the AI message
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Timeline view with single message showing entrance animation.',
      },
    },
  },
};

export const ScrollBehaviorDemo: Story = {
  args: {
    entries: longConversation,
    isTyping: true,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Demonstration of auto-scroll behavior, scroll-to-bottom button, and typing indicator.',
      },
    },
  },
};

export const StaggeredAnimation: Story = {
  args: {
    entries: sampleEntries.slice(0, 4), // First 4 messages
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Showcase of staggered entrance animations with optimized timing delays.',
      },
    },
  },
};

export const MobileView: Story = {
  args: {
    entries: sampleEntries,
    isTyping: true,
    currentAgent: 'Claude',
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Timeline view optimized for mobile devices with touch-friendly scrolling.',
      },
    },
  },
};

export const TabletView: Story = {
  args: {
    entries: longConversation,
    isTyping: false,
    currentAgent: 'Claude',
  },
  parameters: {
    viewport: {
      defaultViewport: 'tablet',
    },
    docs: {
      description: {
        story: 'Timeline view on tablet devices showing responsive layout and scroll behavior.',
      },
    },
  },
};

export const PerformanceTest: Story = {
  args: {
    entries: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      type: i % 4 === 0 ? 'human' : i % 4 === 1 ? 'ai' : i % 4 === 2 ? 'tool' : 'admin',
      content: `Message ${i + 1}: This is a test message to evaluate timeline performance with many entries.`,
      agent: i % 3 === 0 ? 'Claude' : i % 3 === 1 ? 'GPT-4' : 'Gemini',
      timestamp: new Date(Date.now() - (20 - i) * 300000),
      ...(i % 4 === 2 && {
        tool: 'bash',
        result: {
          content: [{ type: 'text', text: `Command output for message ${i + 1}` }],
          isError: false,
        },
      }),
    })) as TimelineEntry[],
    isTyping: true,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Performance test with 20 messages showing optimized animation delays and smooth scrolling.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  args: {
    entries: longConversation,
    isTyping: true,
    currentAgent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demonstration showcasing all timeline features: auto-scroll, typing indicator, scroll-to-bottom button, and message animations.',
      },
    },
  },
};