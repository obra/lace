import type { Meta, StoryObj } from '@storybook/react';
import MessageText from './MessageText';

const meta: Meta<typeof MessageText> = {
  title: 'Atoms/MessageText',
  component: MessageText,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
## MessageText

**Atomic Classification**: Content Processing Atom  
**Source**: Core UI primitive for formatted text content  
**Single Responsibility**: Parse and render text with code blocks and inline code

### Purpose
A fundamental content atom that intelligently parses and renders text content with mixed formatting. Handles code blocks, inline code, and text formatting while maintaining proper typography and spacing for message-like content.

### When to Use
- Chat message content
- Comment text with code snippets
- Documentation text with code examples
- User-generated content with formatting
- Rich text display with code support
- Technical content with mixed formats

### Design Tokens Used
- **Typography**: Base text styling with relaxed line height
- **Colors**: Base-content for text readability
- **Spacing**: Consistent margins for code blocks
- **Components**: Integrates with CodeBlock and InlineCode atoms
- **Layout**: Proper spacing between different content types

### Features
- **Code Block Parsing**: Extracts and renders fenced code blocks
- **Inline Code Support**: Handles backtick-wrapped inline code
- **Language Detection**: Automatic language detection for code blocks
- **Line Break Handling**: Converts newlines to proper HTML breaks
- **Mixed Content**: Seamless integration of text and code
- **Performance**: Memoized parsing for efficient re-renders

### Content Processing
- **Code Blocks**: \`\`\`language\\ncode\`\`\` format support
- **Inline Code**: \`code\` format support
- **Text Formatting**: Newline to <br> conversion
- **Sequential Processing**: Maintains content order and structure

### Integration
- **CodeBlock Component**: For multi-line code display
- **InlineCode Component**: For short code snippets
- **Typography System**: Consistent text styling
- **Syntax Highlighting**: Language-specific highlighting

### Accessibility
- Semantic HTML structure
- Proper text flow and reading order
- Screen reader compatible
- High contrast support
- Keyboard navigation friendly

### Atom Guidelines
✓ **Do**: Use for text content with code formatting  
✓ **Do**: Maintain consistent typography  
✓ **Do**: Handle mixed content gracefully  
✓ **Do**: Use memoization for performance  
✗ **Don't**: Use for pure code content  
✗ **Don't**: Override text formatting  
✗ **Don't**: Mix with other text processors
        `,
      },
    },
  },
  argTypes: {
    content: {
      control: { type: 'text' },
      description: 'The text content to parse and render',
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
    content: 'This is a simple text message without any code formatting.',
  },
};

export const WithInlineCode: Story = {
  args: {
    content: 'You can use the `useState` hook to manage state in React components.',
  },
};

export const WithCodeBlock: Story = {
  args: {
    content: `Here's how to create a React component:

\`\`\`jsx
function MyComponent() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
\`\`\`

This component manages state using the useState hook.`,
  },
};

export const MixedContent: Story = {
  args: {
    content: `To install the package, run \`npm install react\` in your terminal.

Then create a new component:

\`\`\`javascript
import React, { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
\`\`\`

You can also use \`useEffect\` for side effects and \`useContext\` for context management.`,
  },
};

export const MultipleCodeBlocks: Story = {
  args: {
    content: `Here are examples in different languages:

JavaScript:
\`\`\`javascript
void ('Hello, World!');
\`\`\`

Python:
\`\`\`python
print('Hello, World!')
\`\`\`

HTML:
\`\`\`html
<div>Hello, World!</div>
\`\`\`

Each language has its own syntax highlighting.`,
  },
};

export const LongContent: Story = {
  args: {
    content: `This is a longer message that demonstrates how the MessageText component handles various types of content formatting.

First, let's talk about variables. In JavaScript, you can declare variables using \`const\`, \`let\`, or \`var\`. For example:

\`\`\`javascript
const name = 'Alice';
let age = 30;
var isActive = true;
\`\`\`

The \`const\` keyword creates a constant that cannot be reassigned, while \`let\` creates a block-scoped variable.

Now, let's look at a more complex example:

\`\`\`typescript
interface User {
  id: number;
  name: string;
  email: string;
}

function getUserById(id: number): User | null {
  // Implementation here
  return null;
}
\`\`\`

This TypeScript code defines an interface and a function that returns either a \`User\` object or \`null\`.

Remember to always validate your inputs and handle error cases appropriately!`,
  },
};

export const NoCodeContent: Story = {
  args: {
    content: `This is a message with no code formatting.

It has multiple paragraphs and line breaks.

Each paragraph should be properly spaced and formatted for readability.

The text should flow naturally without any special formatting.`,
  },
};

