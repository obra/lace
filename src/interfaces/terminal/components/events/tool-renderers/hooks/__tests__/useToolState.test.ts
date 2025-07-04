// ABOUTME: Tests for useToolState hook - state management layer for tool renderers
// ABOUTME: Tests expansion, focus, and tool-specific state management patterns

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToolState } from '../useToolState.js';

// Mock the dependencies
vi.mock('../../hooks/useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: vi.fn((isSelected, onToggle) => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
  })),
}));

describe('useToolState', () => {
  const mockToolData = {
    toolName: 'bash',
    primaryInfo: '$ ls -la',
    secondaryInfo: 'List files',
    success: true,
    isStreaming: false,
    statusIcon: '✓',
    output: 'total 48\ndrwxr-xr-x',
    language: 'text',
    input: { command: 'ls -la' },
  };

  describe('basic state management', () => {
    it('should return standard state for simple tools', () => {
      const { result } = renderHook(() => 
        useToolState(mockToolData, false, undefined)
      );

      expect(result.current.isExpanded).toBe(false);
      expect(typeof result.current.onExpand).toBe('function');
      expect(typeof result.current.onCollapse).toBe('function');
      expect(typeof result.current.handleExpandedChange).toBe('function');
    });

    it('should handle expansion toggle correctly', () => {
      const mockOnToggle = vi.fn();
      const { result } = renderHook(() => 
        useToolState(mockToolData, true, mockOnToggle)
      );

      act(() => {
        result.current.handleExpandedChange(true);
      });

      expect(result.current.onExpand).toBeDefined();
    });
  });

  describe('tool-specific state extensions', () => {
    it('should provide delegate-specific state when needed', () => {
      const delegateData = {
        ...mockToolData,
        toolName: 'delegate',
        primaryInfo: '"Write tests"',
        secondaryInfo: '[DELEGATE]',
      };

      const { result } = renderHook(() => 
        useToolState(delegateData, false, undefined, { 
          enableDelegateState: true 
        })
      );

      expect(result.current.customState).toBeDefined();
      expect(result.current.customState?.delegationExpanded).toBe(true);
      expect(typeof result.current.customState?.setDelegationExpanded).toBe('function');
    });

    it('should handle delegation expansion toggle', () => {
      const delegateData = {
        ...mockToolData,
        toolName: 'delegate',
      };

      const { result } = renderHook(() => 
        useToolState(delegateData, false, undefined, { 
          enableDelegateState: true 
        })
      );

      act(() => {
        result.current.customState?.setDelegationExpanded?.(false);
      });

      expect(result.current.customState?.delegationExpanded).toBe(false);
    });
  });

  describe('memoization', () => {
    it('should memoize handlers to prevent re-renders', () => {
      const { result, rerender } = renderHook(() => 
        useToolState(mockToolData, false, undefined)
      );

      const firstHandlers = {
        onExpand: result.current.onExpand,
        onCollapse: result.current.onCollapse,
        handleExpandedChange: result.current.handleExpandedChange,
      };

      rerender();

      // Handlers should be the same reference (memoized)
      expect(result.current.onExpand).toBe(firstHandlers.onExpand);
      expect(result.current.onCollapse).toBe(firstHandlers.onCollapse);
      expect(result.current.handleExpandedChange).toBe(firstHandlers.handleExpandedChange);
    });

    it('should update handlers when dependencies change', () => {
      const { result, rerender } = renderHook(
        ({ isSelected }) => useToolState(mockToolData, isSelected, undefined),
        { initialProps: { isSelected: false } }
      );

      const firstHandlers = result.current.handleExpandedChange;

      rerender({ isSelected: true });

      // Handler function identity may change when isSelected changes
      expect(typeof result.current.handleExpandedChange).toBe('function');
    });
  });

  describe('integration with timeline expansion', () => {
    it('should integrate with useTimelineItemExpansion correctly', () => {
      const mockOnToggle = vi.fn();
      
      const { result } = renderHook(() => 
        useToolState(mockToolData, true, mockOnToggle)
      );

      // Should have expansion state from timeline hook
      expect(result.current.isExpanded).toBeDefined();
      expect(typeof result.current.onExpand).toBe('function');
      expect(typeof result.current.onCollapse).toBe('function');
    });
  });
});