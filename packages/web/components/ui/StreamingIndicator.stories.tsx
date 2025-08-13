// ABOUTME: Storybook story for StreamingIndicator.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { StreamingIndicator } from './StreamingIndicator';

const meta: Meta<typeof StreamingIndicator> = {
  title: 'Molecules/StreamingIndicator',
  component: StreamingIndicator,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## StreamingIndicator

**Atomic Classification**: Feedback Status Molecule  
**Composed of**: Avatar + IconButton + MessageText + StatusDot + Container atoms  
**Single Responsibility**: Real-time streaming status display with agent identification and interrupt capability

### Purpose
A floating status indicator molecule that provides real-time feedback for streaming AI responses. Combines agent identification, animated status indicators, and interrupt functionality into a cohesive overlay component for chat and messaging interfaces.

### When to Use
- AI chat interfaces with streaming responses
- Real-time communication systems
- Long-running operations with progress feedback
- Voice-to-text or speech recognition interfaces
- Live data processing and analysis displays

### Atomic Composition
- **Avatar**: Agent identification with gradient background
- **IconButton**: Stop/interrupt button with hover states
- **MessageText**: Agent name and status text
- **StatusDot**: Animated pulsing indicators with staggered timing
- **Container**: Floating positioned container with shadow
- **Background**: Subtle backdrop with blur effects

### Design Tokens Used
- **Colors**: Agent-specific gradients (orange for Claude, robot icon)
- **Positioning**: Fixed positioning with center alignment
- **Spacing**: Consistent padding (px-4 py-2) and gaps (gap-3)
- **Typography**: Font-medium for agent names, subtle sizing
- **Shadows**: Elevated shadow (shadow-lg) for floating effect
- **Animations**: Staggered pulse animations for status dots
- **Borders**: Rounded full design for modern appearance

### Streaming Features
- **Agent Identification**: Shows which AI agent is responding
- **Animated Status**: Three pulsing dots with timing delays
- **Interrupt Button**: Red stop button for canceling responses
- **Floating Design**: Non-intrusive overlay positioning
- **Auto-hide**: Visibility controlled by streaming state
- **Keyboard Support**: ESC key hint for interrupt action

### Visual States
- **Visible**: Active streaming with full interface
- **Hidden**: Completely hidden when not streaming
- **Interactive**: Hover states for interrupt button
- **Animated**: Continuous pulsing animation for status

### Agent Support
- **Claude**: Default orange gradient with robot icon
- **Custom Agents**: Configurable agent names and styling
- **Extensible**: Easy to add new agent types and colors
- **Consistent**: Unified design across all agent types

### Integration Points
- **FontAwesome Icons**: Robot and stop icons with consistent styling
- **Fixed Positioning**: Top-center overlay that doesn't interfere with content
- **Event Handling**: Proper click and keyboard event management
- **Animation Timing**: CSS animation delays for smooth pulsing
- **Conditional Rendering**: Proper visibility management

### Accessibility
- **Keyboard Navigation**: ESC key support for interrupting
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators for interactive elements
- **High Contrast**: Readable text and button colors
- **Color Independence**: Icons and text provide non-color information

### Molecule Guidelines
✓ **Do**: Use for streaming AI responses and real-time feedback  
✓ **Do**: Provide interrupt functionality for user control  
✓ **Do**: Position non-intrusively as floating overlay  
✓ **Do**: Include agent identification and status animation  
✗ **Don't**: Use for static status displays  
✗ **Don't**: Block user interaction with content  
✗ **Don't**: Skip interrupt functionality for long operations
        `,
      },
    },
  },
  argTypes: {
    isVisible: {
      control: { type: 'boolean' },
      description: 'Whether the streaming indicator is visible',
    },
    agent: {
      control: { type: 'text' },
      description: 'Name of the AI agent that is responding',
    },
    onInterrupt: {
      action: 'interrupted',
      description: 'Callback when interrupt button is clicked',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isVisible: true,
    agent: 'Claude',
  },
  render: (args) => (
    <div className="w-full h-96 bg-base-200 relative">
      <div className="p-8">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-4">Chat Interface</h3>
          <div className="space-y-4">
            <div className="bg-base-100 p-4 rounded-lg text-left">
              <div className="text-sm font-medium mb-2">You</div>
              <div className="text-sm">Can you help me understand quantum computing?</div>
            </div>
            <div className="bg-primary/10 p-4 rounded-lg text-left">
              <div className="text-sm font-medium mb-2">Claude</div>
              <div className="text-sm">Quantum computing is a fascinating field that leverages quantum mechanical phenomena...</div>
            </div>
          </div>
        </div>
      </div>
      <StreamingIndicator {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default streaming indicator showing Claude responding with interrupt capability.',
      },
    },
  },
};

export const WithoutInterrupt: Story = {
  args: {
    isVisible: true,
    agent: 'Claude',
  },
  render: (args) => (
    <div className="w-full h-96 bg-base-200 relative">
      <div className="p-8">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-4">Read-Only Mode</h3>
          <p className="text-sm text-base-content/60 mb-4">
            Streaming indicator without interrupt button
          </p>
          <div className="bg-base-100 p-4 rounded-lg">
            <div className="text-sm">Processing your request...</div>
          </div>
        </div>
      </div>
      <StreamingIndicator {...args} onInterrupt={undefined} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Streaming indicator without interrupt button for read-only scenarios.',
      },
    },
  },
};

export const DifferentAgents: Story = {
  render: () => {
    const [currentAgent, setCurrentAgent] = useState('Claude');
    const agents = ['Claude', 'GPT-4', 'Gemini', 'LLaMA', 'Custom AI'];

    return (
      <div className="w-full h-96 bg-base-200 relative">
        <div className="p-8">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-4">Multi-Agent Interface</h3>
            <div className="space-y-4">
              <div className="flex gap-2 justify-center">
                {agents.map((agent) => (
                  <button
                    key={agent}
                    onClick={() => setCurrentAgent(agent)}
                    className={`btn btn-sm ${currentAgent === agent ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {agent}
                  </button>
                ))}
              </div>
              <div className="bg-base-100 p-4 rounded-lg">
                <div className="text-sm">
                  Current agent: <span className="font-medium">{currentAgent}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <StreamingIndicator
          isVisible={true}
          agent={currentAgent}
          onInterrupt={() => alert(`Interrupted ${currentAgent}`)}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Streaming indicator with different AI agents and dynamic agent switching.',
      },
    },
  },
};

