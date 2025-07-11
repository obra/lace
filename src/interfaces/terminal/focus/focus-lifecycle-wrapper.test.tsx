// ABOUTME: Unit tests for FocusLifecycleWrapper component testing focus lifecycle management
// ABOUTME: Tests automatic focus push/pop based on isActive state changes and rendering modes

import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { FocusLifecycleWrapper } from '~/interfaces/terminal/focus/focus-lifecycle-wrapper.js';
import { LaceFocusProvider } from '~/interfaces/terminal/focus/focus-provider.js';

// Mock focus context
const mockPushFocus = vi.fn();
const mockPopFocus = vi.fn();
const mockGetFocusStack = vi.fn(() => ['test']);
const mockIsFocusActive = vi.fn(() => true);

vi.mock('./focus-provider.js', async () => {
  const actual = await vi.importActual('./focus-provider.js');
  return {
    ...actual,
    useLaceFocusContext: () => ({
      currentFocus: 'test',
      pushFocus: mockPushFocus,
      popFocus: mockPopFocus,
      getFocusStack: mockGetFocusStack,
      isFocusActive: mockIsFocusActive,
    }),
  };
});

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <LaceFocusProvider>{children}</LaceFocusProvider>;
}

describe('FocusLifecycleWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset mock implementations
    mockGetFocusStack.mockReturnValue(['test']);
    mockIsFocusActive.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('focus lifecycle management', () => {
    it('pushes focus when isActive becomes true', () => {
      const { rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).not.toHaveBeenCalled();

      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={true}>
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      expect(mockPushFocus).toHaveBeenCalledWith('test');
      expect(mockPushFocus).toHaveBeenCalledTimes(1);
    });

    it.skip('pops focus when isActive becomes false', () => {
      mockPopFocus.mockReturnValue(true); // Simulate successful focus restoration

      const { rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).toHaveBeenCalledWith('test');

      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={false}>
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      // Advance fake timers to trigger the debounced cleanup (10ms delay)
      act(() => {
        vi.advanceTimersByTime(15);
      });

      expect(mockPopFocus).toHaveBeenCalledTimes(1);
    });

    it('calls onFocusActivated when becoming active', () => {
      const onFocusActivated = vi.fn();

      render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true} onFocusActivated={onFocusActivated}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(onFocusActivated).toHaveBeenCalledTimes(1);
    });

    it.skip('calls onFocusRestored when focus is popped successfully', async () => {
      const onFocusRestored = vi.fn();
      mockPopFocus.mockReturnValue(true); // Simulate successful focus restoration

      const { rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true} onFocusRestored={onFocusRestored}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper
              focusId="test"
              isActive={false}
              onFocusRestored={onFocusRestored}
            >
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      // Advance fake timers to trigger the debounced cleanup (10ms delay)
      act(() => {
        vi.advanceTimersByTime(15);
      });

      expect(onFocusRestored).toHaveBeenCalledTimes(1);
    });

    it('does not call onFocusRestored when focus pop fails', () => {
      const onFocusRestored = vi.fn();
      mockPopFocus.mockReturnValue(false); // Simulate failed focus restoration

      const { rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true} onFocusRestored={onFocusRestored}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper
              focusId="test"
              isActive={false}
              onFocusRestored={onFocusRestored}
            >
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      expect(onFocusRestored).not.toHaveBeenCalled();
    });

    it.skip('cleans up focus when unmounting while active', () => {
      mockPopFocus.mockReturnValue(true);

      const { unmount } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).toHaveBeenCalledWith('test');

      act(() => {
        unmount();
      });

      // Advance fake timers to trigger the debounced cleanup (10ms delay)
      act(() => {
        vi.advanceTimersByTime(15);
      });

      expect(mockPopFocus).toHaveBeenCalledTimes(1);
    });

    it('does not affect focus when unmounting while inactive', () => {
      const { unmount } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).not.toHaveBeenCalled();

      act(() => {
        unmount();
      });

      expect(mockPopFocus).not.toHaveBeenCalled();
    });
  });

  describe('rendering behavior', () => {
    it('renders children when active', () => {
      const { getByText } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true}>
            <div>test content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(getByText('test content')).toBeDefined();
    });

    it('renders children when inactive and renderWhenInactive=true', () => {
      const { getByText } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false} renderWhenInactive={true}>
            <div>test content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(getByText('test content')).toBeDefined();
    });

    it('does not render children when inactive and renderWhenInactive=false', () => {
      const { queryByText } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false} renderWhenInactive={false}>
            <div>test content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(queryByText('test content')).toBeNull();
    });

    it('defaults to renderWhenInactive=false', () => {
      const { queryByText } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false}>
            <div>test content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(queryByText('test content')).toBeNull();
    });

    it('shows/hides children based on isActive changes when renderWhenInactive=false', () => {
      const { getByText, queryByText, rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={true} renderWhenInactive={false}>
            <div>test content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      // Initially visible
      expect(getByText('test content')).toBeDefined();

      // Hide when becoming inactive
      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={false} renderWhenInactive={false}>
              <div>test content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      expect(queryByText('test content')).toBeNull();

      // Show again when becoming active
      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={true} renderWhenInactive={false}>
              <div>test content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      expect(getByText('test content')).toBeDefined();
    });

    it('always shows children when renderWhenInactive=true regardless of isActive', () => {
      const { getByText, rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false} renderWhenInactive={true}>
            <div>test content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      // Visible when inactive
      expect(getByText('test content')).toBeDefined();

      // Still visible when active
      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={true} renderWhenInactive={true}>
              <div>test content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      expect(getByText('test content')).toBeDefined();

      // Still visible when inactive again
      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={false} renderWhenInactive={true}>
              <div>test content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      expect(getByText('test content')).toBeDefined();
    });
  });

  describe('focus ID handling', () => {
    it('uses the provided focusId when pushing focus', () => {
      render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="custom-focus-id" isActive={true}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).toHaveBeenCalledWith('custom-focus-id');
    });

    it.skip('handles focus ID changes correctly', () => {
      mockPopFocus.mockReturnValue(true);

      const { rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="first-id" isActive={true}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).toHaveBeenCalledWith('first-id');

      // Change focus ID while active
      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="second-id" isActive={true}>
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      // Advance fake timers to trigger the debounced cleanup (10ms delay)
      act(() => {
        vi.advanceTimersByTime(15);
      });

      // Should pop first focus and push second focus
      expect(mockPopFocus).toHaveBeenCalledTimes(1);
      expect(mockPushFocus).toHaveBeenCalledWith('second-id');
      expect(mockPushFocus).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it.skip('handles rapid active state changes', () => {
      const { rerender } = render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="test" isActive={false}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      // Rapid changes: false -> true -> false -> true
      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={true}>
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={false}>
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      act(() => {
        rerender(
          <TestWrapper>
            <FocusLifecycleWrapper focusId="test" isActive={true}>
              <div>content</div>
            </FocusLifecycleWrapper>
          </TestWrapper>
        );
      });

      // Advance fake timers to trigger the debounced cleanup (10ms delay)
      act(() => {
        vi.advanceTimersByTime(15);
      });

      // Should have pushed twice and popped once
      expect(mockPushFocus).toHaveBeenCalledTimes(2);
      expect(mockPopFocus).toHaveBeenCalledTimes(1);
    });

    it('handles empty focusId', () => {
      render(
        <TestWrapper>
          <FocusLifecycleWrapper focusId="" isActive={true}>
            <div>content</div>
          </FocusLifecycleWrapper>
        </TestWrapper>
      );

      expect(mockPushFocus).toHaveBeenCalledWith('');
    });
  });
});
