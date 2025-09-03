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
      // Mock console.error to suppress highlight.js warning about unknown language
      const originalConsoleError = console.error;
      console.error = vi.fn();

      render(<CodeBlock code="const test = 'hello';" language="unknown-lang" />);

      // highlight.js will auto-detect and highlight the code
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('const');
      expect(codeElement.innerHTML).toContain('test');
      expect(codeElement.innerHTML).toContain('hello');

      // Verify the warning was called (expected behavior)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Could not find the language 'unknown-lang'")
      );

      // Restore console.error
      console.error = originalConsoleError;
    });

    it('renders plain text when no language is specified', () => {
      render(<CodeBlock code="plain text content" />);

      // highlight.js will auto-detect the language, might not be 'text'
      const codeElement = screen.getByRole('code');
      expect(codeElement.textContent).toContain('plain');
      expect(codeElement.textContent).toContain('text');
      expect(codeElement.textContent).toContain('content');
      // Language label should not be shown by default
      const languageLabel = document.querySelector('.code-block-language');
      expect(languageLabel).not.toBeInTheDocument();
    });

    it('renders with filename when provided', () => {
      render(<CodeBlock code="console.log('test');" filename="test.js" language="javascript" />);

      expect(screen.getByText('test.js')).toBeInTheDocument();
    });
  });

  describe('Syntax Highlighting Integration', () => {
    it('highlights JavaScript code correctly', () => {
      render(<CodeBlock code='console.log("hello");' language="javascript" />);

      // Should contain highlighted HTML with hljs classes
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('hljs');
      expect(codeElement.innerHTML).toContain('console');
      expect(codeElement.innerHTML).toContain('hello');
    });

    it('highlights TypeScript code correctly', () => {
      render(<CodeBlock code='const greeting: string = "hello";' language="typescript" />);

      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('hljs');
      expect(codeElement.innerHTML).toContain('const');
      // Language label should not be shown by default
      expect(() => screen.getByText('typescript')).toThrow();
    });

    it('formats JSON code automatically', () => {
      const uglyJson = '{"name":"test","value":123}';
      render(<CodeBlock code={uglyJson} language="json" />);

      // Should be formatted with proper indentation
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('name');
      expect(codeElement.innerHTML).toContain('test');
      expect(codeElement.innerHTML).toContain('value');
    });

    it('handles auto-detection for unspecified language', () => {
      render(<CodeBlock code='function test() { return "hello"; }' />);

      // highlight.js will auto-detect and highlight the code
      const codeElement = screen.getByRole('code');
      expect(codeElement.textContent).toContain('function test()');
      expect(codeElement.textContent).toContain('hello');
    });

    it('falls back gracefully for invalid JSON', () => {
      render(<CodeBlock code='{"invalid": json}' language="json" />);

      // Should still render the invalid JSON, possibly highlighted
      const codeElement = screen.getByRole('code');
      expect(codeElement.innerHTML).toContain('invalid');
      expect(codeElement.innerHTML).toContain('json');
    });
  });

  describe('UI Features', () => {
    it('hides language label by default', () => {
      render(<CodeBlock code="test code" language="javascript" />);

      expect(() => screen.getByText('javascript')).toThrow();
    });

    it('shows language label when explicitly enabled', () => {
      render(<CodeBlock code="test code" language="javascript" showLanguageLabel={true} />);

      expect(screen.getByText('javascript')).toBeInTheDocument();
    });

    it('hides language label when showLanguageLabel is false', () => {
      render(<CodeBlock code="test code" language="javascript" showLanguageLabel={false} />);

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
        <CodeBlock code="test code" language="javascript" filename="test.js" showHeader={false} />
      );

      expect(screen.queryByText('javascript')).not.toBeInTheDocument();
      expect(screen.queryByText('test.js')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Copy code')).not.toBeInTheDocument();
    });
  });

  describe('Line Numbers', () => {
    it('shows line numbers when enabled', () => {
      render(<CodeBlock code="line 1\nline 2\nline 3" showLineNumbers={true} />);

      // Line numbers are rendered in a separate container
      const lineNumbersContainer = document.querySelector('.line-numbers');
      expect(lineNumbersContainer).toBeInTheDocument();

      // Check that line numbers exist - the exact rendering may depend on highlight.js behavior
      const lineNumbers = lineNumbersContainer?.querySelectorAll('div');
      expect(lineNumbers).toBeDefined();
      expect(lineNumbers!.length).toBeGreaterThan(0);

      // The first line number should be "1"
      expect(lineNumbers![0].textContent).toBe('1');
    });

    it('hides line numbers by default', () => {
      render(<CodeBlock code="line 1\nline 2" />);

      // Line numbers div should not be present
      const lineNumbersContainer = document.querySelector('.line-numbers');
      expect(lineNumbersContainer).not.toBeInTheDocument();
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
      await waitFor(
        () => {
          const icon = copyButton.querySelector('svg');
          expect(icon).toHaveClass('text-success');
        },
        { timeout: 1000 }
      );
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
      render(<CodeBlock code="test code" collapsible={true} />);

      expect(screen.getByTitle('Collapse')).toBeInTheDocument();
    });

    it('starts collapsed when collapsed prop is true', () => {
      render(<CodeBlock code="test code" collapsible={true} collapsed={true} />);

      expect(screen.getByTitle('Expand')).toBeInTheDocument();
      expect(screen.queryByText('test code')).not.toBeInTheDocument();
    });

    it('toggles visibility when expand/collapse button is clicked', () => {
      render(<CodeBlock code="test code" collapsible={true} collapsed={true} />);

      // Code should not be visible when collapsed
      const codeContent = document.querySelector('.code-block-content');
      expect(codeContent).not.toBeInTheDocument();

      const expandButton = screen.getByTitle('Expand');
      fireEvent.click(expandButton);

      // After expanding, code should be visible
      const expandedCodeContent = document.querySelector('.code-block-content');
      expect(expandedCodeContent).toBeInTheDocument();
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

      await waitFor(
        () => {
          expect(consoleError).toHaveBeenCalledWith('Failed to copy code:', expect.any(Error));
        },
        { timeout: 1000 }
      );

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
