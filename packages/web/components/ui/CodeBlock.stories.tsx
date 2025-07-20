import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import CodeBlock from './CodeBlock';

const meta: Meta<typeof CodeBlock> = {
  title: 'Molecules/CodeBlock',
  component: CodeBlock,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
## CodeBlock

**Molecular Classification**: Content Processing Molecule  
**Source**: Advanced code display component  
**Single Responsibility**: Render code with syntax highlighting, line numbers, and interaction features

### Purpose
A sophisticated content molecule that combines multiple atoms (buttons, loading states, text formatting) to create a complete code display experience. Features syntax highlighting, copy functionality, language detection, and performance optimizations for large code blocks.

### When to Use
- Code documentation and examples
- Technical blog posts and tutorials
- Code review interfaces
- API documentation
- Error messages with code context
- Chat messages with code snippets
- File content display

### Design Tokens Used
- **Typography**: Monospace font family for code display
- **Colors**: Base colors with syntax highlighting themes
- **Spacing**: Consistent padding and line spacing
- **Borders**: Subtle borders for header and content separation
- **Animations**: Loading states and smooth transitions
- **Components**: Integrates with Icon buttons and loading indicators

### Features
- **Syntax Highlighting**: Multi-language support with theme integration
- **Copy Functionality**: One-click code copying with feedback
- **Language Detection**: Automatic language identification
- **Line Numbers**: Optional line number display
- **Performance**: Optimized for large code blocks with debouncing
- **Collapsible**: Optional expand/collapse functionality
- **JSON Formatting**: Automatic JSON prettification

### Content Processing
- **Large Code Handling**: Special handling for performance with large files
- **Language Detection**: Filename-based and content-based detection
- **JSON Formatting**: Automatic formatting for JSON content
- **Theme Integration**: Synchronized with application theme system
- **Error Handling**: Graceful fallback for highlighting failures

### Integration Points
- **InlineCode**: For shorter code snippets
- **MessageText**: For mixed text and code content
- **Syntax Themes**: Theme manager integration
- **Performance Utils**: Debouncing and size optimization
- **FontAwesome**: Icon integration for buttons

### Accessibility
- **Keyboard Navigation**: Full keyboard support for interactions
- **Screen Reader Support**: Proper ARIA labels and structure
- **High Contrast**: Theme-aware contrast handling
- **Focus Management**: Clear focus indicators
- **Copy Feedback**: Audio and visual feedback for copy actions

### Molecule Guidelines
✓ **Do**: Use for multi-line code display  
✓ **Do**: Enable copy functionality for user convenience  
✓ **Do**: Show language labels for clarity  
✓ **Do**: Handle large code blocks efficiently  
✗ **Don't**: Use for single-line code (use InlineCode)  
✗ **Don't**: Override syntax highlighting manually  
✗ **Don't**: Disable copy functionality without reason
        `,
      },
    },
  },
  argTypes: {
    code: {
      control: { type: 'text' },
      description: 'The code content to display',
    },
    language: {
      control: { type: 'select' },
      options: ['javascript', 'typescript', 'python', 'jsx', 'css', 'html', 'json', 'bash', 'markdown'],
      description: 'Programming language for syntax highlighting',
    },
    filename: {
      control: { type: 'text' },
      description: 'Optional filename to display',
    },
    showLineNumbers: {
      control: { type: 'boolean' },
      description: 'Whether to show line numbers',
    },
    showCopyButton: {
      control: { type: 'boolean' },
      description: 'Whether to show copy button',
    },
    showLanguageLabel: {
      control: { type: 'boolean' },
      description: 'Whether to show language label',
    },
    showHeader: {
      control: { type: 'boolean' },
      description: 'Whether to show header bar',
    },
    maxHeight: {
      control: { type: 'text' },
      description: 'Maximum height for scrollable content',
    },
    collapsed: {
      control: { type: 'boolean' },
      description: 'Whether to start collapsed',
    },
    collapsible: {
      control: { type: 'boolean' },
      description: 'Whether the code block can be collapsed',
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

const sampleJavaScript = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Generate first 10 Fibonacci numbers
const fibSequence = [];
for (let i = 0; i < 10; i++) {
  fibSequence.push(fibonacci(i));
}

console.log('Fibonacci sequence:', fibSequence);`;

const sampleTypeScript = `interface User {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

class UserService {
  private users: User[] = [];

  async createUser(userData: Omit<User, 'id'>): Promise<User> {
    const newUser: User = {
      id: Date.now(),
      ...userData,
    };
    
    this.users.push(newUser);
    return newUser;
  }

  findUserById(id: number): User | undefined {
    return this.users.find(user => user.id === id);
  }
}`;

const samplePython = `import asyncio
import aiohttp
from typing import List, Dict, Optional

class APIClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get_users(self) -> List[Dict]:
        async with self.session.get(f"{self.base_url}/users") as response:
            return await response.json()

# Usage
async def main():
    async with APIClient("https://api.example.com") as client:
        users = await client.get_users()
        print(f"Found {len(users)} users")

if __name__ == "__main__":
    asyncio.run(main())`;

const sampleJSON = `{
  "name": "my-awesome-project",
  "version": "1.0.0",
  "description": "A comprehensive project with multiple dependencies",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc && webpack",
    "dev": "webpack serve --mode development",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.4.0",
    "lodash": "^4.17.21"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/node": "^18.16.0",
    "typescript": "^5.0.0",
    "webpack": "^5.88.0",
    "jest": "^29.5.0"
  }
}`;

export const Default: Story = {
  args: {
    code: sampleJavaScript,
    language: 'javascript',
    showLineNumbers: false,
    showCopyButton: true,
    showLanguageLabel: true,
    showHeader: true,
    maxHeight: '400px',
    collapsed: false,
    collapsible: false,
  },
};

export const WithLineNumbers: Story = {
  args: {
    code: sampleTypeScript,
    language: 'typescript',
    showLineNumbers: true,
    showCopyButton: true,
    showLanguageLabel: true,
    showHeader: true,
  },
};

export const WithFilename: Story = {
  args: {
    code: samplePython,
    language: 'python',
    filename: 'api_client.py',
    showLineNumbers: true,
    showCopyButton: true,
    showLanguageLabel: true,
    showHeader: true,
  },
};

export const JSONFormatting: Story = {
  args: {
    code: sampleJSON,
    language: 'json',
    filename: 'package.json',
    showLineNumbers: true,
    showCopyButton: true,
    showLanguageLabel: true,
    showHeader: true,
  },
};

export const Collapsible: Story = {
  args: {
    code: sampleTypeScript,
    language: 'typescript',
    filename: 'user-service.ts',
    showLineNumbers: true,
    showCopyButton: true,
    showLanguageLabel: true,
    showHeader: true,
    collapsible: true,
    collapsed: false,
  },
};

export const NoHeader: Story = {
  args: {
    code: `const greeting = "Hello, World!";
console.log(greeting);`,
    language: 'javascript',
    showHeader: false,
    showLineNumbers: false,
    showCopyButton: true,
  },
};

export const LargeCodeBlock: Story = {
  args: {
    code: `// This is a large code block example
${Array.from({ length: 50 }, (_, i) => `function example${i}() {
  return "This is example function number ${i}";
}

const result${i} = example${i}();
console.log(result${i});
`).join('\n')}`,
    language: 'javascript',
    filename: 'large-example.js',
    showLineNumbers: true,
    showCopyButton: true,
    showLanguageLabel: true,
    showHeader: true,
    maxHeight: '300px',
  },
};

export const DifferentLanguages: Story = {
  render: () => (
    <div className="space-y-6">
      <CodeBlock
        code={`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World</title>
</head>
<body>
    <h1>Hello, World!</h1>
    <p>This is a simple HTML page.</p>
</body>
</html>`}
        language="html"
        filename="index.html"
        showLineNumbers={true}
      />
      
      <CodeBlock
        code={`body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 0;
  padding: 20px;
  background-color: #f5f5f5;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

h1 {
  color: #333;
  margin-bottom: 1rem;
}`}
        language="css"
        filename="styles.css"
        showLineNumbers={true}
      />
      
      <CodeBlock
        code={`#!/bin/bash

# Deploy script for production
set -e

echo "Starting deployment..."

# Build the application
npm run build

# Run tests
npm test

# Deploy to server
rsync -avz --delete ./dist/ user@server:/path/to/app/

echo "Deployment complete!"`}
        language="bash"
        filename="deploy.sh"
        showLineNumbers={true}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Examples of code blocks with different programming languages.',
      },
    },
  },
};