export const OnlyInlineCode: Story = {
  args: {
    content: 'Common JavaScript methods include `Array.map()`, `Array.filter()`, `Array.reduce()`, and `Object.keys()`.',
  },
};

export const OnlyCodeBlock: Story = {
  args: {
    content: `\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Generate first 10 Fibonacci numbers
for i in range(10):
    print(fibonacci(i))
\`\`\``,
  },
};

export const ComplexMixedContent: Story = {
  args: {
    content: `# Setting up a React Development Environment

First, make sure you have Node.js installed. You can check by running \`node --version\`.

## Creating a New Project

Use the following command to create a new React project:

\`\`\`bash
npx create-react-app my-app
cd my-app
npm start
\`\`\`

## Basic Component Structure

Here's a simple component example:

\`\`\`jsx
import React, { useState, useEffect } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId).then(userData => {
      setUser(userData);
      setLoading(false);
    });
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div className="user-profile">
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
\`\`\`

## Styling

You can style components using CSS modules or styled-components. For CSS modules, create a file with \`.module.css\` extension:

\`\`\`css
.userProfile {
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.userProfile h1 {
  margin-top: 0;
  color: #333;
}
\`\`\`

Remember to import the CSS module in your component: \`import styles from './UserProfile.module.css'\`

That's the basic setup! You can now start building your React application.`,
  },
};

export const ChatMessageExample: Story = {
  render: () => (
    <div className="max-w-2xl space-y-4">
      <div className="bg-base-200 p-4 rounded-lg">
        <div className="text-sm font-medium mb-2">Developer</div>
        <MessageText content="I'm having trouble with this React component. Can you help me debug it?" />
      </div>
      
      <div className="bg-primary/10 p-4 rounded-lg">
        <div className="text-sm font-medium mb-2">Assistant</div>
        <MessageText content={`I'd be happy to help! Can you share the component code? In the meantime, here's a common debugging approach:

1. Check the console for errors using \`void ()\`
2. Use React DevTools to inspect component state
3. Verify your props are being passed correctly

Here's a simple debugging template:

\`\`\`jsx
function MyComponent({ prop1, prop2 }) {
  void ('Props:', { prop1, prop2 });
  
  const [state, setState] = useState(initialValue);
  void ('Current state:', state);
  
  return (
    <div>
      {/* Your component JSX */}
    </div>
  );
}
\`\`\`

What specific error are you seeing?`} />
      </div>
      
      <div className="bg-base-200 p-4 rounded-lg">
        <div className="text-sm font-medium mb-2">Developer</div>
        <MessageText content={`Here's the component that's not working:

\`\`\`jsx
function UserList() {
  const [users, setUsers] = useState([]);
  
  useEffect(() => {
    fetchUsers().then(setUsers);
  }, []);
  
  return (
    <div>
      {users.map(user => (
        <div key={user.id}>{user.name}</div>
      ))}
    </div>
  );
}
\`\`\`

The error says "Cannot read property 'map' of undefined"`} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example of MessageText used in a chat interface with multiple message types.',
      },
    },
  },
};

export const InteractiveDemo: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6 w-full max-w-4xl">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">🎾 MessageText Tennis Commentary Demo</h3>
        <p className="text-sm text-gray-600 mb-4">
          Enable tennis commentary in the toolbar above, then hover and click the message content below!
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Simple Text Message</h4>
          <MessageText content="This is a simple message that demonstrates basic text rendering without any code formatting." />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">With Inline Code</h4>
          <MessageText content="You can use the `useState` hook to manage component state and `useEffect` for side effects." />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">With Code Block</h4>
          <MessageText content={`Here's a React component:

\`\`\`jsx
function Welcome({ name }) {
  return <h1>Hello, {name}!</h1>;
}
\`\`\`

Simple and clean!`} />
        </div>
        
        <div className="border rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors">
          <h4 className="font-medium mb-3">Mixed Content</h4>
          <MessageText content={`Install with \`npm install react\` then:

\`\`\`bash
npm start
\`\`\`

Your app will be running on \`localhost:3000\`!`} />
        </div>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">Content Processing Features:</h4>
        <ul className="text-sm space-y-1">
          <li>• <strong>Code Block Parsing</strong> - Extracts fenced code blocks with language detection</li>
          <li>• <strong>Inline Code Support</strong> - Handles backtick-wrapped inline code snippets</li>
          <li>• <strong>Mixed Content</strong> - Seamlessly integrates text and code formatting</li>
          <li>• <strong>Line Break Handling</strong> - Converts newlines to proper HTML breaks</li>
        </ul>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Interactive demo showcasing MessageText with tennis commentary. Enable commentary in the toolbar and interact with the content!',
      },
    },
  },
};