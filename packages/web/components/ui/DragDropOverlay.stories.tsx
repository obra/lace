// ABOUTME: Storybook story for DragDropOverlay.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { DragDropOverlay } from './DragDropOverlay';

const meta: Meta<typeof DragDropOverlay> = {
  title: 'Molecules/DragDropOverlay',
  component: DragDropOverlay,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## DragDropOverlay

**Atomic Classification**: Interaction Molecule  
**Composed of**: IconButton + StatusDot + MessageText + Container + Backdrop atoms  
**Single Responsibility**: Drag-and-drop file upload interface with visual feedback and file handling

### Purpose
A cohesive molecule that combines 4-5 atoms to solve the specific UI pattern of drag-and-drop file interactions. Handles file dragging detection, visual feedback, drop zones, and file processing in a single, overlay component.

### When to Use
- File upload interfaces
- Document attachment features
- Image drop zones
- Bulk file operations
- Drag-and-drop file organization

### Atomic Composition
- **IconButton**: Paperclip icon with proper sizing and colors
- **StatusDot**: Visual indicator for drag state with semantic colors
- **MessageText**: Instructional text and file drop feedback
- **Container**: Structured layout with proper spacing and borders
- **Backdrop**: Semi-transparent overlay with blur effects
- **Border Elements**: Dashed border styling for drop zone indication

### Design Tokens Used
- **Colors**: Teal primary colors for active drag states
- **Borders**: Dashed border-2 with teal-500 for drop zones
- **Spacing**: Consistent p-8 padding and gap-2 between elements
- **Typography**: Font-semibold for headings, smaller text for instructions
- **Backdrop**: Semi-transparent with backdrop-blur-sm effects
- **Transitions**: Smooth state transitions for drag feedback

### Drag States
- **idle**: No drag detected, overlay hidden
- **drag-enter**: File drag detected, overlay appears
- **drag-over**: Active drag over zone with visual feedback
- **drop**: File drop processing with success indication

### State Management
- **isDragOver**: Controls overlay visibility and styling
- **dragEnterCounter**: Tracks drag enter/leave events accurately
- **disabled**: Prevents drag operations when disabled
- **onFilesDropped**: Callback for file processing after drop

### Accessibility
- Proper ARIA labels for screen readers
- Keyboard navigation support for file selection
- Clear visual feedback for drag states
- High contrast mode compatibility
- Focus management for interactive elements

### Composition Guidelines
✓ **Do**: Use in file upload organisms and document templates  
✓ **Do**: Combine atoms logically for drag interactions  
✓ **Do**: Maintain single responsibility for file drops  
✓ **Do**: Provide clear visual feedback for all states  
✗ **Don't**: Mix unrelated file operations  
✗ **Don't**: Override individual atom styles  
✗ **Don't**: Create complex nested drag interfaces
        `,
      },
    },
  },
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the drag and drop functionality is disabled',
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
interface DragDropDemoProps {
  disabled?: boolean;
  className?: string;
}

const DragDropDemo = ({ disabled = false, ...props }: DragDropDemoProps) => {
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [lastDropTime, setLastDropTime] = useState<string>('');

  const handleFilesDropped = (files: FileList) => {
    const fileArray = Array.from(files);
    setDroppedFiles(fileArray);
    setLastDropTime(new Date().toLocaleTimeString());
  };

  const createMockFile = (name: string, size: number, type: string): File => {
    const content = new TextEncoder().encode(`Mock content for ${name}`);
    return new File([content], name, { type, lastModified: Date.now() });
  };

  const simulateFileDrop = () => {
    const mockFiles = [
      createMockFile('document.pdf', 1024000, 'application/pdf'),
      createMockFile('image.jpg', 2048000, 'image/jpeg'),
      createMockFile('report.txt', 5120, 'text/plain'),
    ];
    
    // Create a mock FileList
    const mockFileList = {
      length: mockFiles.length,
      item: (index: number) => mockFiles[index] || null,
      [Symbol.iterator]: function* () {
        for (let i = 0; i < this.length; i++) {
          yield this.item(i);
        }
      },
    } as FileList;
    
    // Add array access using object property assignment
    mockFiles.forEach((file, index) => {
      Object.defineProperty(mockFileList, index.toString(), {
        value: file,
        enumerable: true,
        configurable: true,
      });
    });
    
    handleFilesDropped(mockFileList);
  };

  return (
    <div className="w-full max-w-2xl space-y-6">
      <DragDropOverlay
        onFilesDropped={handleFilesDropped}
        disabled={disabled}
        {...props}
      >
        <div className="bg-base-200 border border-base-300 rounded-lg p-8 min-h-[300px] flex flex-col items-center justify-center text-center">
          <div className="text-4xl mb-4">📁</div>
          <h3 className="text-lg font-semibold mb-2">Drag & Drop Demo Area</h3>
          <p className="text-sm text-base-content/60 mb-4">
            Drag files here or click the button below to simulate file drop
          </p>
          
          <button
            onClick={simulateFileDrop}
            disabled={disabled}
            className="btn btn-primary btn-sm mb-6"
          >
            Simulate File Drop
          </button>
          
          {droppedFiles.length > 0 && (
            <div className="w-full max-w-md">
              <h4 className="font-medium mb-3">Dropped Files ({lastDropTime}):</h4>
              <div className="space-y-2">
                {droppedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-base-100 border border-base-300 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-success rounded-full"></div>
                      <div>
                        <div className="font-medium text-sm">{file.name}</div>
                        <div className="text-xs text-base-content/60">
                          {(file.size / 1024).toFixed(1)} KB • {file.type}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DragDropOverlay>
    </div>
  );
};

export const Default: Story = {
  render: () => <DragDropDemo />,
};

export const Disabled: Story = {
  render: () => <DragDropDemo disabled={true} />,
};

export const ChatInputExample: Story = {
  render: () => {
    const [message, setMessage] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

    const handleFilesDropped = (files: FileList) => {
      const fileArray = Array.from(files);
      setAttachedFiles(prev => [...prev, ...fileArray]);
    };

    const removeFile = (index: number) => {
      setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };

    return (
      <div className="w-full max-w-2xl">
        <DragDropOverlay onFilesDropped={handleFilesDropped}>
          <div className="bg-base-100 border border-base-300 rounded-lg p-4 space-y-4">
            <div className="text-center text-sm text-base-content/60">
              Chat Input with File Drop
            </div>
            
            {/* Attached Files */}
            {attachedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-base-content/60">
                  Attached Files:
                </div>
                {attachedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-base-200 rounded-lg p-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full"></div>
                      <span className="text-xs">{file.name}</span>
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-xs text-error hover:text-error/80"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Text Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message or drag files here..."
                className="flex-1 px-3 py-2 border border-base-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button className="btn btn-primary btn-sm">Send</button>
            </div>
          </div>
        </DragDropOverlay>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Example of drag and drop overlay integrated with a chat input interface.',
      },
    },
  },
};

export const DocumentUploadExample: Story = {
  render: () => {
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

    const handleFilesDropped = (files: FileList) => {
      const fileArray = Array.from(files);
      setUploadedFiles(prev => [...prev, ...fileArray]);
    };

    return (
      <div className="w-full max-w-2xl">
        <DragDropOverlay onFilesDropped={handleFilesDropped}>
          <div className="bg-base-100 border-2 border-dashed border-base-300 rounded-lg p-12 text-center">
            <div className="text-6xl mb-4">📄</div>
            <h3 className="text-xl font-semibold mb-2">Document Upload</h3>
            <p className="text-base-content/60 mb-6">
              Drag and drop your documents here to upload
            </p>
            
            <div className="space-y-2 text-sm text-base-content/60">
              <div>Supported formats: PDF, DOC, DOCX, TXT</div>
              <div>Maximum file size: 10MB</div>
            </div>
            
            {uploadedFiles.length > 0 && (
              <div className="mt-6 pt-6 border-t border-base-300">
                <h4 className="font-medium mb-3">Uploaded Files:</h4>
                <div className="space-y-2">
                  {uploadedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-base-200 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-success rounded-full"></div>
                        <div>
                          <div className="font-medium text-sm">{file.name}</div>
                          <div className="text-xs text-base-content/60">
                            {(file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-success">✓ Uploaded</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DragDropOverlay>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Example of drag and drop overlay used for document uploads.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-3xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 Drag Drop Overlay Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then drag files or click simulate!
        </p>
      </div>
      
      <div className="cursor-pointer transition-transform hover:scale-[1.01]">
        <DragDropDemo />
      </div>
      
      <div className="text-sm text-gray-600 space-y-1">
        <p>• <strong>Drag files</strong> into the drop zone to see the overlay</p>
        <p>• <strong>Click simulate</strong> to test without actual files</p>
        <p>• <strong>Watch animations</strong> during drag and drop states</p>
        <p>• <strong>Hover elements</strong> for tennis commentary feedback!</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing drag and drop overlay with tennis commentary. Enable commentary in the toolbar and interact with the interface!',
      },
    },
  },
};