export const InteractiveCopy: Story = {
  render: () => {
    const [copyFeedback, setCopyFeedback] = useState<string>('');
    
    const handleCopy = (code: string) => {
      navigator.clipboard.writeText(code);
      setCopyFeedback(`Copied ${code.length} characters!`);
      setTimeout(() => setCopyFeedback(''), 3000);
    };
    
    return (
      <div className="space-y-4">
        {copyFeedback && (
          <div className="bg-success/20 text-success p-2 rounded text-sm">
            {copyFeedback}
          </div>
        )}
        
        <CodeBlock
          code={`function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));`}
          language="javascript"
          filename="greeting.js"
          showLineNumbers={true}
          onCopy={handleCopy}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive copy functionality with custom feedback.',
      },
    },
  },
};

export const ErrorHandling: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="text-sm text-base-content/70 mb-4">
        These examples demonstrate graceful error handling and fallback rendering:
      </div>
      
      <CodeBlock
        code="This is plain text without syntax highlighting"
        language="unknown-language"
        filename="plain.txt"
        showLineNumbers={true}
      />
      
      <CodeBlock
        code={`// This code will fallback to plain text if highlighting fails
const example = "Hello World";
console.log(example);`}
        language="javascript"
        filename="fallback.js"
        showLineNumbers={true}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Error handling and fallback behavior for unsupported languages.',
      },
    },
  },
};