export const AnimationDemo: Story = {
  render: () => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingTime, setStreamingTime] = useState(0);

    const startStreaming = () => {
      setIsStreaming(true);
      setStreamingTime(0);
      
      const interval = setInterval(() => {
        setStreamingTime((prev) => {
          if (prev >= 10) {
            clearInterval(interval);
            setIsStreaming(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    };

    const stopStreaming = () => {
      setIsStreaming(false);
      setStreamingTime(0);
    };

    return (
      <div className="w-full h-96 bg-base-200 relative">
        <div className="p-8">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-4">Animation Demo</h3>
            <div className="space-y-4">
              <div className="flex gap-2 justify-center">
                <button
                  onClick={startStreaming}
                  disabled={isStreaming}
                  className="btn btn-primary btn-sm"
                >
                  Start Streaming
                </button>
                <button
                  onClick={stopStreaming}
                  disabled={!isStreaming}
                  className="btn btn-error btn-sm"
                >
                  Stop Streaming
                </button>
              </div>
              <div className="bg-base-100 p-4 rounded-lg">
                <div className="text-sm">
                  Status: {isStreaming ? `Streaming for ${streamingTime}s` : 'Idle'}
                </div>
              </div>
            </div>
          </div>
        </div>
        <StreamingIndicator
          isVisible={isStreaming}
          agent="Claude"
          onInterrupt={stopStreaming}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showing streaming indicator appearing and disappearing with timer.',
      },
    },
  },
};

export const InChatInterface: Story = {
  render: () => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [messages, setMessages] = useState([
      { role: 'user', content: 'Hello, how can you help me today?' },
      { role: 'assistant', content: 'Hi! I\'m here to help you with any questions or tasks you have.' },
    ]);

    const simulateResponse = () => {
      setIsStreaming(true);
      setTimeout(() => {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: 'This is a simulated streaming response that demonstrates how the indicator works in a real chat interface.' 
        }]);
        setIsStreaming(false);
      }, 3000);
    };

    return (
      <div className="w-full h-96 bg-base-100 border border-base-300 rounded-lg relative">
        <div className="h-full flex flex-col">
          <div className="p-4 border-b border-base-300">
            <h3 className="text-lg font-semibold">Chat with Claude</h3>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] p-3 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-primary text-primary-content'
                        : 'bg-base-200 text-base-content'
                    }`}
                  >
                    <div className="text-sm">{message.content}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="p-4 border-t border-base-300">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type your message..."
                className="flex-1 input input-bordered input-sm"
              />
              <button
                onClick={simulateResponse}
                disabled={isStreaming}
                className="btn btn-primary btn-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>
        
        <StreamingIndicator
          isVisible={isStreaming}
          agent="Claude"
          onInterrupt={() => setIsStreaming(false)}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Streaming indicator in a complete chat interface showing real-world usage.',
      },
    },
  },
};

export const MobileView: Story = {
  render: () => (
    <div className="w-full max-w-sm mx-auto h-96 bg-base-100 border border-base-300 rounded-lg relative">
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4">Mobile Chat</h3>
        <div className="space-y-3">
          <div className="bg-base-200 p-3 rounded-lg">
            <div className="text-sm">What&apos;s the weather like?</div>
          </div>
          <div className="bg-primary/10 p-3 rounded-lg">
            <div className="text-sm">Let me check the current weather for you...</div>
          </div>
        </div>
      </div>
      <StreamingIndicator
        isVisible={true}
        agent="Claude"
        onInterrupt={() => alert('Interrupted on mobile')}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Streaming indicator adapted for mobile screen sizes and touch interfaces.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 StreamingIndicator Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then interact with the streaming indicators!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Basic Streaming</h4>
          <div className="h-64 bg-base-200 rounded-lg relative">
            <div className="p-4">
              <div className="text-sm text-base-content/60">AI Chat Interface</div>
              <div className="mt-4 bg-base-100 p-3 rounded">
                <div className="text-sm">Processing your request...</div>
              </div>
            </div>
            <StreamingIndicator
              isVisible={true}
              agent="Claude"
              onInterrupt={() => alert('Streaming interrupted!')}
            />
          </div>
        </div>
        
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Without Interrupt</h4>
          <div className="h-64 bg-base-200 rounded-lg relative">
            <div className="p-4">
              <div className="text-sm text-base-content/60">Read-Only Mode</div>
              <div className="mt-4 bg-base-100 p-3 rounded">
                <div className="text-sm">Generating response...</div>
              </div>
            </div>
            <StreamingIndicator
              isVisible={true}
              agent="GPT-4"
            />
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">StreamingIndicator Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Agent Identification</strong> - Shows which AI is responding</li>
          <li>• <strong>Animated Status</strong> - Pulsing dots indicate active streaming</li>
          <li>• <strong>Interrupt Control</strong> - Stop button for user control</li>
          <li>• <strong>Floating Design</strong> - Non-intrusive overlay positioning</li>
          <li>• <strong>Keyboard Support</strong> - ESC key for quick interruption</li>
          <li>• <strong>Auto-hide</strong> - Appears only when streaming is active</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing StreamingIndicator with tennis commentary. Enable commentary in the toolbar and interact with the indicators!',
      },
    },
  },
};