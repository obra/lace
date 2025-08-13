// ABOUTME: Storybook story for ChatInputComposer.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import ChatInputComposer from './ChatInputComposer';
import type { AttachedFile } from './FileAttachment';

const meta: Meta<typeof ChatInputComposer> = {
  title: 'Molecules/ChatInputComposer',
  component: ChatInputComposer,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## ChatInputComposer

**Atomic Classification**: Input Molecule  
**Composed of**: ChatTextarea + VoiceButton + FileAttachButton + SendButton atoms  
**Single Responsibility**: Complete chat message composition with multimodal input

### Purpose

A cohesive unit that combines 2-5 atoms to solve the specific UI pattern of chat message composition. Handles text input, voice recording, file attachments, and submission in a single, reusable component.

### When to Use

- Primary chat interfaces
- Message composition areas
- Multi-modal input forms
- Anywhere users need to create rich messages

### Atomic Composition

- **ChatTextarea**: Auto-resizing text input with drag-and-drop
- **VoiceButton**: Voice recording toggle (optional)
- **FileAttachButton**: File attachment selection (optional)
- **SendButton**: Submit/stop action based on state
- **FileAttachment**: File preview and management

### Design Tokens Used

- **Layout**: Flexbox composition with responsive spacing
- **Colors**: Inherits from composed atoms (teal, red, neutral)
- **Spacing**: Consistent gap-2 between atoms
- **Typography**: Follows atom typography scales
- **Shadows**: Subtle elevation for the container

### Accessibility

- Maintains focus management across atoms
- Proper tab order through composed elements
- Screen reader announcements for state changes
- Keyboard shortcuts (Enter to send, Escape to cancel)

### State Management

- **value**: Text content state
- **isListening**: Voice recording state
- **isStreaming**: Submit/stop mode toggle
- **attachedFiles**: File attachment state
- **disabled**: Cascades to all composed atoms

### Composition Guidelines

✓ **Do**: Use in organisms like chat interfaces  
✓ **Do**: Compose multiple atoms logically  
✓ **Do**: Handle interaction patterns between atoms  
✓ **Do**: Maintain single responsibility for message composition  
✗ **Don't**: Mix unrelated functionality  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create tightly coupled dependencies
        `,
      },
    },
  },
  argTypes: {
    value: {
      control: { type: 'text' },
      description: 'The current input value',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the input is disabled',
    },
    isListening: {
      control: { type: 'boolean' },
      description: 'Whether voice input is active',
    },
    isStreaming: {
      control: { type: 'boolean' },
      description: 'Whether the agent is streaming a response',
    },
    placeholder: {
      control: { type: 'text' },
      description: 'Placeholder text for the input',
    },
    showVoiceButton: {
      control: { type: 'boolean' },
      description: 'Whether to show the voice button',
    },
    showFileAttachment: {
      control: { type: 'boolean' },
      description: 'Whether to show file attachment functionality',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

interface ChatInputWrapperProps {
  initialValue?: string;
  disabled?: boolean;
  placeholder?: string;
  showVoiceButton?: boolean;
  showFileAttachment?: boolean;
}

// Interactive wrapper component
const ChatInputWrapper = ({ initialValue = '', ...props }: ChatInputWrapperProps) => {
  const [value, setValue] = useState(initialValue);
  const [isListening, setIsListening] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const handleSubmit = () => {
    console.log('Message sent with value:', value);
    setValue('');
  };

  const handleStartVoice = () => {
    setIsListening(true);
    setTimeout(() => setIsListening(false), 3000); // Auto-stop after 3 seconds for demo
  };

  const handleStopVoice = () => {
    setIsListening(false);
  };

  const handleInterrupt = () => {
    setIsStreaming(false);
    console.log('Interrupted');
  };

  const handleFilesAttached = (files: AttachedFile[]) => {
    setAttachedFiles([...attachedFiles, ...files]);
  };

  const handleFileRemoved = (fileId: string) => {
    setAttachedFiles(attachedFiles.filter((f) => f.id !== fileId));
  };

  const handleFileCleared = () => {
    setAttachedFiles([]);
  };

  return (
    <div className="w-full max-w-2xl">
      <ChatInputComposer
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        isListening={isListening}
        onStartVoice={handleStartVoice}
        onStopVoice={handleStopVoice}
        onInterrupt={handleInterrupt}
        isStreaming={isStreaming}
        attachedFiles={attachedFiles}
        onFilesAttached={handleFilesAttached}
        onFileRemoved={handleFileRemoved}
        onFileCleared={handleFileCleared}
        {...props}
      />
    </div>
  );
};

export const Default: Story = {
  render: () => <ChatInputWrapper />,
};

export const WithPlaceholder: Story = {
  render: () => <ChatInputWrapper placeholder="Ask me anything..." />,
};

export const WithInitialValue: Story = {
  render: () => <ChatInputWrapper initialValue="Hello! How can I help you today?" />,
};

export const Disabled: Story = {
  render: () => <ChatInputWrapper disabled={true} />,
};

export const WithoutVoiceButton: Story = {
  render: () => <ChatInputWrapper showVoiceButton={false} />,
};

export const WithoutFileAttachment: Story = {
  render: () => <ChatInputWrapper showFileAttachment={false} />,
};

export const SafeFileAttachmentTest: Story = {
  render: () => (
    <div className="w-full max-w-2xl">
      <p className="text-sm text-gray-600 mb-4">
        This story tests the chat input with file attachments disabled to avoid URL.createObjectURL
        issues.
      </p>
      <ChatInputComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        showFileAttachment={false}
        placeholder="File attachments disabled for safe testing..."
      />
    </div>
  ),
};

export const VoiceListening: Story = {
  render: () => {
    const [isListening, setIsListening] = useState(true);
    return (
      <div className="w-full max-w-2xl">
        <ChatInputComposer
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          isListening={isListening}
          onStartVoice={() => setIsListening(true)}
          onStopVoice={() => setIsListening(false)}
          placeholder="Listening..."
        />
      </div>
    );
  },
};

export const StreamingState: Story = {
  render: () => {
    const [isStreaming, setIsStreaming] = useState(true);
    return (
      <div className="w-full max-w-2xl">
        <ChatInputComposer
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          isStreaming={isStreaming}
          onInterrupt={() => setIsStreaming(false)}
          placeholder="Press ESC to interrupt..."
        />
      </div>
    );
  },
};

export const WithAttachedFiles: Story = {
  render: () => {
    // Create proper mock File objects to avoid URL.createObjectURL issues
    const createMockFile = (name: string, size: number, type: string): File => {
      try {
        const content = type.startsWith('image/')
          ? // Create a minimal valid JPEG header for image files
            new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
          : // Create text content for other files
            new TextEncoder().encode(`Mock content for ${name}`);

        return new File([content], name, { type, lastModified: Date.now() });
      } catch (error) {
        // Fallback to minimal file if creation fails
        return new File([''], name, { type, lastModified: Date.now() });
      }
    };

    const [attachedFiles] = useState([
      {
        id: '1',
        name: 'document.pdf',
        size: 1024000,
        type: 'application/pdf',
        file: createMockFile('document.pdf', 1024000, 'application/pdf'),
      },
      {
        id: '2',
        name: 'report.txt',
        size: 5120,
        type: 'text/plain',
        file: createMockFile('report.txt', 5120, 'text/plain'),
      },
    ]);

    return (
      <div className="w-full max-w-2xl">
        <ChatInputComposer
          value=""
          onChange={() => {}}
          onSubmit={() => {}}
          attachedFiles={attachedFiles}
          onFilesAttached={() => {}}
          onFileRemoved={() => {}}
          onFileCleared={() => {}}
        />
      </div>
    );
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-8 w-full max-w-2xl">
      <div>
        <h3 className="text-lg font-semibold mb-2">Default State</h3>
        <ChatInputWrapper />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">With Content</h3>
        <ChatInputWrapper initialValue="This is a sample message that shows how the input looks with content..." />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Disabled State</h3>
        <ChatInputWrapper disabled={true} />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Minimal (No Voice/Files)</h3>
        <ChatInputWrapper showVoiceButton={false} showFileAttachment={false} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available states of the chat input composer.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const [value, setValue] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [messages, setMessages] = useState<string[]>([]);

    // Create proper mock File objects
    const createMockFile = (name: string, size: number, type: string): File => {
      try {
        const content = type.startsWith('image/')
          ? // Create a minimal valid JPEG header for image files
            new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
          : // Create text content for other files
            new TextEncoder().encode(`Mock content for ${name}`);

        return new File([content], name, { type, lastModified: Date.now() });
      } catch (error) {
        // Fallback to minimal file if creation fails
        return new File([''], name, { type, lastModified: Date.now() });
      }
    };

    const handleSubmit = () => {
      if (value.trim()) {
        setMessages([...messages, value]);
        setValue('');

        // Simulate AI response
        setIsStreaming(true);
        setTimeout(() => {
          setIsStreaming(false);
          setMessages((prev) => [...prev, `AI: Thanks for your message! You said: "${value}"`]);
        }, 2000);
      }
    };

    const handleStartVoice = () => {
      setIsListening(true);
      // Simulate voice input
      setTimeout(() => {
        setIsListening(false);
        setValue('This is a voice message that was transcribed automatically');
      }, 3000);
    };

    const handleStopVoice = () => {
      setIsListening(false);
    };

    const handleInterrupt = () => {
      setIsStreaming(false);
    };

    const handleFilesAttached = (files: AttachedFile[]) => {
      // Ensure files have proper File objects
      const filesWithMockData = files.map((file) => ({
        ...file,
        file: file.file || createMockFile(file.name, file.size, file.type),
      }));
      setAttachedFiles([...attachedFiles, ...filesWithMockData]);
    };

    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(attachedFiles.filter((f) => f.id !== fileId));
    };

    const handleFileCleared = () => {
      setAttachedFiles([]);
    };

    return (
      <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">
            🎾 Chat Input Composer Tennis Commentary Demo
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Enable tennis commentary in the toolbar above, then interact with the chat input below!
          </p>
        </div>

        {/* Message History */}
        <div className="bg-gray-50 rounded-lg p-4 h-48 overflow-y-auto">
          <h4 className="font-medium mb-2">Chat History:</h4>
          {messages.length === 0 ? (
            <p className="text-gray-500 text-sm">No messages yet. Try sending a message!</p>
          ) : (
            <div className="space-y-2">
              {messages.map((msg, index) => (
                <div key={index} className="text-sm">
                  <span className={msg.startsWith('AI:') ? 'text-blue-600' : 'text-gray-800'}>
                    {msg}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interactive Chat Input */}
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChatInputComposer
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            isListening={isListening}
            onStartVoice={handleStartVoice}
            onStopVoice={handleStopVoice}
            onInterrupt={handleInterrupt}
            isStreaming={isStreaming}
            attachedFiles={attachedFiles}
            onFilesAttached={handleFilesAttached}
            onFileRemoved={handleFileRemoved}
            onFileCleared={handleFileCleared}
            placeholder="Type your message, try voice input, or attach files..."
          />
        </div>

        {/* Instructions */}
        <div className="text-sm text-gray-600 space-y-1">
          <p>
            • <strong>Type and send</strong> messages to see them appear above
          </p>
          <p>
            • <strong>Voice button</strong> simulates voice input (3 second demo)
          </p>
          <p>
            • <strong>File attachment</strong> supports drag & drop or click to select
          </p>
          <p>
            • <strong>Hover and click</strong> elements for tennis commentary!
          </p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing the chat input composer with tennis commentary. Enable commentary in the toolbar and interact with the input!',
      },
    },
  },
};
