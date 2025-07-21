import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import FileAttachButton from './FileAttachButton';

const meta: Meta<typeof FileAttachButton> = {
  title: 'Atoms/FileAttachButton',
  component: FileAttachButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'FileAttachButton component for file upload functionality with different sizes, variants, and file type restrictions.',
      },
    },
  },
  argTypes: {
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the button is disabled',
    },
    maxFiles: {
      control: { type: 'number' },
      description: 'Maximum number of files that can be selected',
    },
    acceptedTypes: {
      control: { type: 'object' },
      description: 'Array of accepted file types',
    },
    size: {
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
      description: 'The size of the button',
    },
    variant: {
      control: { type: 'select' },
      options: ['primary', 'ghost', 'outline'],
      description: 'The visual style variant',
    },
    title: {
      control: { type: 'text' },
      description: 'Tooltip text for the button',
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

export const Default: Story = {
  args: {
    onFilesSelected: (files: FileList) => {
      console.log('Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    onFilesSelected: (files: FileList) => {
      console.log('This should not trigger');
    },
  },
};

export const SmallSize: Story = {
  args: {
    size: 'sm',
    onFilesSelected: (files: FileList) => {
      console.log('Small button - Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const MediumSize: Story = {
  args: {
    size: 'md',
    onFilesSelected: (files: FileList) => {
      console.log('Medium button - Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const LargeSize: Story = {
  args: {
    size: 'lg',
    onFilesSelected: (files: FileList) => {
      console.log('Large button - Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const PrimaryVariant: Story = {
  args: {
    variant: 'primary',
    onFilesSelected: (files: FileList) => {
      console.log('Primary variant - Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const GhostVariant: Story = {
  args: {
    variant: 'ghost',
    onFilesSelected: (files: FileList) => {
      console.log('Ghost variant - Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const OutlineVariant: Story = {
  args: {
    variant: 'outline',
    onFilesSelected: (files: FileList) => {
      console.log('Outline variant - Files selected:', Array.from(files).map(f => f.name));
    },
  },
};

export const SingleFile: Story = {
  args: {
    maxFiles: 1,
    onFilesSelected: (files: FileList) => {
      console.log('Single file selected:', Array.from(files).map(f => f.name));
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'File attach button configured to accept only one file at a time.',
      },
    },
  },
};

export const ImagesOnly: Story = {
  args: {
    acceptedTypes: ['image/*'],
    title: 'Attach images only',
    onFilesSelected: (files: FileList) => {
      console.log('Image files selected:', Array.from(files).map(f => f.name));
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'File attach button configured to accept only image files.',
      },
    },
  },
};

export const DocumentsOnly: Story = {
  args: {
    acceptedTypes: ['.pdf', '.doc', '.docx', '.txt', '.md'],
    title: 'Attach documents only',
    onFilesSelected: (files: FileList) => {
      console.log('Document files selected:', Array.from(files).map(f => f.name));
    },
  },
  parameters: {
    docs: {
      description: {
        story: 'File attach button configured to accept only document files.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <FileAttachButton 
          size="sm" 
          onFilesSelected={(files) => console.log('Small button')} // Small button
        />
        <p className="text-xs text-gray-500 mt-2">SM</p>
      </div>
      <div className="text-center">
        <FileAttachButton 
          size="md" 
          onFilesSelected={(files) => console.log('Medium button')} // Medium button
        />
        <p className="text-xs text-gray-500 mt-2">MD</p>
      </div>
      <div className="text-center">
        <FileAttachButton 
          size="lg" 
          onFilesSelected={(files) => console.log('Large button')} // Large button
        />
        <p className="text-xs text-gray-500 mt-2">LG</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button sizes displayed together.',
      },
    },
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <FileAttachButton 
          variant="primary" 
          onFilesSelected={(files) => console.log('Primary variant')} // Primary variant
        />
        <p className="text-xs text-gray-500 mt-2">Primary</p>
      </div>
      <div className="text-center">
        <FileAttachButton 
          variant="ghost" 
          onFilesSelected={(files) => console.log('Ghost variant')} // Ghost variant
        />
        <p className="text-xs text-gray-500 mt-2">Ghost</p>
      </div>
      <div className="text-center">
        <FileAttachButton 
          variant="outline" 
          onFilesSelected={(files) => console.log('Outline variant')} // Outline variant
        />
        <p className="text-xs text-gray-500 mt-2">Outline</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button variants displayed together.',
      },
    },
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <FileAttachButton 
          onFilesSelected={(files) => console.log('Ready to attach')} // Ready to attach
        />
        <span className="text-sm">Ready to attach files</span>
      </div>
      
      <div className="flex items-center gap-4">
        <FileAttachButton 
          disabled={true}
          onFilesSelected={(files) => console.log('Disabled')}
        />
        <span className="text-sm">Disabled</span>
      </div>
      
      <div className="flex items-center gap-4">
        <FileAttachButton 
          maxFiles={1}
          onFilesSelected={(files) => console.log('Single file')} // Single file
        />
        <span className="text-sm">Single file only</span>
      </div>
      
      <div className="flex items-center gap-4">
        <FileAttachButton 
          acceptedTypes={['image/*']}
          onFilesSelected={(files) => console.log('Images only')} // Images only
        />
        <span className="text-sm">Images only</span>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available button states and configurations displayed together.',
      },
    },
  },
};

export const WithFileTracking: Story = {
  render: () => {
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    
    const handleFilesSelected = (files: FileList) => {
      const newFiles = Array.from(files);
      setAttachedFiles(prev => [...prev, ...newFiles]);
    };
    
    const removeFile = (index: number) => {
      setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };
    
    return (
      <div className="flex flex-col gap-4 w-full max-w-md">
        <div className="flex items-center gap-2">
          <FileAttachButton 
            onFilesSelected={handleFilesSelected}
            title="Click to attach files"
          />
          <span className="text-sm text-gray-600">
            {attachedFiles.length === 0 ? 'No files attached' : `${attachedFiles.length} file(s) attached`}
          </span>
        </div>
        
        {attachedFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Attached files:</p>
            <div className="space-y-1">
              {attachedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <span className="text-sm truncate">{file.name}</span>
                  <button
                    onClick={() => removeFile(index)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
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
        story: 'File attach button with file tracking functionality to show attached files.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    const [selectedFiles, setSelectedFiles] = useState<{[key: string]: File[]}>({
      primary: [],
      ghost: [],
      outline: [],
    });

    const handleFilesSelected = (variant: string) => (files: FileList) => {
      const newFiles = Array.from(files);
      setSelectedFiles(prev => ({
        ...prev,
        [variant]: [...prev[variant], ...newFiles],
      }));
    };

    const clearFiles = (variant: string) => {
      setSelectedFiles(prev => ({
        ...prev,
        [variant]: [],
      }));
    };

    return (
      <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">🎾 File Attach Button Tennis Commentary Demo</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enable tennis commentary in the toolbar above, then hover and click the file attach buttons below!
          </p>
        </div>
        
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center p-4 border rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <FileAttachButton 
                size="lg"
                variant="primary"
                onFilesSelected={handleFilesSelected('primary')}
              />
            </div>
            <p className="text-sm font-medium">Primary</p>
            <p className="text-xs text-gray-500 mb-2">
              {selectedFiles.primary.length} file(s) selected
            </p>
            {selectedFiles.primary.length > 0 && (
              <button
                onClick={() => clearFiles('primary')}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Clear files
              </button>
            )}
          </div>
          
          <div className="text-center p-4 border rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <FileAttachButton 
                size="lg"
                variant="ghost"
                onFilesSelected={handleFilesSelected('ghost')}
              />
            </div>
            <p className="text-sm font-medium">Ghost</p>
            <p className="text-xs text-gray-500 mb-2">
              {selectedFiles.ghost.length} file(s) selected
            </p>
            {selectedFiles.ghost.length > 0 && (
              <button
                onClick={() => clearFiles('ghost')}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Clear files
              </button>
            )}
          </div>
          
          <div className="text-center p-4 border rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <FileAttachButton 
                size="lg"
                variant="outline"
                onFilesSelected={handleFilesSelected('outline')}
              />
            </div>
            <p className="text-sm font-medium">Outline</p>
            <p className="text-xs text-gray-500 mb-2">
              {selectedFiles.outline.length} file(s) selected
            </p>
            {selectedFiles.outline.length > 0 && (
              <button
                onClick={() => clearFiles('outline')}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Clear files
              </button>
            )}
          </div>
        </div>
        
        <div className="text-center">
          <p className="text-sm text-gray-600">
            Click the buttons above to select files and see the file tracking in action!
          </p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing file attach buttons with tennis commentary. Enable commentary in the toolbar and interact with the buttons!',
      },
    },
  },
};