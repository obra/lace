// ABOUTME: Storybook story for InlineCode.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import InlineCode from './InlineCode';

const meta: Meta<typeof InlineCode> = {
  title: 'Atoms/InlineCode',
  component: InlineCode,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## InlineCode

**Atomic Classification**: Text Atom  
**Source**: Core UI primitive for inline code snippets  
**Single Responsibility**: Display short code snippets with optional syntax highlighting

### Purpose
A fundamental text atom that renders inline code snippets with optional syntax highlighting. Used for short code references within text content, maintaining consistent monospace styling and optional language-specific highlighting.

### When to Use
- Short code snippets within text
- Variable names and function references
- API endpoints and configuration values
- Terminal commands and file paths
- Quick code demonstrations

### Design Tokens Used
- **Typography**: Monospace font family for code readability
- **Colors**: Syntax highlighting colors when enabled
- **Spacing**: Consistent padding and margin
- **Background**: Subtle background for code distinction
- **Borders**: Rounded corners for modern appearance

### Features
- **Syntax Highlighting**: Optional language-specific highlighting
- **Loading States**: Graceful loading for highlighting
- **Fallback Handling**: Plain text fallback for unsupported languages
- **Performance**: Async highlighting with cancellation support

### Language Support
- **JavaScript/TypeScript**: Full syntax highlighting
- **Python**: Keyword and string highlighting
- **HTML/CSS**: Tag and property highlighting
- **JSON**: Structure highlighting
- **Plain Text**: No highlighting fallback

### Accessibility
- Semantic HTML with proper code element
- Screen reader compatible
- High contrast mode support
- Keyboard navigation friendly

### Atom Guidelines
✓ **Do**: Use for short code snippets (< 1 line)  
✓ **Do**: Enable highlighting for known languages  
✓ **Do**: Provide fallback for long content  
✓ **Do**: Use within text content appropriately  
✗ **Don't**: Use for multi-line code blocks  
✗ **Don't**: Override monospace font  
✗ **Don't**: Use for non-code content
        `,
      },
    },
  },
  argTypes: {
    code: {
      control: { type: 'text' },
      description: 'The code snippet to display',
    },
    language: {
      control: { type: 'select' },
      options: ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'plaintext'],
      description: 'Programming language for syntax highlighting',
    },
    enableHighlighting: {
      control: { type: 'boolean' },
      description: 'Enable syntax highlighting',
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
    code: 'console.log("Hello, world!");',
    language: 'javascript',
    enableHighlighting: false,
  },
};

export const WithHighlighting: Story = {
  args: {
    code: 'const greeting = "Hello, world!";',
    language: 'javascript',
    enableHighlighting: true,
  },
};

export const TypeScript: Story = {
  args: {
    code: 'interface User { name: string; age: number; }',
    language: 'typescript',
    enableHighlighting: true,
  },
};

export const Python: Story = {
  args: {
    code: 'def greet(name: str) -> str:',
    language: 'python',
    enableHighlighting: true,
  },
};

export const HTML: Story = {
  args: {
    code: '<div className="container">',
    language: 'html',
    enableHighlighting: true,
  },
};

export const CSS: Story = {
  args: {
    code: 'background-color: #f0f0f0;',
    language: 'css',
    enableHighlighting: true,
  },
};

export const JSON: Story = {
  args: {
    code: '{"name": "John", "age": 30}',
    language: 'json',
    enableHighlighting: true,
  },
};

export const Bash: Story = {
  args: {
    code: 'npm install --save-dev storybook',
    language: 'bash',
    enableHighlighting: true,
  },
};

export const PlainText: Story = {
  args: {
    code: 'This is plain text',
    language: 'plaintext',
    enableHighlighting: true,
  },
};

export const LongCode: Story = {
  args: {
    code: 'const veryLongVariableName = "This is a very long string that demonstrates how the component handles longer code snippets";',
    language: 'javascript',
    enableHighlighting: true,
  },
};

export const AllLanguages: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-4">Syntax Highlighting Examples</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 border rounded-lg">
          <h4 className="font-medium mb-2">JavaScript</h4>
          <p>
            Function call:{' '}
            <InlineCode code='console.log("Hello");' language="javascript" enableHighlighting />
          </p>
        </div>

        <div className="p-3 border rounded-lg">
          <h4 className="font-medium mb-2">TypeScript</h4>
          <p>
            Interface: <InlineCode code="User[]" language="typescript" enableHighlighting />
          </p>
        </div>

        <div className="p-3 border rounded-lg">
          <h4 className="font-medium mb-2">Python</h4>
          <p>
            Function: <InlineCode code='print("Hello")' language="python" enableHighlighting />
          </p>
        </div>

        <div className="p-3 border rounded-lg">
          <h4 className="font-medium mb-2">HTML</h4>
          <p>
            Tag: <InlineCode code="<button>" language="html" enableHighlighting />
          </p>
        </div>

        <div className="p-3 border rounded-lg">
          <h4 className="font-medium mb-2">CSS</h4>
          <p>
            Property: <InlineCode code="color: blue;" language="css" enableHighlighting />
          </p>
        </div>

        <div className="p-3 border rounded-lg">
          <h4 className="font-medium mb-2">JSON</h4>
          <p>
            Object: <InlineCode code='{"key": "value"}' language="json" enableHighlighting />
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Examples of inline code with different programming languages and syntax highlighting.',
      },
    },
  },
};

export const InTextContext: Story = {
  render: () => (
    <div className="max-w-2xl p-4">
      <h3 className="text-lg font-semibold mb-4">Inline Code in Text Context</h3>

      <div className="space-y-4 text-sm">
        <p>
          To create a new React component, you can use the{' '}
          <InlineCode code="useState" language="javascript" enableHighlighting /> hook for state
          management.
        </p>

        <p>
          The API endpoint <InlineCode code="/api/users" language="plaintext" /> returns a list of
          users in JSON format.
        </p>

        <p>
          Install the package with{' '}
          <InlineCode code="npm install react" language="bash" enableHighlighting /> to get started.
        </p>

        <p>
          The configuration object should include{' '}
          <InlineCode code='{"timeout": 5000}' language="json" enableHighlighting /> for proper
          error handling.
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Inline code components used naturally within text content.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 InlineCode Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the code snippets
          below!
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">JavaScript Function</h4>
          <p className="text-sm">
            Call the function:{' '}
            <InlineCode code="getUserData()" language="javascript" enableHighlighting />
          </p>
        </div>

        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">TypeScript Interface</h4>
          <p className="text-sm">
            Define the type:{' '}
            <InlineCode code="User | null" language="typescript" enableHighlighting />
          </p>
        </div>

        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Python Method</h4>
          <p className="text-sm">
            Class method:{' '}
            <InlineCode code="self.process_data()" language="python" enableHighlighting />
          </p>
        </div>

        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-2">Terminal Command</h4>
          <p className="text-sm">
            Run the command:{' '}
            <InlineCode code="git commit -m 'Update'" language="bash" enableHighlighting />
          </p>
        </div>
      </div>

      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Usage Tips:</h4>
        <ul className="text-sm space-y-1">
          <li>
            • <strong>Hover</strong> over code snippets for tennis commentary
          </li>
          <li>
            • <strong>Click</strong> to interact with the highlighting
          </li>
          <li>
            • <strong>Enable highlighting</strong> for better code readability
          </li>
          <li>
            • <strong>Use appropriate languages</strong> for accurate highlighting
          </li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Interactive demo showcasing inline code with tennis commentary. Enable commentary in the toolbar and interact with the code snippets!',
      },
    },
  },
};
