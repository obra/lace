import type { Meta, StoryObj } from '@storybook/react';
import { useState, useRef } from 'react';
import ChatTextarea, { ChatTextareaRef } from './ChatTextarea';

const meta: Meta<typeof ChatTextarea> = {
  title: 'Atoms/ChatTextarea',
  component: ChatTextarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'ChatTextarea component for multi-line text input with auto-resize, drag-and-drop support, and keyboard shortcuts.',
      },
    },
  },
  argTypes: {
    value: {
      control: { type: 'text' },
      description: 'The current textarea value',
    },
    placeholder: {
      control: { type: 'text' },
      description: 'Placeholder text',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the textarea is disabled',
    },
    isMobile: {
      control: { type: 'boolean' },
      description: 'Whether in mobile mode (affects Enter key behavior)',
    },
    isDragOver: {
      control: { type: 'boolean' },
      description: 'Whether files are being dragged over the textarea',
    },
    autoFocus: {
      control: { type: 'boolean' },
      description: 'Whether to auto-focus the textarea',
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
interface ChatTextareaWrapperProps {
  initialValue?: string;
  placeholder?: string;
  disabled?: boolean;
  isMobile?: boolean;
  isDragOver?: boolean;
  autoFocus?: boolean;
  className?: string;
}

const ChatTextareaWrapper = ({ initialValue = '', ...props }: ChatTextareaWrapperProps) => {
  const [value, setValue] = useState(initialValue);
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const textareaRef = useRef<ChatTextareaRef>(null);

  const handleSubmit = () => {
    if (value.trim()) {
      setSubmitted(prev => [...prev, value]);
      setValue('');
      void ('Message submitted:', value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setValue('');
      void ('Textarea cleared');
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    void ('Files dropped:', files.map(f => f.name));
  };

  return (
    <div className="w-full max-w-2xl space-y-4">
      <ChatTextarea
        ref={textareaRef}
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        isDragOver={isDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        {...props}
      />
      
      {submitted.length > 0 && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium mb-2">Submitted messages:</p>
          <div className="space-y-1">
            {submitted.map((msg, index) => (
              <div key={index} className="text-sm text-gray-700">
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const Default: Story = {
  render: () => <ChatTextareaWrapper />,
};

export const WithPlaceholder: Story = {
  render: () => (
    <ChatTextareaWrapper placeholder="Ask me anything..." />
  ),
};

export const WithInitialValue: Story = {
  render: () => (
    <ChatTextareaWrapper initialValue="This is some initial text that shows how the textarea auto-resizes with content." />
  ),
};

export const LongText: Story = {
  render: () => (
    <ChatTextareaWrapper 
      initialValue="This is a longer text that demonstrates how the textarea handles multiple lines and auto-resizing. It will grow until it reaches the maximum height and then start scrolling. This is useful for longer messages and complex queries."
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <ChatTextareaWrapper 
      disabled={true}
      initialValue="This textarea is disabled"
    />
  ),
};

export const MobileMode: Story = {
  render: () => (
    <div className="w-full max-w-2xl space-y-4">
      <p className="text-sm text-gray-600">
        Mobile mode: Enter key creates new lines instead of submitting
      </p>
      <ChatTextareaWrapper 
        isMobile={true}
        placeholder="In mobile mode, use Enter for new lines..."
      />
    </div>
  ),
};

export const DragOverState: Story = {
  render: () => (
    <div className="w-full max-w-2xl space-y-4">
      <p className="text-sm text-gray-600">
        This shows how the textarea looks when files are dragged over it
      </p>
      <ChatTextareaWrapper 
        isDragOver={true}
        placeholder="Files are being dragged over..."
      />
    </div>
  ),
};

export const AutoFocus: Story = {
  render: () => (
    <ChatTextareaWrapper 
      autoFocus={true}
      placeholder="This textarea should be auto-focused"
    />
  ),
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-8 w-full max-w-2xl">
      <div>
        <h3 className="text-lg font-semibold mb-2">Default State</h3>
        <ChatTextareaWrapper placeholder="Default textarea..." />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-2">With Content</h3>
        <ChatTextareaWrapper 
          initialValue="This textarea has some content that shows auto-resizing."
        />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-2">Disabled State</h3>
        <ChatTextareaWrapper 
          disabled={true}
          initialValue="This textarea is disabled"
        />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-2">Mobile Mode</h3>
        <ChatTextareaWrapper 
          isMobile={true}
          placeholder="Mobile mode - Enter creates new lines"
        />
      </div>
      
      <div>
        <h3 className="text-lg font-semibold mb-2">Drag Over State</h3>
        <ChatTextareaWrapper 
          isDragOver={true}
          placeholder="Files are being dragged over..."
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available states of the chat textarea.',
      },
    },
  },
};

export const KeyboardShortcuts: Story = {
  render: () => {
    const [value, setValue] = useState('');
    const [logs, setLogs] = useState<string[]>([]);
    const textareaRef = useRef<ChatTextareaRef>(null);

    const addLog = (message: string) => {
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    const handleSubmit = () => {
      if (value.trim()) {
        addLog(`Submitted: "${value}"`);
        setValue('');
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setValue('');
        addLog('Textarea cleared with Escape');
      }
    };

    return (
      <div className="w-full max-w-2xl space-y-4">
        <div className="p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium mb-2">Keyboard Shortcuts:</h4>
          <ul className="text-sm text-gray-700 space-y-1">
            <li>• <strong>Enter</strong> - Submit message (desktop mode)</li>
            <li>• <strong>Shift + Enter</strong> - New line</li>
            <li>• <strong>Escape</strong> - Clear textarea</li>
          </ul>
        </div>
        
        <ChatTextarea
          ref={textareaRef}
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          placeholder="Try the keyboard shortcuts..."
        />
        
        {logs.length > 0 && (
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-2">Action Log:</h4>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {logs.map((log, index) => (
                <div key={index} className="text-sm text-gray-700 font-mono">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Demonstration of keyboard shortcuts and interactions.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const [value, setValue] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [submitted, setSubmitted] = useState<string[]>([]);
    const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
    const textareaRef = useRef<ChatTextareaRef>(null);

    const handleSubmit = () => {
      if (value.trim()) {
        setSubmitted(prev => [...prev, value]);
        setValue('');
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        setValue('');
      }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      setDroppedFiles(prev => [...prev, ...files.map(f => f.name)]);
    };

    return (
      <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">🎾 Chat Textarea Tennis Commentary Demo</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enable tennis commentary in the toolbar above, then interact with the textarea below!
          </p>
        </div>
        
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => setIsMobile(!isMobile)}
            className={`px-3 py-1 rounded text-sm ${
              isMobile ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {isMobile ? 'Mobile Mode' : 'Desktop Mode'}
          </button>
          
          <button
            onClick={() => textareaRef.current?.focus()}
            className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            Focus Textarea
          </button>
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <ChatTextarea
            ref={textareaRef}
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            isDragOver={isDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            isMobile={isMobile}
            placeholder="Type your message, try drag & drop, or use keyboard shortcuts..."
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {submitted.length > 0 && (
            <div className="p-4 bg-green-50 rounded-lg">
              <h4 className="font-medium mb-2">Submitted Messages:</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {submitted.map((msg, index) => (
                  <div key={index} className="text-sm text-gray-700">
                    {msg}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {droppedFiles.length > 0 && (
            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium mb-2">Dropped Files:</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {droppedFiles.map((file, index) => (
                  <div key={index} className="text-sm text-gray-700">
                    {file}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="text-sm text-gray-600 space-y-1">
          <p>• <strong>Type and submit</strong> messages to see them appear above</p>
          <p>• <strong>Toggle mobile/desktop</strong> mode to see different Enter behavior</p>
          <p>• <strong>Drag & drop files</strong> to see the drop zone animation</p>
          <p>• <strong>Use keyboard shortcuts</strong> for quick actions</p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing the chat textarea with tennis commentary. Enable commentary in the toolbar and interact with the textarea!',
      },
    },
  },
};