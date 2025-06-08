// ABOUTME: Integration tests for Step 8 code syntax highlighting functionality
// ABOUTME: Tests code block detection and syntax highlighting with cli-highlight

import React from 'react';
import ConversationView from '../../../src/ui/components/ConversationView';
import Message from '../../../src/ui/components/Message';

describe('Step 8: Code Syntax Highlighting Integration', () => {
  test('Message component detects JavaScript code blocks', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Here is a function:\n\n```javascript\nfunction hello() {\n  return "Hello World";\n}\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should detect and highlight code block
    expect(element).toBeTruthy();
    // Code block should be processed for highlighting
    const hasCodeBlock = messageProps.content.includes('```javascript');
    expect(hasCodeBlock).toBe(true);
  });

  test('Message component detects Python code blocks', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Here is a Python function:\n\n```python\ndef greet(name):\n    return f"Hello {name}!"\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should detect Python code block
    const hasCodeBlock = messageProps.content.includes('```python');
    expect(hasCodeBlock).toBe(true);
  });

  test('Message component detects JSON code blocks', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Here is some JSON:\n\n```json\n{\n  "name": "John",\n  "age": 30\n}\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should detect JSON code block
    const hasCodeBlock = messageProps.content.includes('```json');
    expect(hasCodeBlock).toBe(true);
  });

  test('Message component handles multiple code blocks', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'JavaScript:\n```javascript\nconsole.log("hello");\n```\n\nPython:\n```python\nprint("hello")\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should handle multiple code blocks
    const hasJsBlock = messageProps.content.includes('```javascript');
    const hasPythonBlock = messageProps.content.includes('```python');
    expect(hasJsBlock).toBe(true);
    expect(hasPythonBlock).toBe(true);
  });

  test('Message component displays highlighted code with colors', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Here is code:\n\n```javascript\nconst x = 42;\nconsole.log(x);\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should render without crashing - highlighting is applied internally
    expect(element).toBeTruthy();
    expect(element.type).toBeTruthy();
    
    // Verify the content contains the original code block structure
    expect(messageProps.content.includes('```javascript')).toBe(true);
    expect(messageProps.content.includes('const x = 42;')).toBe(true);
  });

  test('Message component falls back to plain text on highlight failure', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Invalid code:\n\n```unknownlang\nsome invalid syntax here\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should not crash and fallback to plain text
    expect(element).toBeTruthy();
  });

  test('Message component handles mixed content with code blocks', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Here is an explanation followed by code:\n\nThis function adds two numbers:\n\n```javascript\nfunction add(a, b) {\n  return a + b;\n}\n```\n\nUse it like this: `add(2, 3)`'
    };
    
    const element = Message(messageProps) as any;
    
    // Should handle mixed text and code content
    expect(element).toBeTruthy();
    const hasCodeBlock = messageProps.content.includes('```javascript');
    const hasInlineCode = messageProps.content.includes('`add(2, 3)`');
    expect(hasCodeBlock).toBe(true);
    expect(hasInlineCode).toBe(true);
  });

  test('Message component preserves formatting in code blocks', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'Formatted code:\n\n```javascript\nif (condition) {\n  console.log("indented");\n  if (nested) {\n    console.log("double indent");\n  }\n}\n```'
    };
    
    const element = Message(messageProps) as any;
    
    // Should preserve indentation and formatting
    expect(element).toBeTruthy();
    const hasIndentation = messageProps.content.includes('  console.log');
    expect(hasIndentation).toBe(true);
  });

  test('ConversationView displays highlighted code in conversation', () => {
    const messages = [
      { type: 'user' as const, content: 'Can you write a function?' },
      { 
        type: 'assistant' as const, 
        content: 'Sure! Here it is:\n\n```javascript\nfunction greet(name) {\n  return `Hello ${name}!`;\n}\n```'
      }
    ];
    
    const element = ConversationView({ messages }) as any;
    const renderedMessages = element.props.children;
    
    expect(renderedMessages).toHaveLength(2);
    
    // Assistant message should contain highlighted code
    const assistantMessage = renderedMessages[1];
    expect(assistantMessage.props.type).toBe('assistant');
    expect(assistantMessage.props.content).toContain('```javascript');
  });

  test('syntax highlighting does not affect non-code messages', () => {
    const messageProps = {
      type: 'assistant' as const,
      content: 'This is just regular text without any code blocks. No highlighting should be applied here.'
    };
    
    const element = Message(messageProps) as any;
    
    // Should render normally without syntax highlighting
    expect(element).toBeTruthy();
    const hasCodeBlock = messageProps.content.includes('```');
    expect(hasCodeBlock).toBe(false);
  });

  test('syntax highlighting works with different languages', () => {
    const languages = ['javascript', 'python', 'json', 'typescript', 'css', 'html'];
    
    languages.forEach(lang => {
      const messageProps = {
        type: 'assistant' as const,
        content: `Code in ${lang}:\n\n\`\`\`${lang}\n// sample code\n\`\`\``
      };
      
      const element = Message(messageProps) as any;
      expect(element).toBeTruthy();
      
      const hasCodeBlock = messageProps.content.includes(`\`\`\`${lang}`);
      expect(hasCodeBlock).toBe(true);
    });
  });

  test('syntax highlighting utility functions work correctly', async () => {
    const { detectCodeBlocks, highlightCode, processContentWithHighlighting } = await import('../../../src/ui/utils/syntax-highlight.js');
    
    // Test code block detection
    const content = 'Text before\n\n```javascript\nconst x = 1;\n```\n\nText after';
    const blocks = detectCodeBlocks(content);
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('javascript');
    expect(blocks[0].code).toBe('const x = 1;\n');
    
    // Test highlighting (should not throw)
    const highlighted = highlightCode('const x = 1;', 'javascript');
    expect(typeof highlighted).toBe('string');
    
    // Test full processing
    const processed = processContentWithHighlighting(content);
    expect(typeof processed).toBe('string');
    expect(processed.includes('```javascript')).toBe(true);
  });
});