export const AllFeatures: Story = {
  render: () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="font-medium mb-2">Minimal</h4>
          <CodeBlock
            code="console.log('Hello!');"
            language="javascript"
            showHeader={false}
            showLineNumbers={false}
          />
        </div>
        
        <div>
          <h4 className="font-medium mb-2">With Line Numbers</h4>
          <CodeBlock
            code={`function add(a, b) {
  return a + b;
}

console.log(add(2, 3));`}
            language="javascript"
            showLineNumbers={true}
          />
        </div>
        
        <div>
          <h4 className="font-medium mb-2">With Filename</h4>
          <CodeBlock
            code={`export default function Component() {
  return <div>Hello!</div>;
}`}
            language="jsx"
            filename="Component.jsx"
            showLineNumbers={true}
          />
        </div>
        
        <div>
          <h4 className="font-medium mb-2">Collapsible</h4>
          <CodeBlock
            code={`import React from 'react';

const App = () => {
  return (
    <div>
      <h1>My App</h1>
      <p>Welcome to my application!</p>
    </div>
  );
};

export default App;`}
            language="jsx"
            filename="App.jsx"
            showLineNumbers={true}
            collapsible={true}
            collapsed={true}
          />
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Comprehensive showcase of all CodeBlock features and configurations.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 CodeBlock Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and interact with the code blocks below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">JavaScript Function</h4>
          <CodeBlock
            code={`function calculateFibonacci(n) {
  if (n <= 1) return n;
  return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}

console.log(calculateFibonacci(10));`}
            language="javascript"
            filename="fibonacci.js"
            showLineNumbers={true}
            showCopyButton={true}
          />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">React Component</h4>
          <CodeBlock
            code={`import React, { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}`}
            language="jsx"
            filename="Counter.jsx"
            showLineNumbers={true}
            showCopyButton={true}
          />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Python Class</h4>
          <CodeBlock
            code={`class DataProcessor:
    def __init__(self, data):
        self.data = data
    
    def process(self):
        return [x * 2 for x in self.data if x > 0]
    
    def analyze(self):
        processed = self.process()
        return {
            'count': len(processed),
            'sum': sum(processed),
            'avg': sum(processed) / len(processed) if processed else 0
        }`}
            language="python"
            filename="processor.py"
            showLineNumbers={true}
            showCopyButton={true}
          />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow">
          <h4 className="font-medium mb-3">Configuration JSON</h4>
          <CodeBlock
            code={`{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "jest"
  }
}`}
            language="json"
            filename="package.json"
            showLineNumbers={true}
            showCopyButton={true}
          />
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">CodeBlock Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Syntax Highlighting</strong> - Multi-language support with theme integration</li>
          <li>• <strong>Copy Functionality</strong> - One-click code copying with visual feedback</li>
          <li>• <strong>Language Detection</strong> - Automatic language identification and labeling</li>
          <li>• <strong>Performance</strong> - Optimized handling of large code blocks</li>
          <li>• <strong>Line Numbers</strong> - Optional line numbering for reference</li>
          <li>• <strong>Collapsible</strong> - Expandable/collapsible code sections</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing CodeBlock with tennis commentary. Enable commentary in the toolbar and interact with the code blocks!',
      },
    },
  },
};