// ABOUTME: Demo component showcasing FileDiffViewer with various diff scenarios
// ABOUTME: Used in the design system documentation and testing

import React, { useState } from 'react';
import FileDiffViewer from '@/components/files/FileDiffViewer';
import { createFileDiffFromText, createNewFileDiff, createDeletedFileDiff, createBinaryFileDiff } from '@/components/files/FileDiffViewer.utils';

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

const sampleNewFileCode = `// ABOUTME: New utility function for date formatting
// ABOUTME: Provides consistent date formatting across the application

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}`;

const sampleDeletedCode = `// ABOUTME: Deprecated utility function
// ABOUTME: This function is no longer needed and should be removed

export function deprecatedFunction() {
  console.warn('This function is deprecated');
  return null;
}`;

export default function FileDiffViewerDemo() {
  const [selectedDemo, setSelectedDemo] = useState<string>('modified');

  const demoOptions = [
    { key: 'modified', label: 'Modified File', description: 'Shows changes to an existing file' },
    { key: 'new', label: 'New File', description: 'Shows a newly created file' },
    { key: 'deleted', label: 'Deleted File', description: 'Shows a deleted file' },
    { key: 'binary', label: 'Binary File', description: 'Shows a binary file change' }
  ];

  const getDemoContent = () => {
    switch (selectedDemo) {
      case 'modified':
        return createFileDiffFromText(
          sampleOldCode,
          sampleNewCode,
          'src/components/MyComponent.tsx',
          'typescript'
        );
      case 'new':
        return createNewFileDiff(
          sampleNewFileCode,
          'src/utils/dateUtils.ts',
          'typescript'
        );
      case 'deleted':
        return createDeletedFileDiff(
          sampleDeletedCode,
          'src/utils/deprecated.ts',
          'typescript'
        );
      case 'binary':
        return createBinaryFileDiff(
          'assets/images/old-logo.png',
          'assets/images/new-logo.png'
        );
      default:
        return createFileDiffFromText(sampleOldCode, sampleNewCode, 'src/components/MyComponent.tsx', 'typescript');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">FileDiffViewer Demo</h2>
        <p className="text-base-content/70 mb-4">
          A professional file diff viewer component that supports side-by-side and unified views
          with syntax highlighting preparation and responsive design.
        </p>
      </div>

      {/* Demo selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {demoOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => setSelectedDemo(option.key)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedDemo === option.key
                ? 'bg-primary text-primary-content'
                : 'bg-base-200 text-base-content hover:bg-base-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Description */}
      <div className="bg-base-200 p-3 rounded-lg">
        <p className="text-sm text-base-content/70">
          {demoOptions.find(opt => opt.key === selectedDemo)?.description}
        </p>
      </div>

      {/* Demo content */}
      <div className="space-y-4">
        <FileDiffViewer
          diff={getDemoContent()}
          viewMode="side-by-side"
          showLineNumbers={true}
          maxLines={100}
          onCopy={() => {
            // Copy handler for demo
          }}
        />
      </div>

      {/* Usage examples */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Usage Examples</h3>
        
        <div className="bg-base-200 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Basic Usage</h4>
          <pre className="text-sm bg-base-300 p-3 rounded font-mono overflow-x-auto">
{`import { FileDiffViewer } from '@/components/ui';
import { createFileDiffFromText } from '@/components/ui/FileDiffViewer.utils';

const diff = createFileDiffFromText(
  oldContent,
  newContent,
  'src/file.ts',
  'typescript'
);

<FileDiffViewer diff={diff} />`}
          </pre>
        </div>

        <div className="bg-base-200 p-4 rounded-lg">
          <h4 className="font-medium mb-2">Advanced Configuration</h4>
          <pre className="text-sm bg-base-300 p-3 rounded font-mono overflow-x-auto">
{`<FileDiffViewer
  diff={diff}
  viewMode="unified"
  showLineNumbers={true}
  maxLines={200}
  showFullFile={false}
  onCopy={(content) => navigator.clipboard.writeText(content)}
  className="my-custom-class"
/>`}
          </pre>
        </div>
      </div>

      {/* Features */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Features</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-base-200 p-4 rounded-lg">
            <h4 className="font-medium mb-2">View Modes</h4>
            <ul className="text-sm space-y-1 text-base-content/70">
              <li>• Side-by-side comparison</li>
              <li>• Unified diff view</li>
              <li>• Toggle between modes</li>
            </ul>
          </div>
          <div className="bg-base-200 p-4 rounded-lg">
            <h4 className="font-medium mb-2">Display Options</h4>
            <ul className="text-sm space-y-1 text-base-content/70">
              <li>• Line numbers</li>
              <li>• Syntax highlighting prep</li>
              <li>• Responsive design</li>
            </ul>
          </div>
          <div className="bg-base-200 p-4 rounded-lg">
            <h4 className="font-medium mb-2">File Types</h4>
            <ul className="text-sm space-y-1 text-base-content/70">
              <li>• Text files with diff</li>
              <li>• Binary file detection</li>
              <li>• New/deleted files</li>
            </ul>
          </div>
          <div className="bg-base-200 p-4 rounded-lg">
            <h4 className="font-medium mb-2">Interactions</h4>
            <ul className="text-sm space-y-1 text-base-content/70">
              <li>• Copy diff content</li>
              <li>• Expand/collapse</li>
              <li>• Performance optimization</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}