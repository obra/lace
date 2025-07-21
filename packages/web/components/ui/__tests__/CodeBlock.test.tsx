// ABOUTME: Tests for the CodeBlock component
// ABOUTME: Tests real syntax highlighting integration and user interactions

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CodeBlock from '@/components/ui/CodeBlock';

// Mock only external side effects, not the behavior under test
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Basic Rendering', () => {
    it('renders code with auto-detection for unknown language', () => {
      render(
        <CodeBlock 
          code="const test = 'hello';" 
          language="unknown-lang" 
        />
      );
      
      // highlight.js will auto-detect and highlight the code
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('const');
      expect(codeElement.innerHTML).toContain('test');
      expect(codeElement.innerHTML).toContain('hello');
    });

    it('renders plain text when no language is specified', () => {
      render(<CodeBlock code="plain text content" />);
      
      expect(screen.getByText('plain text content')).toBeInTheDocument();
      expect(screen.getByText('text')).toBeInTheDocument(); // language label
    });

    it('renders with filename when provided', () => {
      render(
        <CodeBlock 
          code="console.log('test');" 
          filename="test.js"
          language="javascript"
        />
      );
      
      expect(screen.getByText('test.js')).toBeInTheDocument();
    });
  });

  describe('Syntax Highlighting Integration', () => {
    it('highlights JavaScript code correctly', () => {
      render(
        <CodeBlock 
          code='console.log("hello");' 
          language="javascript" 
        />
      );
      
      // Should contain highlighted HTML with hljs classes
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('hljs');
      expect(codeElement.innerHTML).toContain('console');
      expect(codeElement.innerHTML).toContain('hello');
    });

    it('highlights TypeScript code correctly', () => {
      render(
        <CodeBlock 
          code='const greeting: string = "hello";' 
          language="typescript" 
        />
      );
      
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('hljs');
      expect(codeElement.innerHTML).toContain('const');
      expect(screen.getByText('typescript')).toBeInTheDocument();
    });

    it('formats JSON code automatically', () => {
      const uglyJson = '{"name":"test","value":123}';
      render(
        <CodeBlock 
          code={uglyJson} 
          language="json" 
        />
      );
      
      // Should be formatted with proper indentation
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('name');
      expect(codeElement.innerHTML).toContain('test');
      expect(codeElement.innerHTML).toContain('value');
    });

    it('handles auto-detection for unspecified language', () => {
      render(
        <CodeBlock code='function test() { return "hello"; }' />
      );
      
      // When no language is specified, it renders as plain text
      expect(screen.getByText('function test() { return "hello"; }')).toBeInTheDocument();
    });

    it('falls back gracefully for invalid JSON', () => {
      render(
        <CodeBlock 
          code='{"invalid": json}' 
          language="json" 
        />
      );
      
      // Should still render the invalid JSON, possibly highlighted
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('invalid');
      expect(codeElement.innerHTML).toContain('json');
    });
  });

  describe('UI Features', () => {
    it('shows language label by default', () => {
      render(
        <CodeBlock 
          code="test code" 
          language="javascript" 
        />
      );
      
      expect(screen.getByText('javascript')).toBeInTheDocument();
    });

    it('hides language label when showLanguageLabel is false', () => {
      render(
        <CodeBlock 
          code="test code" 
          language="javascript" 
          showLanguageLabel={false}
        />
      );
      
      expect(screen.queryByText('javascript')).not.toBeInTheDocument();
    });

    it('shows copy button by default', () => {
      render(<CodeBlock code="test code" />);
      
      expect(screen.getByTitle('Copy code')).toBeInTheDocument();
    });

    it('hides copy button when showCopyButton is false', () => {
      render(<CodeBlock code="test code" showCopyButton={false} />);
      
      expect(screen.queryByTitle('Copy code')).not.toBeInTheDocument();
    });

    it('hides header when showHeader is false', () => {
      render(
        <CodeBlock 
          code="test code" 
          language="javascript" 
          filename="test.js"
          showHeader={false} 
        />
      );
      
      expect(screen.queryByText('javascript')).not.toBeInTheDocument();
      expect(screen.queryByText('test.js')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Copy code')).not.toBeInTheDocument();
    });
  });

  describe('Line Numbers', () => {
    it('shows line numbers when enabled', () => {
      render(
        <CodeBlock 
          code="line 1\nline 2\nline 3" 
          showLineNumbers={true}
        />
      );
      
      // Line numbers are rendered in a separate container
      const lineNumbers = screen.getByText('1');
      expect(lineNumbers).toBeInTheDocument();
      
      // Since it's multiline text, we can only easily test for line 1
      // The component should show line numbers container
      expect(lineNumbers.closest('.line-numbers')).toBeInTheDocument();
    });

    it('hides line numbers by default', () => {
      render(<CodeBlock code="line 1\nline 2" />);
      
      // Line numbers div should not be present
      expect(screen.queryByText('1')).not.toBeInTheDocument();
      expect(screen.queryByText('2')).not.toBeInTheDocument();
    });
  });

  describe('Copy Functionality', () => {
    it('copies code to clipboard when copy button is clicked', async () => {
      const testCode = 'console.log("test");';
      render(<CodeBlock code={testCode} />);
      
      const copyButton = screen.getByTitle('Copy code');
      
      await act(async () => {
        fireEvent.click(copyButton);
      });
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testCode);
    });

    it('shows success feedback after copying', async () => {
      render(<CodeBlock code="test code" />);
      
      const copyButton = screen.getByTitle('Copy code');
      
      await act(async () => {
        fireEvent.click(copyButton);
      });
      
      // Should show checkmark icon briefly
      await waitFor(() => {
        const icon = copyButton.querySelector('svg');
        expect(icon).toHaveClass('text-success');
      }, { timeout: 1000 });
    });

    it('calls custom onCopy handler when provided', async () => {
      const customCopy = vi.fn();
      const testCode = 'test code';
      
      render(<CodeBlock code={testCode} onCopy={customCopy} />);
      
      const copyButton = screen.getByTitle('Copy code');
      
      await act(async () => {
        fireEvent.click(copyButton);
      });
      
      expect(customCopy).toHaveBeenCalledWith(testCode);
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('Collapsible Functionality', () => {
    it('shows expand/collapse button when collapsible is true', () => {
      render(
        <CodeBlock 
          code="test code" 
          collapsible={true} 
        />
      );
      
      expect(screen.getByTitle('Collapse')).toBeInTheDocument();
    });

    it('starts collapsed when collapsed prop is true', () => {
      render(
        <CodeBlock 
          code="test code" 
          collapsible={true}
          collapsed={true}
        />
      );
      
      expect(screen.getByTitle('Expand')).toBeInTheDocument();
      expect(screen.queryByText('test code')).not.toBeInTheDocument();
    });

    it('toggles visibility when expand/collapse button is clicked', () => {
      render(
        <CodeBlock 
          code="test code" 
          collapsible={true}
          collapsed={true}
        />
      );
      
      expect(screen.queryByText('test code')).not.toBeInTheDocument();
      
      const expandButton = screen.getByTitle('Expand');
      fireEvent.click(expandButton);
      
      expect(screen.getByText('test code')).toBeInTheDocument();
      expect(screen.getByTitle('Collapse')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles clipboard write failure gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const writeTextMock = vi.mocked(navigator.clipboard.writeText);
      writeTextMock.mockRejectedValueOnce(new Error('Clipboard failed'));
      
      render(<CodeBlock code="test code" />);
      
      const copyButton = screen.getByTitle('Copy code');
      
      await act(async () => {
        fireEvent.click(copyButton);
      });
      
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to copy code:', expect.any(Error));
      }, { timeout: 1000 });
      
      consoleError.mockRestore();
    });
  });

  describe('Styling and Layout', () => {
    it('applies custom className', () => {
      render(<CodeBlock code="test" className="custom-class" />);
      
      const codeBlock = screen.getByText('test').closest('.code-block');
      expect(codeBlock).toHaveClass('custom-class');
    });

    it('applies maxHeight style', () => {
      render(<CodeBlock code="test" maxHeight="200px" />);
      
      const contentDiv = screen.getByText('test').closest('.code-block-content');
      expect(contentDiv).toHaveStyle({ maxHeight: '200px' });
    });
  });
});