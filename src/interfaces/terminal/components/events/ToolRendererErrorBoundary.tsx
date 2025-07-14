// ABOUTME: Error boundary for dynamic tool renderer loading with fallback to GenericToolRenderer
// ABOUTME: Prevents dynamic renderer failures from crashing the entire timeline

import React, { Component, ReactNode } from 'react';
import { GenericToolRenderer } from './tool-renderers/GenericToolRenderer.js';
import { Timeline } from '../../../timeline-types.js';

interface ToolRendererErrorBoundaryProps {
  children: ReactNode;
  item: Extract<Timeline['items'][0], { type: 'tool_execution' }>;
  isSelected: boolean;
  onToggle?: () => void;
}

interface ToolRendererErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ToolRendererErrorBoundary extends Component<
  ToolRendererErrorBoundaryProps,
  ToolRendererErrorBoundaryState
> {
  constructor(props: ToolRendererErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ToolRendererErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Use proper logging if available
    console.error('Tool renderer error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Fallback to GenericToolRenderer with error information
      const errorItem = {
        ...this.props.item,
        call: {
          ...this.props.item.call,
          arguments: {
            ...this.props.item.call.arguments,
            _error: `Renderer failed: ${this.state.error?.message || 'Unknown error'}`,
          },
        },
      };

      return <GenericToolRenderer item={errorItem} />;
    }

    return this.props.children;
  }
}
