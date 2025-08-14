/** PARKED STORY — not in active use, see STORYBOOK_MIGRATION_GUIDE.md */
// ABOUTME: Storybook story for VoiceRecognitionUI.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { VoiceRecognitionUI, CompactVoiceButton } from './VoiceRecognitionUI';

const meta: Meta<typeof VoiceRecognitionUI> = {
  title: 'Molecules/VoiceRecognitionUI',
  component: VoiceRecognitionUI,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## VoiceRecognitionUI

**Atomic Classification**: Voice Input Molecule  
**Composed of**: IconButton + StatusDot + ProgressBar + MessageText + TimestampDisplay atoms  
**Single Responsibility**: Complete voice recognition interface with visual feedback and transcript display

### Purpose
A cohesive molecule that combines 4-5 atoms to solve the specific UI pattern of voice input recognition. Handles microphone control, audio visualization, transcript display, and error states in a single, interactive component.

### When to Use
- Voice input features in chat interfaces
- Audio recording controls
- Speech-to-text functionality
- Accessibility voice commands
- Voice notes and dictation

### Atomic Composition
- **IconButton**: Microphone toggle button with visual state changes
- **StatusDot**: Visual indicator for recording state with pulsing animation
- **ProgressBar**: Audio level visualization with gradient colors
- **MessageText**: Transcript display with interim and final text
- **TimestampDisplay**: Confidence indicators and error messages
- **Animation Elements**: Waveform visualization and pulsing effects

### Design Tokens Used
- **Colors**: Primary colors for inactive, red for active recording state
- **Animations**: Pulsing rings, waveform bars, and smooth transitions
- **Spacing**: Consistent gap-4 between components and p-4 padding
- **Typography**: Font-medium for labels, smaller text for confidence
- **Shadows**: Elevated appearance with shadow-lg for active states

### Voice States
- **idle**: Ready to start recording with primary button styling
- **listening**: Active recording with red styling and animations
- **transcribing**: Processing audio with loading indicators
- **error**: Error state with red error message display

### State Management
- **isListening**: Controls recording state and visual feedback
- **transcript**: Final transcribed text display
- **interimTranscript**: Real-time transcription preview
- **confidence**: Accuracy indicator for transcription quality
- **error**: Error message display for recording failures

### Accessibility
- Proper ARIA labels for screen readers
- Keyboard navigation support (Space/Enter to toggle)
- Clear visual indicators for all states
- High contrast mode compatibility
- Voice commands for accessibility features

### Composition Guidelines
✓ **Do**: Use in chat organisms and voice-enabled templates  
✓ **Do**: Combine atoms logically for voice interaction  
✓ **Do**: Maintain single responsibility for voice input  
✓ **Do**: Provide clear visual feedback for all states  
✗ **Don't**: Mix unrelated audio functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create complex nested voice interfaces
        `,
      },
    },
  },
  argTypes: {
    isListening: {
      control: { type: 'boolean' },
      description: 'Whether the voice recognition is currently active',
    },
    transcript: {
      control: { type: 'text' },
      description: 'The final transcribed text',
    },
    interimTranscript: {
      control: { type: 'text' },
      description: 'The current interim transcription',
    },
    confidence: {
      control: { type: 'range', min: 0, max: 1, step: 0.1 },
      description: 'Confidence level of the transcription (0-1)',
    },
    error: {
      control: { type: 'text' },
      description: 'Error message to display',
    },
    className: {
      control: { type: 'text' },
      description: 'Additional CSS classes',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Interactive wrapper component
interface VoiceRecognitionWrapperProps {
  initialListening?: boolean;
  [key: string]: unknown;
}

const VoiceRecognitionWrapper = ({
  initialListening = false,
  ...props
}: VoiceRecognitionWrapperProps) => {
  const [isListening, setIsListening] = useState(initialListening);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState('');

  const handleStartListening = () => {
    setIsListening(true);
    setError('');
    setTranscript('');
    setInterimTranscript('');

    // Simulate voice recognition progress
    setTimeout(() => {
      setInterimTranscript('Hello, I need help with...');
      setConfidence(0.4);
    }, 1000);

    setTimeout(() => {
      setInterimTranscript('Hello, I need help with implementing voice recognition...');
      setConfidence(0.7);
    }, 2000);

    setTimeout(() => {
      setTranscript('Hello, I need help with implementing voice recognition in my application.');
      setInterimTranscript('');
      setConfidence(0.9);
      setIsListening(false);
    }, 3000);
  };

  const handleStopListening = () => {
    setIsListening(false);
    setInterimTranscript('');
    if (interimTranscript) {
      setTranscript(interimTranscript);
      setConfidence(0.8);
    }
  };

  return (
    <div className="w-full max-w-md">
      <VoiceRecognitionUI
        isListening={isListening}
        onStartListening={handleStartListening}
        onStopListening={handleStopListening}
        transcript={transcript}
        interimTranscript={interimTranscript}
        confidence={confidence}
        error={error}
        {...props}
      />
    </div>
  );
};

export const Default: Story = {
  render: () => <VoiceRecognitionWrapper />,
};

export const Listening: Story = {
  render: () => <VoiceRecognitionWrapper initialListening={true} />,
};

export const WithTranscript: Story = {
  args: {
    isListening: false,
    transcript: 'Hello, I need help with implementing voice recognition in my application.',
    confidence: 0.9,
  },
};

export const WithInterimTranscript: Story = {
  args: {
    isListening: true,
    interimTranscript: 'Hello, I need help with implementing...',
    confidence: 0.6,
  },
};

export const WithError: Story = {
  args: {
    isListening: false,
    error: 'Microphone access denied. Please allow microphone permissions and try again.',
  },
};

export const LowConfidence: Story = {
  args: {
    isListening: false,
    transcript: 'Hello, I need help with something unclear.',
    confidence: 0.3,
  },
};

export const HighConfidence: Story = {
  args: {
    isListening: false,
    transcript: 'Hello, I need help with implementing voice recognition in my application.',
    confidence: 0.95,
  },
};

export const CompactVoiceButtonDemo: Story = {
  render: () => {
    const [isListening, setIsListening] = useState(false);

    const handleToggle = () => {
      setIsListening(!isListening);
      if (!isListening) {
        setTimeout(() => setIsListening(false), 3000);
      }
    };

    return (
      <div className="flex flex-col items-center gap-6">
        <h3 className="text-lg font-semibold">Compact Voice Button</h3>
        <div className="flex gap-4 items-center">
          <CompactVoiceButton isListening={isListening} onToggle={handleToggle} size="sm" />
          <CompactVoiceButton isListening={isListening} onToggle={handleToggle} size="md" />
          <CompactVoiceButton isListening={isListening} onToggle={handleToggle} size="lg" />
        </div>
        <div className="flex gap-4 items-center">
          <CompactVoiceButton isListening={isListening} onToggle={handleToggle} variant="ghost" />
          <CompactVoiceButton isListening={isListening} onToggle={handleToggle} variant="outline" />
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Compact voice button variations for inline use.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Voice Recognition Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then interact with the voice recognition
          interface!
        </p>
      </div>

      <div className="cursor-pointer transition-transform hover:scale-[1.02]">
        <VoiceRecognitionWrapper />
      </div>

      <div className="text-sm text-gray-600 space-y-1">
        <p>
          • <strong>Click microphone</strong> to start voice recognition simulation
        </p>
        <p>
          • <strong>Watch animations</strong> during recording state
        </p>
        <p>
          • <strong>View transcript</strong> progress and confidence indicators
        </p>
        <p>
          • <strong>Hover elements</strong> for tennis commentary feedback!
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing voice recognition with tennis commentary. Enable commentary in the toolbar and interact with the interface!',
      },
    },
  },
};
