// ABOUTME: Storybook story for file-write.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { fileWriteRenderer } from './file-write';
import type { ToolResult } from './types';

const meta: Meta = {
  title: 'Molecules/Tools/FileWriteRenderer',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
## FileWriteRenderer

**Molecular Classification**: Tool Display Molecule  
**Composed of**: FontAwesome Icons + Status Indicators + Typography + Content Formatting  
**Single Responsibility**: Professional file write operation visualization with clear status feedback

### Purpose
A specialized tool renderer molecule that transforms file write operation results into beautiful, informative visual displays. Provides clear success/error feedback, file information, and consistent styling that matches Lace's design system perfectly.

### When to Use
- File write operation results in conversation timelines
- Tool output display for file creation and modification
- Development workflows showing file operations
- Build process and deployment file operations
- Configuration and setup file writing
- Code generation and file creation tasks

### Atomic Composition
- **FontAwesome Icons**: File-themed iconography (faFileCode)
- **Status Indicators**: Success/error state styling with color coding
- **Typography**: Monospace file paths, readable size indicators
- **Content Formatting**: Structured layout for file information
- **Container**: Rounded borders with semantic color backgrounds
- **Text Elements**: Filename prominence, path details, size formatting

### Design Tokens Used
- **Colors**: Success (green), Error (red), Base content with opacity
- **Typography**: Font families for mono (paths) and sans (UI text)  
- **Spacing**: Consistent padding, gaps, and margins
- **Borders**: Rounded corners, semantic border colors
- **Backgrounds**: Subtle backgrounds with opacity for status
- **Shadows**: None - clean flat design approach

### File Operation Features
- **Success Display**: Green-themed success indicators with file details
- **Error Handling**: Red-themed error display with actionable messages
- **File Information**: Filename prominence, path display, size formatting
- **Path Handling**: Intelligent truncation and filename extraction
- **Size Formatting**: Human-readable file sizes (bytes, KB, MB, GB)
- **Content Preview**: Preview capability for small files (future enhancement)

### State Management
- **Success State**: Green styling, file details, confirmation messaging
- **Error State**: Red styling, error details, helpful error messages
- **Empty State**: Graceful handling of missing content
- **Loading State**: Not applicable (operations are atomic)

### Visual Features
- **File-Centric Design**: Uses file code icons and file-themed styling
- **Status Colors**: Semantic green/red color system for success/error
- **Hierarchy**: Filename > Size > Path information hierarchy
- **Responsive**: Works across all viewport sizes with text wrapping
- **Accessibility**: Proper contrast ratios and semantic HTML structure

### Error Handling Excellence
- **Permission Errors**: Clear indication of access issues
- **Disk Space**: Helpful messaging for storage problems
- **Path Errors**: Directory and path-related issue explanations
- **Generic Errors**: Fallback messaging with actionable guidance
- **Content Analysis**: Intelligent error detection from tool output

### Integration Points
- **Tool System**: Implements ToolRenderer interface completely
- **Icon System**: FontAwesome integration with consistent iconography
- **Design System**: Matches established color tokens and spacing
- **Timeline**: Seamless integration with conversation timeline display
- **Theme System**: Respects application theme and color schemes

### Performance
- **Efficient Rendering**: Minimal DOM nodes with optimized structure
- **Text Processing**: Fast regex-based parsing of file information
- **Memory Usage**: Lightweight with no unnecessary state
- **Bundle Impact**: Tree-shakeable with selective imports

### Accessibility
- **Screen Readers**: Semantic HTML with proper ARIA where needed
- **Color Blind**: Status indicated by text and icons, not just color
- **Contrast**: All text meets WCAG AA contrast requirements
- **Focus**: Interactive elements have clear focus indicators
- **Text Scaling**: Responsive to user text scaling preferences

### Molecule Guidelines
✓ **Do**: Use for file write operation result display  
✓ **Do**: Trust the built-in error detection and status parsing  
✓ **Do**: Leverage the file information extraction features  
✓ **Do**: Combine with other timeline molecules for rich conversations  

❌ **Don't**: Override the established styling patterns  
❌ **Don't**: Use for non-file operations (use appropriate tool renderers)  
❌ **Don't**: Modify the color system (breaks semantic consistency)  
❌ **Don't**: Add complex state management (keep it simple)  

### Technical Implementation
- **Framework**: React with TypeScript for type safety
- **Styling**: Tailwind CSS with semantic color tokens
- **Icons**: FontAwesome with faFileCode for consistency
- **Parsing**: Regex-based extraction of file paths and sizes
- **Testing**: Comprehensive test coverage with visual rendering tests
        `
      }
    }
  }
};

export default meta;
type Story = StoryObj;

// Mock render function to display the component
const renderFileWriteResult = (result: ToolResult) => {
  return fileWriteRenderer.renderResult!(result);
};

export const FileWriteSuccess: Story = {
  name: 'File Write Success',
  render: () => {
    const successResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 1.2 KB to /home/user/projects/lace/src/components/Button.tsx',
        },
      ],
      status: 'completed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Successful File Write</h3>
        <p className="text-base-content/70">
          Shows successful file creation with filename prominence, file size, and full path details.
        </p>
        {renderFileWriteResult(successResult)}
      </div>
    );
  },
};

export const FileWriteError: Story = {
  name: 'File Write Error',
  render: () => {
    const errorResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Permission denied writing to /etc/system/config.conf. Check file permissions or choose a different location. File system error: EACCES',
        },
      ],
      status: 'failed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Permission Denied Error</h3>
        <p className="text-base-content/70">
          Shows error state with clear messaging and actionable guidance for permission issues.
        </p>
        {renderFileWriteResult(errorResult)}
      </div>
    );
  },
};

export const LargeFileWrite: Story = {
  name: 'Large File Write',
  render: () => {
    const largeFileResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 15.7 MB to /home/user/data/datasets/machine-learning-training-data.json',
        },
      ],
      status: 'completed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Large File Success</h3>
        <p className="text-base-content/70">
          Demonstrates file size formatting for larger files with clear size indication.
        </p>
        {renderFileWriteResult(largeFileResult)}
      </div>
    );
  },
};

export const LongPathWrite: Story = {
  name: 'Long Path Write',
  render: () => {
    const longPathResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 847 bytes to /very/deeply/nested/directory/structure/with/many/levels/and/subdirectories/final-component.tsx',
        },
      ],
      status: 'completed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Long File Path</h3>
        <p className="text-base-content/70">
          Shows how long file paths are handled with filename prominence and full path display.
        </p>
        {renderFileWriteResult(longPathResult)}
      </div>
    );
  },
};

export const DiskSpaceError: Story = {
  name: 'Disk Space Error',
  render: () => {
    const diskError: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Insufficient disk space to write file. Free up disk space and try again. File system error: ENOSPC',
        },
      ],
      status: 'failed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Disk Space Error</h3>
        <p className="text-base-content/70">
          Error display for disk space issues with clear actionable guidance.
        </p>
        {renderFileWriteResult(diskError)}
      </div>
    );
  },
};

export const DirectoryError: Story = {
  name: 'Directory Error',
  render: () => {
    const dirError: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Path /home/user/documents is a directory, not a file. Specify a file path instead of a directory path.',
        },
      ],
      status: 'failed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Directory Path Error</h3>
        <p className="text-base-content/70">
          Shows error handling when user specifies directory instead of file path.
        </p>
        {renderFileWriteResult(dirError)}
      </div>
    );
  },
};

export const EmptyContent: Story = {
  name: 'Empty Content',
  render: () => {
    const emptyResult: ToolResult = {
      content: [],
      status: 'completed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Empty Result</h3>
        <p className="text-base-content/70">
          Graceful handling of empty tool results with appropriate fallback display.
        </p>
        {renderFileWriteResult(emptyResult)}
      </div>
    );
  },
};

export const SmallFileWrite: Story = {
  name: 'Small File Write', 
  render: () => {
    const smallFileResult: ToolResult = {
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 47 bytes to package.json',
        },
      ],
      status: 'completed' as const,
    };

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Small File Success</h3>
        <p className="text-base-content/70">
          Small file write with byte-level size indication and root-level file path.
        </p>
        {renderFileWriteResult(smallFileResult)}
      </div>
    );
  },
};

export const AllVariants: Story = {
  name: 'All Variants Showcase',
  render: () => {
    const variants = [
      {
        title: 'Success - Regular File',
        result: {
          content: [{ type: 'text' as const, text: 'Successfully wrote 2.1 KB to src/components/Header.tsx' }],
          status: 'completed' as const,
        },
      },
      {
        title: 'Success - Large File',
        result: {
          content: [{ type: 'text' as const, text: 'Successfully wrote 8.9 MB to assets/images/hero-background.jpg' }],
          status: 'completed' as const,
        },
      },
      {
        title: 'Error - Permission Denied',
        result: {
          content: [{ type: 'text' as const, text: 'Permission denied writing to /root/config.txt. Check file permissions or choose a different location.' }],
          status: 'failed' as const,
        },
      },
      {
        title: 'Error - Disk Full',
        result: {
          content: [{ type: 'text' as const, text: 'Insufficient disk space to write file. Free up disk space and try again. File system error: ENOSPC' }],
          status: 'failed' as const,
        },
      },
      {
        title: 'Success - Small File',
        result: {
          content: [{ type: 'text' as const, text: 'Successfully wrote 128 bytes to .gitignore' }],
          status: 'completed' as const,
        },
      },
    ];

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">🎾 FileWriteRenderer Showcase</h3>
          <p className="text-base-content/70">
            Complete showcase of all file write renderer states and variations.
          </p>
        </div>
        
        {variants.map((variant, index) => (
          <div key={index} className="space-y-2">
            <h4 className="font-medium text-base-content/80">{variant.title}</h4>
            {renderFileWriteResult(variant.result)}
          </div>
        ))}

        <div className="mt-8 p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <h4 className="font-medium mb-2">📋 Renderer Features:</h4>
          <ul className="text-sm text-base-content/80 space-y-1 list-disc list-inside">
            <li><strong>Success States:</strong> Green theming with file details and size formatting</li>
            <li><strong>Error States:</strong> Red theming with actionable error messages</li>
            <li><strong>File Information:</strong> Prominent filename, path display, size indicators</li>
            <li><strong>Smart Parsing:</strong> Automatic extraction of file data from tool output</li>
            <li><strong>Responsive Design:</strong> Text wrapping and mobile-friendly layouts</li>
            <li><strong>Icon Integration:</strong> File-themed icons with semantic meaning</li>
          </ul>
        </div>
      </div>
    );
  },
};