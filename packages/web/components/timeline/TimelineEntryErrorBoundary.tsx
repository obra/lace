// ABOUTME: Error boundary component for individual timeline entries
// ABOUTME: Displays event JSON as fallback when timeline rendering fails

'use client';

import React, { Component, ReactNode } from 'react';
import type { ProcessedEvent } from '@/hooks/useProcessedEvents';
import CodeBlock from '@/components/ui/CodeBlock';
import { safeStringify } from '@/lib/utils/safeStringify';

interface Props {
  children: ReactNode;
  event: ProcessedEvent;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class TimelineEntryErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Timeline entry rendering error', {
      error: safeStringify(error),
      errorInfo: safeStringify(errorInfo),
      event: safeStringify(this.props.event),
    });
  }

  render() {
    if (this.state.hasError) {
      const { event } = this.props;

      // Display the raw event as JSON in a code block
      return (
        <div className="bg-error/10 border border-error/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-error text-sm font-semibold">Error rendering event</span>
            <span className="text-xs text-base-content/60">
              {this.state.error?.message || 'Unknown error'}
            </span>
          </div>
          <div className="mt-3">
            <CodeBlock
              code={JSON.stringify(event, null, 2)}
              language="json"
              showLineNumbers={false}
              showHeader={true}
              maxHeight="300px"
            />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
