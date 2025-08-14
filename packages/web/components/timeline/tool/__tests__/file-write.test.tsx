import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { fileWriteRenderer } from '@/components/timeline/tool/file-write';

describe('fileWriteRenderer', () => {
  it('provides a summary for path argument', () => {
    const summary = fileWriteRenderer.getSummary?.({ path: '/tmp/test.txt' });
    expect(summary).toBe('Write /tmp/test.txt');
  });

  it('detects error status', () => {
    const isErr = fileWriteRenderer.isError?.({ status: 'failed' } as any);
    expect(isErr).toBe(true);
  });

  it('renders a React node for success result', () => {
    const node = fileWriteRenderer.renderResult?.(
      { status: 'completed', content: [{ type: 'text', text: 'ok' }], metadata: {} } as any,
      { arguments: { path: '/tmp/test.txt', content: 'hello' } } as any
    );
    // Render the returned node to ensure it's valid React
    const { container } = render(<div>{node as React.ReactNode}</div>);
    expect(container.firstChild).toBeTruthy();
  });
});
