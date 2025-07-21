import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import FileDiffViewer from './FileDiffViewer';
import { createFileDiffFromText, createNewFileDiff, createDeletedFileDiff, createBinaryFileDiff } from './FileDiffViewer.utils';

const meta: Meta<typeof FileDiffViewer> = {
  title: 'Organisms/FileDiffViewer',
  component: FileDiffViewer,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## FileDiffViewer

**Atomic Classification**: Code Comparison Organism  
**Composed of**: CodeBlock + IconButton + NavigationButton + MessageText + SyntaxHighlighting molecules  
**Single Responsibility**: Professional file difference visualization with syntax highlighting and multiple view modes

### Purpose
A comprehensive file difference viewer organism that provides professional-grade code comparison capabilities. Supports side-by-side and unified diff views with syntax highlighting, line numbers, and interactive features for code review and version control workflows.

### When to Use
- Code review interfaces and pull request systems
- Version control and diff visualization
- File comparison and change tracking
- Development tools and IDE integrations
- Documentation and change explanation
- Collaborative coding environments

### Atomic Composition
- **CodeBlock**: Syntax-highlighted code display with language detection
- **IconButton**: View mode toggles, copy actions, expand/collapse controls
- **NavigationButton**: View mode selection and navigation controls
- **MessageText**: File names, line numbers, and diff statistics
- **SyntaxHighlighting**: Advanced code highlighting with theme support
- **Container**: Complex layout with side-by-side and unified modes

### Design Tokens Used
- **Colors**: Diff-specific colors (green for additions, red for deletions)
- **Typography**: Monospace fonts for code, regular fonts for UI
- **Spacing**: Precise line-by-line spacing for diff alignment
- **Borders**: Subtle borders for code blocks and sections
- **Backgrounds**: Highlighted backgrounds for changed lines
- **Shadows**: Subtle elevation for diff containers

### Diff Features
- **Side-by-Side View**: Traditional two-column diff display
- **Unified View**: Single-column unified diff format
- **Syntax Highlighting**: Language-aware code highlighting
- **Line Numbers**: Original and modified line numbering
- **Change Indicators**: Visual markers for additions, deletions, modifications
- **Context Lines**: Surrounding unchanged lines for context

### View Modes
- **Side-by-Side**: Two-column layout showing old and new versions
- **Unified**: Single-column layout with +/- indicators
- **Full File**: Complete file view with all changes highlighted
- **Chunk View**: Focused view on specific change chunks
- **Expandable**: Collapsible sections for large files

### State Management
- **View Mode**: Toggle between side-by-side and unified views
- **Line Visibility**: Control over line number display
- **Expansion State**: Expandable sections for large diffs
- **Copy State**: Clipboard integration for code copying
- **Highlight State**: Interactive line highlighting

### Integration Points
- **Syntax Highlighting**: Advanced syntax highlighting with theme support
- **FontAwesome Icons**: Consistent iconography for view controls
- **Language Detection**: Automatic language identification for highlighting
- **Theme System**: Syntax theme management and customization
- **Clipboard API**: Copy functionality for code segments

### Visual Features
- **Professional Layout**: Industry-standard diff visualization
- **Color Coding**: Intuitive color system for change types
- **Interactive Elements**: Clickable lines and expandable sections
- **Responsive Design**: Adapts to different screen sizes
- **Theme Integration**: Consistent with application theme system

### Performance
- **Efficient Rendering**: Optimized for large files and complex diffs
- **Lazy Loading**: On-demand highlighting and processing
- **Memory Management**: Efficient handling of large code files
- **Caching**: Intelligent caching of highlighted content

### Accessibility
- **Keyboard Navigation**: Full keyboard support for all interactions
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Focus Management**: Clear focus indicators and tab order
- **High Contrast**: Accessible color schemes for diff visualization
- **Alternative Text**: Descriptive text for visual diff elements

### Organism Guidelines
✓ **Do**: Use for professional code review and diff visualization  
✓ **Do**: Provide complete diff data with proper chunk structure  
✓ **Do**: Include syntax highlighting for better code readability  
✓ **Do**: Support both side-by-side and unified view modes  
✓ **Do**: Handle large files with performance optimization  
✗ **Don't**: Use for simple text comparison (use simpler components)  
✗ **Don't**: Skip language detection for syntax highlighting  
✗ **Don't**: Ignore accessibility features for keyboard users  
✗ **Don't**: Override diff colors without maintaining contrast

### File Types Supported
- **JavaScript/TypeScript**: Full syntax highlighting and diff support
- **CSS/SCSS**: Stylesheet diff visualization
- **HTML**: Markup diff with proper highlighting
- **JSON**: Structured data diff display
- **Markdown**: Documentation diff visualization
- **Binary Files**: Binary file change indicators
        `,
      },
    },
  },
  argTypes: {
    diff: {
      description: 'File diff data structure with chunks and metadata',
      control: { type: 'object' },
    },
    viewMode: {
      control: { type: 'select' },
      options: ['side-by-side', 'unified'],
      description: 'Diff view mode',
    },
    showLineNumbers: {
      control: { type: 'boolean' },
      description: 'Whether to show line numbers',
    },
    showFullFile: {
      control: { type: 'boolean' },
      description: 'Whether to show full file content',
    },
    maxLines: {
      control: { type: 'number' },
      description: 'Maximum lines to display',
    },
    onCopy: {
      action: 'copied',
      description: 'Callback when content is copied',
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample code for demonstrations
const sampleOldCode = `import React from 'react';
import { Button } from './Button';

function MyComponent({ title, count }) {
  const handleClick = () => {
    void ('Button clicked');
  };

  return (
    <div className="container">
      <h1>{title}</h1>
      <p>Count: {count}</p>
      <Button onClick={handleClick}>
        Click me
      </Button>
    </div>
  );
}

export default MyComponent;`;

const sampleNewCode = `import React from 'react';
import { Button } from './Button';
import { Counter } from './Counter';

function MyComponent({ title, count, onIncrement }) {
  const handleClick = () => {
    void ('Button clicked');
    onIncrement();
  };

  return (
    <div className="container">
      <h1>{title}</h1>
      <Counter value={count} />
      <Button onClick={handleClick} variant="primary">
        Increment
      </Button>
    </div>
  );
}

export default MyComponent;`;

const sampleDiff = createFileDiffFromText(
  sampleOldCode,
  sampleNewCode,
  'src/components/MyComponent.tsx',
  'tsx'
);

export const Default: Story = {
  args: {
    diff: sampleDiff,
    viewMode: 'side-by-side',
    showLineNumbers: true,
  },
  render: (args) => (
    <div className="w-full h-screen bg-base-100 p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">File Diff Viewer</h3>
        <p className="text-sm text-base-content/60">
          Showing changes in {args.diff.newFilePath}
        </p>
      </div>
      <FileDiffViewer {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Default file diff viewer showing code changes in side-by-side mode.',
      },
    },
  },
};

export const UnifiedView: Story = {
  args: {
    diff: sampleDiff,
    viewMode: 'unified',
    showLineNumbers: true,
  },
  render: (args) => (
    <div className="w-full h-screen bg-base-100 p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Unified Diff View</h3>
        <p className="text-sm text-base-content/60">
          Single-column unified diff format
        </p>
      </div>
      <FileDiffViewer {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Unified diff view showing changes in a single column with +/- indicators.',
      },
    },
  },
};

export const ViewModeComparison: Story = {
  render: () => {
    const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side');
    
    return (
      <div className="w-full h-screen bg-base-100 p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">View Mode Comparison</h3>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setViewMode('side-by-side')}
              className={`btn btn-sm ${viewMode === 'side-by-side' ? 'btn-primary' : 'btn-ghost'}`}
            >
              Side-by-Side
            </button>
            <button
              onClick={() => setViewMode('unified')}
              className={`btn btn-sm ${viewMode === 'unified' ? 'btn-primary' : 'btn-ghost'}`}
            >
              Unified
            </button>
          </div>
        </div>
        <FileDiffViewer
          diff={sampleDiff}
          viewMode={viewMode}
          showLineNumbers={true}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo comparing side-by-side and unified view modes.',
      },
    },
  },
};

export const NewFile: Story = {
  render: () => {
    const newFileDiff = createNewFileDiff(
      'src/components/NewComponent.tsx',
      `import React from 'react';

interface NewComponentProps {
  title: string;
  description: string;
}

export function NewComponent({ title, description }: NewComponentProps) {
  return (
    <div className="new-component">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export default NewComponent;`,
      'tsx'
    );

    return (
      <div className="w-full h-screen bg-base-100 p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">New File</h3>
          <p className="text-sm text-base-content/60">
            Showing a newly created file
          </p>
        </div>
        <FileDiffViewer
          diff={newFileDiff}
          viewMode="side-by-side"
          showLineNumbers={true}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File diff viewer showing a newly created file with all additions.',
      },
    },
  },
};

export const DeletedFile: Story = {
  render: () => {
    const deletedFileDiff = createDeletedFileDiff(
      'src/components/OldComponent.tsx',
      `import React from 'react';

function OldComponent() {
  return (
    <div className="old-component">
      <h1>This component will be deleted</h1>
      <p>All content will be removed</p>
    </div>
  );
}

export default OldComponent;`,
      'tsx'
    );

    return (
      <div className="w-full h-screen bg-base-100 p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Deleted File</h3>
          <p className="text-sm text-base-content/60">
            Showing a deleted file with all removals
          </p>
        </div>
        <FileDiffViewer
          diff={deletedFileDiff}
          viewMode="side-by-side"
          showLineNumbers={true}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File diff viewer showing a deleted file with all removals.',
      },
    },
  },
};

export const BinaryFile: Story = {
  render: () => {
    const binaryFileDiff = createBinaryFileDiff(
      'assets/logo.png',
      'assets/logo.png'
    );

    return (
      <div className="w-full h-screen bg-base-100 p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Binary File</h3>
          <p className="text-sm text-base-content/60">
            Showing binary file changes
          </p>
        </div>
        <FileDiffViewer
          diff={binaryFileDiff}
          viewMode="side-by-side"
          showLineNumbers={true}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File diff viewer showing binary file changes (images, etc.).',
      },
    },
  },
};

export const WithoutLineNumbers: Story = {
  args: {
    diff: sampleDiff,
    viewMode: 'side-by-side',
    showLineNumbers: false,
  },
  render: (args) => (
    <div className="w-full h-screen bg-base-100 p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Without Line Numbers</h3>
        <p className="text-sm text-base-content/60">
          Clean diff view without line numbers
        </p>
      </div>
      <FileDiffViewer {...args} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Diff viewer with line numbers disabled for cleaner appearance.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-6xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 FileDiffViewer Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then explore the diff viewer features!
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Side-by-Side View</h4>
          <div className="bg-base-100 border border-base-300 rounded-lg p-4 h-64 overflow-hidden">
            <FileDiffViewer
              diff={sampleDiff}
              viewMode="side-by-side"
              showLineNumbers={true}
              maxLines={10}
            />
          </div>
        </div>
        
        <div className="cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Unified View</h4>
          <div className="bg-base-100 border border-base-300 rounded-lg p-4 h-64 overflow-hidden">
            <FileDiffViewer
              diff={sampleDiff}
              viewMode="unified"
              showLineNumbers={true}
              maxLines={10}
            />
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">FileDiffViewer Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Syntax Highlighting</strong> - Language-aware code highlighting</li>
          <li>• <strong>Multiple View Modes</strong> - Side-by-side and unified diff views</li>
          <li>• <strong>Line Numbers</strong> - Original and modified line numbering</li>
          <li>• <strong>Change Indicators</strong> - Visual markers for additions and deletions</li>
          <li>• <strong>File Type Support</strong> - Handles text, code, and binary files</li>
          <li>• <strong>Performance</strong> - Optimized for large files and complex diffs</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing FileDiffViewer with tennis commentary. Enable commentary in the toolbar and explore the diff features!',
      },
    },
  },
};