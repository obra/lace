// ABOUTME: Integration tests for code syntax highlighting functionality
// ABOUTME: Tests user-observable code formatting and display behavior

import React from "react";
import { render } from "ink-testing-library";
import ConversationView from "@/ui/components/ConversationView";
import Message from "@/ui/components/Message";

describe("Code Highlighting Integration", () => {
  test("user can read JavaScript code with proper formatting", () => {
    const codeContent = 'Here is a function:\n\n```javascript\nfunction hello() {\n  return "Hello World";\n}\n```';
    
    const { lastFrame } = render(
      <Message type="assistant" content={codeContent} />
    );

    const output = lastFrame();
    
    // User should see the code content
    expect(output).toContain("function hello()");
    expect(output).toContain('return "Hello World"');
    expect(output).toContain("Here is a function:");
  });

  test("user can read Python code with proper formatting", () => {
    const pythonContent = 'Here is a Python function:\n\n```python\ndef greet(name):\n    return f"Hello {name}!"\n```';
    
    const { lastFrame } = render(
      <Message type="assistant" content={pythonContent} />
    );

    const output = lastFrame();
    
    // User should see the Python code content
    expect(output).toContain("def greet(name):");
    expect(output).toContain('return f"Hello {name}!"');
    expect(output).toContain("Here is a Python function:");
  });

  test("user can read JSON data with proper formatting", () => {
    const jsonContent = 'Here is some JSON:\n\n```json\n{\n  "name": "John",\n  "age": 30\n}\n```';
    
    const { lastFrame } = render(
      <Message type="assistant" content={jsonContent} />
    );

    const output = lastFrame();
    
    // User should see the JSON content
    expect(output).toContain('"name": "John"');
    expect(output).toContain('"age": 30');
    expect(output).toContain("Here is some JSON:");
  });

  test("user can read code without language specification", () => {
    const genericCodeContent = 'Here is some code:\n\n```\nif (condition) {\n  doSomething();\n}\n```';
    
    const { lastFrame } = render(
      <Message type="assistant" content={genericCodeContent} />
    );

    const output = lastFrame();
    
    // User should see the code even without language specification
    expect(output).toContain("if (condition) {");
    expect(output).toContain("doSomething();");
    expect(output).toContain("Here is some code:");
  });

  test("user can read mixed content with code and text", () => {
    const mixedContent = `Let me explain the solution:

First, we need a helper function:

\`\`\`javascript
function calculateSum(a, b) {
  return a + b;
}
\`\`\`

Then we can use it like this:

\`\`\`javascript
const result = calculateSum(5, 10);
console.log(result); // 15
\`\`\`

This approach is efficient because it separates concerns.`;

    const { lastFrame } = render(
      <Message type="assistant" content={mixedContent} />
    );

    const output = lastFrame();
    
    // User should see all parts of the mixed content
    expect(output).toContain("Let me explain the solution:");
    expect(output).toContain("function calculateSum(a, b)");
    expect(output).toContain("return a + b;");
    expect(output).toContain("const result = calculateSum(5, 10);");
    expect(output).toContain("console.log(result);");
    expect(output).toContain("This approach is efficient");
  });

  test("user can read multiple code blocks in conversation", () => {
    const messages = [
      { 
        type: "user" as const, 
        content: "Show me how to write a function in both JavaScript and Python" 
      },
      {
        type: "assistant" as const,
        content: `Here's JavaScript:\n\n\`\`\`javascript\nfunction greet(name) {\n  return \`Hello \${name}!\`;\n}\n\`\`\``
      },
      {
        type: "assistant" as const,
        content: `And here's Python:\n\n\`\`\`python\ndef greet(name):\n    return f"Hello {name}!"\n\`\`\``
      }
    ];

    const { lastFrame } = render(<ConversationView messages={messages} />);
    const output = lastFrame();

    // User should see both code examples
    expect(output).toContain("function greet(name)");
    expect(output).toContain("def greet(name):");
    expect(output).toContain("Show me how to write a function");
  });

  test("user can read inline code snippets", () => {
    const inlineCodeContent = "You can use the `console.log()` function to debug, or try `JSON.stringify()` for objects.";
    
    const { lastFrame } = render(
      <Message type="assistant" content={inlineCodeContent} />
    );

    const output = lastFrame();
    
    // User should see inline code preserved
    expect(output).toContain("console.log()");
    expect(output).toContain("JSON.stringify()");
    expect(output).toContain("You can use the");
  });

  test("user can read complex code with multiple languages in one message", () => {
    const complexContent = `Here's a full stack example:

Frontend (JavaScript):
\`\`\`javascript
fetch('/api/users')
  .then(response => response.json())
  .then(users => console.log(users));
\`\`\`

Backend (Python):
\`\`\`python
@app.route('/api/users')
def get_users():
    return jsonify(users)
\`\`\`

Database (SQL):
\`\`\`sql
SELECT * FROM users WHERE active = 1;
\`\`\``;

    const { lastFrame } = render(
      <Message type="assistant" content={complexContent} />
    );

    const output = lastFrame();
    
    // User should see all three code blocks
    expect(output).toContain("fetch('/api/users')");
    expect(output).toContain("@app.route('/api/users')");
    expect(output).toContain("SELECT * FROM users");
    expect(output).toContain("Here's a full stack example:");
  });
});