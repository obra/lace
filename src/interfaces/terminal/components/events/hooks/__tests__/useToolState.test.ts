// ABOUTME: Tests for useToolState hook ensuring proper state management for tool renderers
// ABOUTME: Validates expansion state integration and custom state management functionality

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToolState } from '../useToolState.js';
import { ToolData } from '../useToolData.js';

// Mock the timeline expansion hook
const mockOnExpand = vi.fn();
const mockOnCollapse = vi.fn();

vi.mock('../useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: vi.fn(() => ({
    isExpanded: false,
    onExpand: mockOnExpand,
    onCollapse: mockOnCollapse,
  })),
}));

// Create mock tool data
function createMockToolData(overrides: Partial<ToolData> = {}): ToolData {
  return {
    toolName: 'bash',
    input: { command: 'ls' },
    output: 'file.txt',
    success: true,
    isStreaming: false,
    primaryInfo: '$ ls',
    statusIcon: '✓',
    markerStatus: 'success',
    isJsonOutput: false,
    detectedLanguage: 'text',
    ...overrides,
  };
}

describe('useToolState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic state management', () => {
    it('returns expansion state from timeline hook', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      expect(result.current.isExpanded).toBe(false);
      expect(result.current.onExpand).toBe(mockOnExpand);
      expect(result.current.onCollapse).toBe(mockOnCollapse);
    });

    it('provides handleExpandedChange function', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      expect(typeof result.current.handleExpandedChange).toBe('function');
    });

    it('calls onExpand when handleExpandedChange(true)', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      act(() => {
        result.current.handleExpandedChange(true);
      });
      
      expect(mockOnExpand).toHaveBeenCalledTimes(1);
      expect(mockOnCollapse).not.toHaveBeenCalled();
    });

    it('calls onCollapse when handleExpandedChange(false)', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      act(() => {
        result.current.handleExpandedChange(false);
      });
      
      expect(mockOnCollapse).toHaveBeenCalledTimes(1);
      expect(mockOnExpand).not.toHaveBeenCalled();
    });
  });

  describe('custom state management', () => {
    it('initializes with empty custom state', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      expect(result.current.customState).toEqual({});
    });

    it('allows setting custom state values', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      act(() => {
        result.current.setCustomState('test', 'value');
      });
      
      expect(result.current.customState).toEqual({ test: 'value' });
    });

    it('allows setting multiple custom state values', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      act(() => {
        result.current.setCustomState('key1', 'value1');
        result.current.setCustomState('key2', 42);
        result.current.setCustomState('key3', true);
      });
      
      expect(result.current.customState).toEqual({
        key1: 'value1',
        key2: 42,
        key3: true,
      });
    });

    it('allows updating existing custom state values', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      act(() => {
        result.current.setCustomState('test', 'initial');
      });
      
      expect(result.current.customState.test).toBe('initial');
      
      act(() => {
        result.current.setCustomState('test', 'updated');
      });
      
      expect(result.current.customState.test).toBe('updated');
    });

    it('preserves other custom state when updating one key', () => {
      const toolData = createMockToolData();
      const { result } = renderHook(() => useToolState(toolData, false));
      
      act(() => {
        result.current.setCustomState('key1', 'value1');
        result.current.setCustomState('key2', 'value2');
      });
      
      act(() => {
        result.current.setCustomState('key1', 'updated');
      });
      
      expect(result.current.customState).toEqual({
        key1: 'updated',
        key2: 'value2',
      });
    });
  });

  describe('hook parameters', () => {
    it('passes isSelected to timeline expansion hook', () => {
      const { useTimelineItemExpansion } = require('../useTimelineExpansionToggle.js');
      const toolData = createMockToolData();
      
      renderHook(() => useToolState(toolData, true));
      
      expect(useTimelineItemExpansion).toHaveBeenCalledWith(
        true,
        expect.any(Function)
      );
    });

    it('calls onToggle when expansion changes', () => {
      const mockOnToggle = vi.fn();
      const { useTimelineItemExpansion } = require('../useTimelineExpansionToggle.js');
      const toolData = createMockToolData();
      
      renderHook(() => useToolState(toolData, false, mockOnToggle));
      
      // Get the callback passed to useTimelineItemExpansion
      const expansionCallback = useTimelineItemExpansion.mock.calls[0][1];
      
      // Call the callback
      expansionCallback();
      
      expect(mockOnToggle).toHaveBeenCalledTimes(1);
    });

    it('handles undefined onToggle gracefully', () => {
      const toolData = createMockToolData();
      
      expect(() => {
        renderHook(() => useToolState(toolData, false, undefined));
      }).not.toThrow();
    });
  });

  describe('memoization', () => {
    it('maintains stable references for callbacks', () => {
      const toolData = createMockToolData();
      const { result, rerender } = renderHook(() => useToolState(toolData, false));
      
      const initialHandleExpandedChange = result.current.handleExpandedChange;
      const initialSetCustomState = result.current.setCustomState;
      
      rerender();
      
      expect(result.current.handleExpandedChange).toBe(initialHandleExpandedChange);
      expect(result.current.setCustomState).toBe(initialSetCustomState);
    });
  });
});