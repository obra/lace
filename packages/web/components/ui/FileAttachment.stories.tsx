// ABOUTME: Storybook story for FileAttachment.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { FileAttachment, type AttachedFile } from './FileAttachment';

const meta: Meta<typeof FileAttachment> = {
  title: 'Molecules/FileAttachment',
  component: FileAttachment,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
## FileAttachment

**Atomic Classification**: Input Processing Molecule  
**Composed of**: DragDropOverlay + FileAttachButton + IconButton + MessageText + StatusDot atoms  
**Single Responsibility**: Handle file selection, validation, preview, and management with drag-and-drop support

### Purpose
A sophisticated input molecule that combines drag-and-drop functionality, file validation, preview capabilities, and management features to create a complete file attachment experience. Perfect for forms, chat interfaces, and document management systems.

### When to Use
- File upload forms and document submission
- Chat interfaces with file sharing
- Document management systems
- Image galleries and media uploads
- Code file sharing and collaboration
- Report generation with attachments
- Email composition with attachments

### Design Tokens Used
- **Layout**: Drag-and-drop zones with responsive design
- **Colors**: Primary/accent colors for drag states and previews
- **Spacing**: Consistent padding and gaps for file cards
- **Borders**: Dashed borders for drop zones, solid for cards
- **Animations**: Smooth transitions and hover effects
- **Typography**: File names, sizes, and metadata display

### Features
- **Drag and Drop**: Intuitive drag-and-drop file attachment
- **File Validation**: Size, type, and count restrictions
- **Preview System**: Image previews and text content preview
- **File Management**: Individual file removal and bulk clear
- **Modal Preview**: Full-screen file content viewing
- **Mobile Support**: Touch-friendly mobile interface
- **Type Detection**: Automatic file type detection and icons

### File Support
- **Images**: Full preview with zoom capabilities
- **Text Files**: Content preview and syntax highlighting
- **Code Files**: Syntax-aware preview and formatting
- **Documents**: PDF, Word, Excel support with metadata
- **Archives**: ZIP, RAR with file listing
- **Custom Types**: Configurable file type restrictions

### Validation Features
- **File Size**: Configurable maximum file size limits
- **File Count**: Maximum number of files allowed
- **File Types**: Whitelist/blacklist of allowed file types
- **Duplicate Detection**: Prevents duplicate file attachments
- **Error Handling**: Clear error messages for validation failures

### Integration Points
- **Modal**: Uses Modal component for file content preview
- **FontAwesome**: File type icons and interaction buttons
- **Drag Events**: HTML5 drag and drop API integration
- **File API**: Browser File API for reading and processing
- **URL API**: Object URL creation for preview generation

### Mobile Optimization
- **Touch Interface**: Large touch targets and gestures
- **Responsive Design**: Adapts to different screen sizes
- **Carousel View**: Horizontal scrolling for file list
- **Simplified UI**: Reduces complexity on small screens
- **Performance**: Optimized file handling for mobile devices

### Accessibility
- **Keyboard Navigation**: Full keyboard support for file management
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators and tab order
- **High Contrast**: Theme-aware styling for accessibility
- **Error Announcements**: Screen reader error notifications

### Molecule Guidelines
✓ **Do**: Use for file input with preview capabilities  
✓ **Do**: Validate files before processing  
✓ **Do**: Provide clear file type and size restrictions  
✓ **Do**: Support both drag-and-drop and click to upload  
✗ **Don't**: Use for single file uploads without preview  
✗ **Don't**: Allow unlimited file sizes without validation  
✗ **Don't**: Override file type restrictions without purpose
        `,
      },
    },
  },
  argTypes: {
    attachedFiles: {
      control: false,
      description: 'Array of currently attached files',
    },
    onFilesAttached: {
      action: 'filesAttached',
      description: 'Callback when files are attached',
    },
    onFileRemoved: {
      action: 'fileRemoved',
      description: 'Callback when a file is removed',
    },
    onFileCleared: {
      action: 'filesCleared',
      description: 'Callback when all files are cleared',
    },
    maxFiles: {
      control: { type: 'number', min: 1, max: 50 },
      description: 'Maximum number of files allowed',
    },
    maxSizeBytes: {
      control: { type: 'number', min: 1024, max: 100 * 1024 * 1024 },
      description: 'Maximum file size in bytes',
    },
    acceptedTypes: {
      control: { type: 'object' },
      description: 'Array of accepted file types',
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether file attachment is disabled',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Helper function to create mock files
const createMockFile = (name: string, size: number, type: string): AttachedFile => ({
  id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  file: new File([], name, { type }),
  name,
  size,
  type,
});

export const Default: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
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
        story: 'Default file attachment with drag-and-drop and preview capabilities.',
      },
    },
  },
};

export const WithFiles: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([
      createMockFile('document.pdf', 2048576, 'application/pdf'),
      createMockFile('image.jpg', 1024000, 'image/jpeg'),
      createMockFile('code.ts', 5120, 'text/typescript'),
    ]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
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
        story: 'File attachment with some files already attached.',
      },
    },
  },
};

export const ImageFiles: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([
      createMockFile('photo1.jpg', 1024000, 'image/jpeg'),
      createMockFile('photo2.png', 2048000, 'image/png'),
      createMockFile('diagram.svg', 51200, 'image/svg+xml'),
      createMockFile('screenshot.png', 1536000, 'image/png'),
    ]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          acceptedTypes={['image/*']}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File attachment restricted to image files only.',
      },
    },
  },
};

export const CodeFiles: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([
      createMockFile('component.tsx', 4096, 'text/typescript'),
      createMockFile('utils.js', 2048, 'text/javascript'),
      createMockFile('styles.css', 1024, 'text/css'),
      createMockFile('config.json', 512, 'application/json'),
    ]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          acceptedTypes={['.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.md']}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File attachment for code files with syntax highlighting preview.',
      },
    },
  },
};

export const RestrictedFiles: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl space-y-4">
        <div className="bg-info/20 text-info p-3 rounded-lg text-sm">
          <strong>Restrictions:</strong> Max 3 files, 1MB each, images only
        </div>
        
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          maxFiles={3}
          maxSizeBytes={1024 * 1024} // 1MB
          acceptedTypes={['image/*']}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File attachment with strict file count, size, and type restrictions.',
      },
    },
  },
};

export const Disabled: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([
      createMockFile('locked.pdf', 2048576, 'application/pdf'),
      createMockFile('readonly.txt', 1024, 'text/plain'),
    ]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          disabled={true}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Disabled file attachment showing read-only state.',
      },
    },
  },
};

export const ManyFiles: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([
      createMockFile('document1.pdf', 2048576, 'application/pdf'),
      createMockFile('image1.jpg', 1024000, 'image/jpeg'),
      createMockFile('code1.ts', 5120, 'text/typescript'),
      createMockFile('data.csv', 10240, 'text/csv'),
      createMockFile('notes.md', 2048, 'text/markdown'),
      createMockFile('config.json', 1024, 'application/json'),
      createMockFile('image2.png', 2048000, 'image/png'),
      createMockFile('script.js', 3072, 'text/javascript'),
    ]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          maxFiles={15}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File attachment with many files showing horizontal scrolling.',
      },
    },
  },
};

export const DocumentTypes: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([
      createMockFile('report.pdf', 5242880, 'application/pdf'),
      createMockFile('presentation.pptx', 10485760, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      createMockFile('spreadsheet.xlsx', 3145728, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      createMockFile('document.docx', 2097152, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      createMockFile('archive.zip', 15728640, 'application/zip'),
    ]);
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl">
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          acceptedTypes={['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip']}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File attachment for document types with large file support.',
      },
    },
  },
};

export const CustomConfiguration: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [config, setConfig] = useState({
      maxFiles: 5,
      maxSizeBytes: 5 * 1024 * 1024, // 5MB
      acceptedTypes: ['image/*', 'text/*', '.pdf'],
    });
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    return (
      <div className="max-w-2xl space-y-4">
        <div className="bg-base-200 p-4 rounded-lg">
          <h4 className="font-medium mb-3">Configuration</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">
                <span className="label-text">Max Files</span>
              </label>
              <input
                type="number"
                value={config.maxFiles}
                onChange={(e) => setConfig(prev => ({ ...prev, maxFiles: parseInt(e.target.value) }))}
                className="input input-bordered input-sm w-full"
                min="1"
                max="20"
              />
            </div>
            
            <div>
              <label className="label">
                <span className="label-text">Max Size (MB)</span>
              </label>
              <input
                type="number"
                value={config.maxSizeBytes / (1024 * 1024)}
                onChange={(e) => setConfig(prev => ({ ...prev, maxSizeBytes: parseInt(e.target.value) * 1024 * 1024 }))}
                className="input input-bordered input-sm w-full"
                min="1"
                max="100"
              />
            </div>
            
            <div>
              <label className="label">
                <span className="label-text">File Types</span>
              </label>
              <select
                value={config.acceptedTypes.join(',')}
                onChange={(e) => setConfig(prev => ({ ...prev, acceptedTypes: e.target.value.split(',') }))}
                className="select select-bordered select-sm w-full"
              >
                <option value="image/*,text/*,.pdf">Images, Text, PDF</option>
                <option value="image/*">Images Only</option>
                <option value="text/*,.md,.json">Text Files Only</option>
                <option value=".pdf,.doc,.docx">Documents Only</option>
              </select>
            </div>
          </div>
        </div>
        
        <FileAttachment
          attachedFiles={attachedFiles}
          onFilesAttached={handleFilesAttached}
          onFileRemoved={handleFileRemoved}
          onFileCleared={handleFileCleared}
          maxFiles={config.maxFiles}
          maxSizeBytes={config.maxSizeBytes}
          acceptedTypes={config.acceptedTypes}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive configuration of file attachment settings.',
      },
    },
  },
};

export const FormIntegration: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [formData, setFormData] = useState({
      title: '',
      description: '',
      category: 'general',
    });
    
    const handleFilesAttached = (newFiles: AttachedFile[]) => {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const handleFileRemoved = (fileId: string) => {
      setAttachedFiles(prev => prev.filter(f => f.id !== fileId));
    };
    
    const handleFileCleared = () => {
      setAttachedFiles([]);
    };
    
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      console.log('Form submitted with files:', attachedFiles.map(f => f.file.name));
      alert(`Form submitted with ${attachedFiles.length} files!`);
    };
    
    return (
      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">
              <span className="label-text">Title</span>
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="input input-bordered w-full"
              required
            />
          </div>
          
          <div>
            <label className="label">
              <span className="label-text">Description</span>
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="textarea textarea-bordered w-full"
              rows={3}
            />
          </div>
          
          <div>
            <label className="label">
              <span className="label-text">Category</span>
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
              className="select select-bordered w-full"
            >
              <option value="general">General</option>
              <option value="technical">Technical</option>
              <option value="design">Design</option>
              <option value="documentation">Documentation</option>
            </select>
          </div>
          
          <div>
            <label className="label">
              <span className="label-text">Attachments</span>
            </label>
            <FileAttachment
              attachedFiles={attachedFiles}
              onFilesAttached={handleFilesAttached}
              onFileRemoved={handleFileRemoved}
              onFileCleared={handleFileCleared}
              maxFiles={5}
              maxSizeBytes={10 * 1024 * 1024} // 10MB
            />
          </div>
          
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary">
              Submit ({attachedFiles.length} files attached)
            </button>
          </div>
        </form>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File attachment integrated into a form with other input fields.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 FileAttachment Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then try dragging files onto the drop zone below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Image Gallery</h4>
          <FileAttachment
            attachedFiles={[
              createMockFile('photo1.jpg', 1024000, 'image/jpeg'),
              createMockFile('photo2.png', 2048000, 'image/png'),
            ]}
            onFilesAttached={() => {}}
            onFileRemoved={() => {}}
            onFileCleared={() => {}}
            acceptedTypes={['image/*']}
            maxFiles={5}
          />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Document Upload</h4>
          <FileAttachment
            attachedFiles={[
              createMockFile('report.pdf', 5242880, 'application/pdf'),
              createMockFile('data.csv', 10240, 'text/csv'),
            ]}
            onFilesAttached={() => {}}
            onFileRemoved={() => {}}
            onFileCleared={() => {}}
            acceptedTypes={['.pdf', '.doc', '.docx', '.csv', '.txt']}
            maxFiles={10}
          />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Code Files</h4>
          <FileAttachment
            attachedFiles={[
              createMockFile('component.tsx', 4096, 'text/typescript'),
              createMockFile('utils.js', 2048, 'text/javascript'),
            ]}
            onFilesAttached={() => {}}
            onFileRemoved={() => {}}
            onFileCleared={() => {}}
            acceptedTypes={['.js', '.jsx', '.ts', '.tsx', '.css', '.json']}
            maxFiles={8}
          />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Empty Drop Zone</h4>
          <FileAttachment
            attachedFiles={[]}
            onFilesAttached={() => alert('Files would be attached!')}
            onFileRemoved={() => {}}
            onFileCleared={() => {}}
            maxFiles={3}
            maxSizeBytes={5 * 1024 * 1024}
          />
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">FileAttachment Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Drag & Drop</strong> - Intuitive file dropping with visual feedback</li>
          <li>• <strong>File Validation</strong> - Size, type, and count restrictions</li>
          <li>• <strong>Preview System</strong> - Image and text file previews</li>
          <li>• <strong>File Management</strong> - Individual removal and bulk clearing</li>
          <li>• <strong>Modal Preview</strong> - Full-screen file content viewing</li>
          <li>• <strong>Mobile Support</strong> - Touch-friendly interface</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing FileAttachment with tennis commentary. Enable commentary in the toolbar and try dragging files!',
      },
    },
  },
};