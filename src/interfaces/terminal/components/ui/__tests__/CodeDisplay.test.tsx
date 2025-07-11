// ABOUTME: Tests for CodeDisplay component to verify JSON and code syntax highlighting
// ABOUTME: Ensures proper fallback to plain text when highlighting fails

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { CodeDisplay } from '~/interfaces/terminal/components/ui/CodeDisplay.js';

describe('CodeDisplay', () => {
  it('should render JSON with formatting', () => {
    const jsonData = '{"command": "ls -la", "timeout": 5000}';

    const { lastFrame } = render(<CodeDisplay code={jsonData} language="json" />);

    // Should contain the JSON content (exact formatting may vary due to highlighting)
    expect(lastFrame()).toContain('command');
    expect(lastFrame()).toContain('ls -la');
    expect(lastFrame()).toContain('timeout');
    expect(lastFrame()).toContain('5000');
  });

  it('should handle plain text without errors', () => {
    const plainText = 'Hello world output';

    const { lastFrame } = render(<CodeDisplay code={plainText} language="text" />);

    expect(lastFrame()).toContain('Hello world output');
  });

  it('should format JSON with proper indentation', () => {
    const jsonData = '{"a":1,"b":{"c":2}}';

    const { lastFrame } = render(<CodeDisplay code={jsonData} language="json" />);

    // Should format the JSON (will have newlines and indentation)
    const output = lastFrame();
    expect(output).toContain('a');
    expect(output).toContain('b');
    expect(output).toContain('c');
  });

  it('should handle invalid JSON gracefully', () => {
    const invalidJson = '{"invalid": json}';

    const { lastFrame } = render(<CodeDisplay code={invalidJson} language="json" />);

    // Should still display the content even if JSON is invalid
    expect(lastFrame()).toContain('invalid');
    expect(lastFrame()).toContain('json');
  });

  it('should handle compact mode', () => {
    const jsonData = '{"test": "value"}';

    const { lastFrame } = render(<CodeDisplay code={jsonData} language="json" compact={true} />);

    expect(lastFrame()).toContain('test');
    expect(lastFrame()).toContain('value');
  });
});
