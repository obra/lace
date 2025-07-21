import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedTypingIndicator } from './AnimatedTypingIndicator';

const meta: Meta<typeof AnimatedTypingIndicator> = {
  title: 'Organisms/AnimatedTypingIndicator',
  component: AnimatedTypingIndicator,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Animated typing indicator component with agent-specific styling, pulsing effects, and smooth animations. Used in timeline views to show when AI agents are actively thinking and responding.',
      },
    },
  },
  argTypes: {
    agent: {
      description: 'Name of the AI agent currently typing',
      control: { type: 'select', options: ['Claude', 'GPT-4', 'Gemini', 'Custom Agent'] },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AnimatedTypingIndicator>;

export const Claude: Story = {
  args: {
    agent: 'Claude',
  },
  parameters: {
    docs: {
      description: {
        story: 'Claude typing indicator with orange branding, pulsing avatar, and animated dots.',
      },
    },
  },
};

export const GPT4: Story = {
  args: {
    agent: 'GPT-4',
  },
  parameters: {
    docs: {
      description: {
        story: 'GPT-4 typing indicator with green branding and smooth animations.',
      },
    },
  },
};

export const Gemini: Story = {
  args: {
    agent: 'Gemini',
  },
  parameters: {
    docs: {
      description: {
        story: 'Gemini typing indicator with blue branding and pulsing effects.',
      },
    },
  },
};

export const CustomAgent: Story = {
  args: {
    agent: 'Custom Agent',
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom agent typing indicator with default gray styling for unknown agents.',
      },
    },
  },
};

export const AllAgents: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-4">🤖 All AI Agents</h3>
        <div className="space-y-6">
          <div>
            <div className="text-sm font-medium mb-2 text-base-content/70">Claude (Orange)</div>
            <AnimatedTypingIndicator agent="Claude" />
          </div>
          <div>
            <div className="text-sm font-medium mb-2 text-base-content/70">GPT-4 (Green)</div>
            <AnimatedTypingIndicator agent="GPT-4" />
          </div>
          <div>
            <div className="text-sm font-medium mb-2 text-base-content/70">Gemini (Blue)</div>
            <AnimatedTypingIndicator agent="Gemini" />
          </div>
          <div>
            <div className="text-sm font-medium mb-2 text-base-content/70">Unknown Agent (Gray)</div>
            <AnimatedTypingIndicator agent="Unknown Agent" />
          </div>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comparison of all typing indicators showing different agent branding and color schemes.',
      },
    },
  },
};

export const AnimationFeatures: Story = {
  render: () => (
    <div className="space-y-8 max-w-3xl">
      <div className="bg-base-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">✨ Animation Features</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h4 className="font-medium mb-2">Avatar Animations</h4>
            <ul className="space-y-1 text-base-content/70">
              <li>• Entrance: Scale + rotation animation</li>
              <li>• Pulsing: Continuous shadow pulse</li>
              <li>• Agent-specific colors</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Dot Animations</h4>
            <ul className="space-y-1 text-base-content/70">
              <li>• Staggered scale animation</li>
              <li>• Opacity breathing effect</li>
              <li>• Infinite loop with easing</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Container Effects</h4>
            <ul className="space-y-1 text-base-content/70">
              <li>• Smooth entrance animation</li>
              <li>• Hover lift effect</li>
              <li>• Shadow and scale transitions</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Text Animations</h4>
            <ul className="space-y-1 text-base-content/70">
              <li>• Breathing opacity effect</li>
              <li>• Agent name display</li>
              <li>• Subtle color transitions</li>
            </ul>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <div className="text-sm font-medium text-base-content/70">Try hovering over the indicators:</div>
        <div className="space-y-4">
          <AnimatedTypingIndicator agent="Claude" />
          <AnimatedTypingIndicator agent="GPT-4" />
          <AnimatedTypingIndicator agent="Gemini" />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcase of all animation features including hover effects, pulsing, and entrance animations.',
      },
    },
  },
};

export const DarkTheme: Story = {
  args: {
    agent: 'Claude',
  },
  decorators: [
    (Story) => (
      <div data-theme="dark" className="bg-base-300 p-8 rounded-lg">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Typing indicator in dark theme showing proper contrast and visibility.',
      },
    },
  },
};

export const LightTheme: Story = {
  args: {
    agent: 'Gemini',
  },
  decorators: [
    (Story) => (
      <div data-theme="light" className="bg-base-100 p-8 rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Typing indicator in light theme with clean, bright appearance.',
      },
    },
  },
};

export const ConversationContext: Story = {
  render: () => (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-base-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">💬 Conversation Context</h3>
        <p className="text-sm text-base-content/70">
          This shows how the typing indicator appears in a real conversation context
        </p>
      </div>
      
      <div className="space-y-4">
        {/* Human message */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-md bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
            U
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium mb-1">You</div>
            <div className="text-sm text-base-content">
              Can you help me optimize my React application for better performance?
            </div>
          </div>
        </div>
        
        {/* Typing indicator */}
        <AnimatedTypingIndicator agent="Claude" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Typing indicator shown in conversation context with user message above.',
      },
    },
  },
};

export const MobileView: Story = {
  args: {
    agent: 'Claude',
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
    docs: {
      description: {
        story: 'Typing indicator optimized for mobile devices with touch-friendly sizing.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-base-200 rounded-lg p-4">
        <h3 className="font-semibold mb-2">🎮 Interactive Demo</h3>
        <p className="text-sm text-base-content/70">
          Hover over the indicators to see lift effects and smooth transitions
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-medium mb-2 text-base-content/70">Claude Assistant</div>
          <AnimatedTypingIndicator agent="Claude" />
        </div>
        <div>
          <div className="text-sm font-medium mb-2 text-base-content/70">GPT-4 Assistant</div>
          <AnimatedTypingIndicator agent="GPT-4" />
        </div>
        <div>
          <div className="text-sm font-medium mb-2 text-base-content/70">Gemini Assistant</div>
          <AnimatedTypingIndicator agent="Gemini" />
        </div>
        <div>
          <div className="text-sm font-medium mb-2 text-base-content/70">Custom Assistant</div>
          <AnimatedTypingIndicator agent="Custom AI" />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demonstration of all typing indicators with hover effects and animations.',
      },
    },
  },
};