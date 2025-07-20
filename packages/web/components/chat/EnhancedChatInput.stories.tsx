import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { EnhancedChatInput } from './EnhancedChatInput';
import { AttachedFile } from '~/components/ui/FileAttachment';

const meta: Meta<typeof EnhancedChatInput> = {
  title: 'Organisms/EnhancedChatInput',
  component: EnhancedChatInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'Enhanced chat input component that provides a complete chat interface with advanced features like voice input, file attachments, and streaming support. This is a wrapper around ChatInputComposer with additional functionality for the main chat interface.',
      },
    },
  },
  argTypes: {
    value: {
      description: 'Current text input value',
      control: 'text',
    },
    onChange: {
      description: 'Callback when input value changes',
      action: 'changed',
    },
    onSubmit: {
      description: 'Callback when form is submitted',
      action: 'submitted',
    },
    disabled: {
      description: 'Whether input is disabled',
      control: 'boolean',
    },
    isListening: {
      description: 'Whether voice input is active',
      control: 'boolean',
    },
    onStartVoice: {
      description: 'Callback to start voice input',
      action: 'voice started',
    },
    onStopVoice: {
      description: 'Callback to stop voice input',
      action: 'voice stopped',
    },
    onInterrupt: {
      description: 'Callback to interrupt current operation',
      action: 'interrupted',
    },
    isStreaming: {
      description: 'Whether AI is currently streaming a response',
      control: 'boolean',
    },
    placeholder: {
      description: 'Placeholder text for input',
      control: 'text',
    },
    attachedFiles: {
      description: 'Currently attached files',
      control: 'object',
    },
    onFilesAttached: {
      description: 'Callback when files are attached',
      action: 'files attached',
    },
    onFileRemoved: {
      description: 'Callback when file is removed',
      action: 'file removed',
    },
    onFileCleared: {
      description: 'Callback when all files are cleared',
      action: 'files cleared',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof EnhancedChatInput>;

// Sample attached files for testing
const sampleFiles: AttachedFile[] = [
  {
    id: '1',
    name: 'document.pdf',
    size: 1024000,
    type: 'application/pdf',
    file: new File([''], 'document.pdf', { type: 'application/pdf' }),
  },
  {
    id: '2',
    name: 'image.png',
    size: 2048000,
    type: 'image/png',
    file: new File([''], 'image.png', { type: 'image/png' }),
  },
  {
    id: '3',
    name: 'script.js',
    size: 512000,
    type: 'application/javascript',
    file: new File([''], 'script.js', { type: 'application/javascript' }),
  },
];

export const Default: Story = {
  args: {
    value: '',
    disabled: false,
    isListening: false,
    isStreaming: false,
    placeholder: 'Message the agent...',
    attachedFiles: [],
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    const [files, setFiles] = useState<AttachedFile[]>(args.attachedFiles || []);

    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setFiles(prev => [...prev, ...newFiles]);
      args.onFilesAttached?.(newFiles);
    };

    const handleFileRemoved = (fileId: string) => {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      args.onFileRemoved?.(fileId);
    };

    const handleFileCleared = () => {
      setFiles([]);
      args.onFileCleared?.();
    };

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 min-h-[400px] rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Chat Interface</h3>
          <p className="text-sm text-base-content/60 mb-4">
            This enhanced chat input provides a complete interface for AI conversations.
          </p>
          <div className="flex-1 flex items-end">
            <div className="flex-1 bg-base-200 rounded-lg p-4 min-h-[200px] mb-4">
              <p className="text-sm text-base-content/60">
                Conversation messages would appear here...
              </p>
            </div>
          </div>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
          attachedFiles={files}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Default enhanced chat input with full functionality including text input, file attachments, and voice controls.',
      },
    },
  },
};

export const WithVoiceInput: Story = {
  args: {
    ...Default.args,
    isListening: false,
    onStartVoice: () => {},
    onStopVoice: () => {},
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    const [isListening, setIsListening] = useState(false);

    const handleStartVoice = () => {
      setIsListening(true);
      args.onStartVoice?.();
    };

    const handleStopVoice = () => {
      setIsListening(false);
      args.onStopVoice?.();
    };

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Voice Input Demo</h3>
          <p className="text-sm text-base-content/60 mb-4">
            Click the microphone to start voice input
          </p>
          <div className="flex items-center gap-2 mb-4">
            <div className="badge badge-outline">
              Voice: {isListening ? 'Listening' : 'Ready'}
            </div>
          </div>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
          isListening={isListening}
          onStartVoice={handleStartVoice}
          onStopVoice={handleStopVoice}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Enhanced chat input with voice input functionality. Click the microphone button to toggle voice recognition.',
      },
    },
  },
};

export const WithFileAttachments: Story = {
  args: {
    ...Default.args,
    attachedFiles: sampleFiles,
    onFilesAttached: () => {},
    onFileRemoved: () => {},
    onFileCleared: () => {},
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    const [files, setFiles] = useState<AttachedFile[]>(args.attachedFiles || []);

    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setFiles(prev => [...prev, ...newFiles]);
      args.onFilesAttached?.(newFiles);
    };

    const handleFileRemoved = (fileId: string) => {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      args.onFileRemoved?.(fileId);
    };

    const handleFileCleared = () => {
      setFiles([]);
      args.onFileCleared?.();
    };

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">File Attachments Demo</h3>
          <p className="text-sm text-base-content/60 mb-4">
            Files can be attached to messages for context
          </p>
          <div className="flex items-center gap-2 mb-4">
            <div className="badge badge-outline">
              Files: {files.length}
            </div>
          </div>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
          attachedFiles={files}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Enhanced chat input with file attachments. Files can be attached and removed before sending.',
      },
    },
  },
};

