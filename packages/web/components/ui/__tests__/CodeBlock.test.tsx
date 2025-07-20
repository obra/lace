// ABOUTME: Tests for the CodeBlock component
// ABOUTME: Tests rendering, syntax highlighting, and user interactions

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CodeBlock from '../CodeBlock';

// Mock the syntax highlighting service
vi.mock('~/lib/syntax-highlighting', () => ({
  syntaxHighlighting: {
    initialize: vi.fn().mockResolvedValue(undefined),
    highlightCode: vi.fn().mockResolvedValue({
      highlighted: '<span class="hljs-string">console.log("test");</span>',
      language: 'javascript',
      success: true,
    }),
    highlightLargeCode: vi.fn().mockResolvedValue({
      highlighted: '<span class="hljs-string">large code</span>',
      language: 'javascript',
      success: true,
    }),
  },
}));

// Mock the theme manager
vi.mock('~/lib/syntax-themes', () => ({
  syntaxThemeManager: {
    autoLoadTheme: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock performance utils
vi.mock('~/lib/performance-utils', () => ({
  debounce: vi.fn((fn) => fn),
  isCodeTooLarge: vi.fn().mockReturnValue(false),
}));

// Mock FontAwesome icons
vi.mock('~/lib/fontawesome', () => ({
  faCopy: 'copy-icon',
  faCheck: 'check-icon',
  faExpand: 'expand-icon',
  faCompress: 'compress-icon',
}));

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render code block with basic props', async () => {
    render(
      <CodeBlock
        code="console.log('Hello, world!');"
        language="javascript"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('javascript')).toBeInTheDocument();
    });
  });

  it('should show language label when enabled', async () => {
    render(
      <CodeBlock
        code="print('Hello, world!')"
        language="python"
        showLanguageLabel={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('python')).toBeInTheDocument();
    });
  });

  it('should show filename when provided', async () => {
    render(
      <CodeBlock
        code="console.log('test');"
        language="javascript"
        filename="script.js"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('script.js')).toBeInTheDocument();
    });
  });

  it('should show copy button when enabled', async () => {
    render(
      <CodeBlock
        code="test code"
        showCopyButton={true}
      />
    );

    await waitFor(() => {
      const copyButton = screen.getByTitle('Copy code');
      expect(copyButton).toBeInTheDocument();
    });
  });

  it('should handle copy button click', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <CodeBlock
        code="test code"
        showCopyButton={true}
      />
    );

    await waitFor(() => {
      const copyButton = screen.getByTitle('Copy code');
      fireEvent.click(copyButton);
    });

    expect(mockWriteText).toHaveBeenCalledWith('test code');
  });

  it('should call custom onCopy handler', async () => {
    const onCopy = vi.fn();

    render(
      <CodeBlock
        code="test code"
        showCopyButton={true}
        onCopy={onCopy}
      />
    );

    await waitFor(() => {
      const copyButton = screen.getByTitle('Copy code');
      fireEvent.click(copyButton);
    });

    expect(onCopy).toHaveBeenCalledWith('test code');
  });

  it('should show loading state', () => {
    render(
      <CodeBlock
        code="console.log('test');"
        language="javascript"
      />
    );

    expect(screen.getByText('Highlighting code...')).toBeInTheDocument();
  });

  it('should handle collapsible functionality', async () => {
    render(
      <CodeBlock
        code="test code"
        collapsible={true}
        collapsed={true}
      />
    );

    // Should be collapsed initially
    expect(screen.queryByText('test code')).not.toBeInTheDocument();

    // Click expand button
    const expandButton = screen.getByTitle('Expand');
    fireEvent.click(expandButton);

    // Should show content after expanding
    await waitFor(() => {
      expect(screen.getByText('test code')).toBeInTheDocument();
    });
  });

  it('should show line numbers when enabled', async () => {
    render(
      <CodeBlock
        code="line1\nline2\nline3"
        showLineNumbers={true}
      />
    );

    await waitFor(() => {
      // Line numbers should be rendered
      const codeContent = screen.getByRole('code');
      expect(codeContent).toBeInTheDocument();
    });
  });

  it('should handle empty code', async () => {
    render(<CodeBlock code="" />);

    await waitFor(() => {
      expect(screen.queryByText('Highlighting code...')).not.toBeInTheDocument();
    });
  });

  it('should handle highlighting errors gracefully', async () => {
    const { syntaxHighlighting } = await import('~/lib/syntax-highlighting');
    
    // Mock error
    vi.mocked(syntaxHighlighting.highlightCode).mockRejectedValueOnce(
      new Error('Highlighting failed')
    );

    render(
      <CodeBlock
        code="invalid code"
        language="javascript"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to highlight code/)).toBeInTheDocument();
    });
  });

  it('should apply custom className', () => {
    render(
      <CodeBlock
        code="test"
        className="custom-class"
      />
    );

    const codeBlock = screen.getByRole('region');
    expect(codeBlock).toHaveClass('custom-class');
  });

  it('should respect maxHeight prop', () => {
    render(
      <CodeBlock
        code="test"
        maxHeight="200px"
      />
    );

    const codeContent = screen.getByRole('region').querySelector('.code-block-content');
    expect(codeContent).toHaveStyle({ maxHeight: '200px' });
  });

  it('should show header when enabled', async () => {
    render(
      <CodeBlock
        code="test code"
        language="javascript"
        showHeader={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('javascript')).toBeInTheDocument();
    });
  });

  it('should hide header when disabled', async () => {
    render(
      <CodeBlock
        code="test code"
        language="javascript"
        showHeader={false}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText('javascript')).not.toBeInTheDocument();
    });
  });

  it('should handle JSON formatting', async () => {
    const { syntaxHighlighting } = await import('~/lib/syntax-highlighting');
    
    // Mock JSON highlighting
    vi.mocked(syntaxHighlighting.highlightCode).mockResolvedValueOnce({
      highlighted: '{\n  "name": "test",\n  "value": 42\n}',
      language: 'json',
      success: true,
    });

    render(
      <CodeBlock
        code='{"name":"test","value":42}'
        language="json"
      />
    );

    await waitFor(() => {
      expect(syntaxHighlighting.highlightCode).toHaveBeenCalledWith(
        '{\n  "name": "test",\n  "value": 42\n}',
        'json',
        undefined
      );
    });
  });

  it('should show check icon after successful copy', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <CodeBlock
        code="test code"
        showCopyButton={true}
      />
    );

    await waitFor(() => {
      const copyButton = screen.getByTitle('Copy code');
      fireEvent.click(copyButton);
    });

    // Should show check icon briefly
    await waitFor(() => {
      expect(screen.getByLabelText('check-icon')).toBeInTheDocument();
    });
  });
});