// ABOUTME: Storybook story for TypingIndicator.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { TypingIndicator } from './TypingIndicator';

const meta: Meta<typeof TypingIndicator> = {
  title: 'Organisms/TypingIndicator',
  component: TypingIndicator,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## TypingIndicator

**Atomic Classification**: Feedback Organism  
**Composed of**: Avatar atoms, animated dots, and agent badges  
**Business Logic**: Real-time typing state visualization with agent-specific styling

### Purpose
A specialized organism that provides immediate feedback during AI response generation. Uses agent-specific colors and animated elements to indicate active processing state while maintaining conversation context.

### When to Use
- AI agent response generation
- Real-time conversation interfaces
- Multi-agent environments
- Streaming response feedback
- User engagement during processing

### Atomic Composition
- **Avatar** atom with agent-specific colors
- **AgentBadge** atom for agent identification
- **Animated dots** atoms with staggered animation
- **Container** molecule for layout and spacing
- **Typography** atoms for agent names

### Design Tokens Used
- **Colors**: Agent-specific schemes (orange for Claude, blue for GPT-4, purple for Gemini)
- **Animation**: Staggered dot animation with 0.4s intervals
- **Spacing**: Consistent gap-3 between avatar and content
- **Typography**: Agent name styling with proper hierarchy
- **Timing**: Smooth transitions for state changes

### Agent Support
- **Claude**: Orange theme with robot icon
- **GPT-4**: Blue theme with OpenAI branding
- **Gemini**: Purple theme with Google styling
- **Custom Agents**: Default gray theme with fallback styling

### Animation Details
- **Dot Animation**: Three dots with staggered 0.4s delay
- **Fade Transitions**: Smooth opacity changes
- **Pulse Effect**: Subtle breathing animation
- **Accessibility**: Respects prefers-reduced-motion

### State Management
- **Agent**: String determining color scheme and branding
- **Visibility**: Conditional rendering based on typing state
- **Animation**: CSS-based with performance optimization
- **Accessibility**: Screen reader announcements

### Accessibility
- Screen reader announcements for typing state
- Reduced motion support for animation
- High contrast mode compatibility
- Semantic HTML structure
- Keyboard navigation support

### Organism Guidelines
✓ **Do**: Use for real-time feedback during AI processing  
✓ **Do**: Maintain agent-specific color consistency  
✓ **Do**: Provide smooth transitions  
✓ **Do**: Support accessibility features  
✗ **Don't**: Use for static content or completed responses  
✗ **Don't**: Override agent color schemes  
✗ **Don't**: Disable animations without user preference
        `,
      },
    },
  },
  argTypes: {
    agent: {
      control: { type: 'select' },
      options: ['Claude', 'GPT-4', 'Gemini', 'Custom Agent'],
      description: 'The agent name that determines the color and styling',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Claude: Story = {
  args: {
    agent: 'Claude',
  },
};

export const GPT4: Story = {
  args: {
    agent: 'GPT-4',
  },
};

export const Gemini: Story = {
  args: {
    agent: 'Gemini',
  },
};

export const CustomAgent: Story = {
  args: {
    agent: 'Custom Agent',
  },
};

export const AllAgents: Story = {
  render: () => (
    <div className="flex flex-col gap-6 w-full max-w-2xl">
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Claude</h3>
        <TypingIndicator agent="Claude" />
      </div>
      
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">GPT-4</h3>
        <TypingIndicator agent="GPT-4" />
      </div>
      
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Gemini</h3>
        <TypingIndicator agent="Gemini" />
      </div>
      
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Custom Agent</h3>
        <TypingIndicator agent="Custom Agent" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available agent types with their respective colors and styling.',
      },
    },
  },
};

export const ConversationContext: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
            U
          </div>
        </div>
        <div className="bg-base-100 border border-base-300 rounded-2xl px-4 py-3">
          <p className="text-base-content">
            Can you help me understand how React hooks work?
          </p>
        </div>
      </div>
      
      <TypingIndicator agent="Claude" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Typing indicator shown in conversation context after a user message.',
      },
    },
  },
};

export const MultipleAgents: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
            U
          </div>
        </div>
        <div className="bg-base-100 border border-base-300 rounded-2xl px-4 py-3">
          <p className="text-base-content">
            Compare the performance of different sorting algorithms
          </p>
        </div>
      </div>
      
      <TypingIndicator agent="Claude" />
      <TypingIndicator agent="GPT-4" />
      <TypingIndicator agent="Gemini" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple agents typing simultaneously (hypothetical scenario).',
      },
    },
  },
};

export const DarkMode: Story = {
  render: () => (
    <div className="bg-gray-900 p-6 rounded-lg" data-theme="dark">
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
              U
            </div>
          </div>
          <div className="bg-base-100 border border-base-300 rounded-2xl px-4 py-3">
            <p className="text-base-content">
              What&apos;s the best approach for state management in React?
            </p>
          </div>
        </div>
        
        <TypingIndicator agent="Claude" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Typing indicator in dark mode theme.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const agents = ['Claude', 'GPT-4', 'Gemini', 'Custom Agent'];
    
    return (
      <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">🎾 Typing Indicator Tennis Commentary Demo</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enable tennis commentary in the toolbar above, then hover and click the typing indicators below!
          </p>
        </div>
        
        <div className="space-y-6">
          {agents.map((agent) => (
            <div key={agent} className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">{agent}</h4>
                <span className="text-sm text-gray-500">is typing...</span>
              </div>
              <TypingIndicator agent={agent} />
            </div>
          ))}
        </div>
        
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Conversation Simulation</h4>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-medium">
                  U
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                <p className="text-gray-800">
                  Explain the difference between async/await and promises
                </p>
              </div>
            </div>
            
            <div className="cursor-pointer hover:bg-blue-100 p-2 rounded transition-colors">
              <TypingIndicator agent="Claude" />
            </div>
          </div>
        </div>
        
        <div className="text-sm text-gray-600 space-y-1">
          <p>• <strong>Notice the colors</strong> - each agent has a unique color scheme</p>
          <p>• <strong>Hover and click</strong> the indicators for tennis commentary</p>
          <p>• <strong>Animated dots</strong> show the typing progress with staggered animation</p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing typing indicators with tennis commentary. Enable commentary in the toolbar and interact with the indicators!',
      },
    },
  },
};