export const StreamingState: Story = {
  args: {
    ...Default.args,
    isStreaming: true,
    onInterrupt: () => {},
    value: '',
    disabled: false,
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    const [isStreaming, setIsStreaming] = useState(args.isStreaming);

    const handleInterrupt = () => {
      setIsStreaming(false);
      args.onInterrupt?.();
    };

    const handleSubmit = () => {
      setIsStreaming(true);
      args.onSubmit?.();
    };

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Streaming State Demo</h3>
          <p className="text-sm text-base-content/60 mb-4">
            When the AI is responding, the input shows streaming state
          </p>
          <div className="flex items-center gap-2 mb-4">
            <div className={`badge ${isStreaming ? 'badge-warning' : 'badge-success'}`}>
              {isStreaming ? 'AI Responding...' : 'Ready'}
            </div>
          </div>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
          isStreaming={isStreaming}
          onSubmit={handleSubmit}
          onInterrupt={handleInterrupt}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Enhanced chat input in streaming state. When AI is responding, the interface shows appropriate controls.',
      },
    },
  },
};

export const DisabledState: Story = {
  args: {
    ...Default.args,
    disabled: true,
    value: 'This input is disabled',
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Disabled State</h3>
          <p className="text-sm text-base-content/60 mb-4">
            The input can be disabled during processing or when unavailable
          </p>
          <div className="flex items-center gap-2 mb-4">
            <div className="badge badge-neutral">
              Status: Disabled
            </div>
          </div>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Enhanced chat input in disabled state. All controls are disabled when the input is not available.',
      },
    },
  },
};

export const FullFeatured: Story = {
  args: {
    ...Default.args,
    attachedFiles: sampleFiles.slice(0, 2),
    onStartVoice: () => {},
    onStopVoice: () => {},
    onInterrupt: () => {},
    onFilesAttached: () => {},
    onFileRemoved: () => {},
    onFileCleared: () => {},
  },
  render: (args) => {
    const [value, setValue] = useState('How can I optimize this React component?');
    const [files, setFiles] = useState<AttachedFile[]>(args.attachedFiles || []);
    const [isListening, setIsListening] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);

    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setFiles(prev => [...prev, ...newFiles]);
      args.onFilesAttached?.(newFiles);
    };

    const handleFileRemoved = (fileId: string) => {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      args.onFileRemoved?.(fileId);
    };

    const handleFileCleared = () => {
      setFiles([]);
      args.onFileCleared?.();
    };

    const handleStartVoice = () => {
      setIsListening(true);
      args.onStartVoice?.();
    };

    const handleStopVoice = () => {
      setIsListening(false);
      args.onStopVoice?.();
    };

    const handleSubmit = () => {
      if (value.trim()) {
        setIsStreaming(true);
        args.onSubmit?.();
        // Simulate response completion
        setTimeout(() => setIsStreaming(false), 3000);
      }
    };

    const handleInterrupt = () => {
      setIsStreaming(false);
      args.onInterrupt?.();
    };

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Full Featured Chat Interface</h3>
          <p className="text-sm text-base-content/60 mb-4">
            Complete chat interface with all features enabled
          </p>
          <div className="flex items-center gap-2 mb-4">
            <div className={`badge ${isStreaming ? 'badge-warning' : 'badge-success'}`}>
              {isStreaming ? 'AI Responding...' : 'Ready'}
            </div>
            <div className="badge badge-outline">
              Voice: {isListening ? 'Listening' : 'Ready'}
            </div>
            <div className="badge badge-outline">
              Files: {files.length}
            </div>
          </div>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
          attachedFiles={files}
          isListening={isListening}
          isStreaming={isStreaming}
          onSubmit={handleSubmit}
          onInterrupt={handleInterrupt}
          onStartVoice={handleStartVoice}
          onStopVoice={handleStopVoice}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Complete enhanced chat input with all features enabled including voice input, file attachments, and streaming state management.',
      },
    },
  },
};

export const CustomPlaceholder: Story = {
  args: {
    ...Default.args,
    placeholder: 'Ask me anything about your code...',
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);

    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Custom Placeholder</h3>
          <p className="text-sm text-base-content/60 mb-4">
            The placeholder text can be customized for different contexts
          </p>
        </div>
        <EnhancedChatInput
          {...args}
          value={value}
          onChange={setValue}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Enhanced chat input with custom placeholder text for different use cases.',
      },
    },
  },
};

export const ResponsiveDesign: Story = {
  args: {
    ...Default.args,
    onStartVoice: () => {},
    onFilesAttached: () => {},
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);

    return (
      <div className="w-full">
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <h3 className="text-lg font-semibold mb-2">Responsive Design</h3>
          <p className="text-sm text-base-content/60 mb-4">
            The chat input adapts to different screen sizes
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border-2 border-dashed border-base-300 p-4 rounded-lg">
            <h4 className="text-sm font-medium mb-2">Mobile View</h4>
            <div className="w-full max-w-sm">
              <EnhancedChatInput
                {...args}
                value={value}
                onChange={setValue}
              />
            </div>
          </div>
          <div className="border-2 border-dashed border-base-300 p-4 rounded-lg">
            <h4 className="text-sm font-medium mb-2">Desktop View</h4>
            <div className="w-full">
              <EnhancedChatInput
                {...args}
                value={value}
                onChange={setValue}
              />
            </div>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Enhanced chat input responsive design demonstration showing how it adapts to different screen sizes.',
      },
    },
  },
};