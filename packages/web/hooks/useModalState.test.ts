// ABOUTME: Tests for useModalState hook
// ABOUTME: Validates modal state management for multiple modals

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useModalState } from './useModalState';

describe('useModalState', () => {
  it('initializes all modal states to false', () => {
    const { result } = renderHook(() => useModalState());

    expect(result.current.showMobileNav).toBe(false);
    expect(result.current.showDesktopSidebar).toBe(true); // Default to true
    expect(result.current.showTaskBoard).toBe(false);
    expect(result.current.showTaskCreation).toBe(false);
    expect(result.current.showTaskDisplay).toBe(false);
  });

  it('can open and close mobile navigation', () => {
    const { result } = renderHook(() => useModalState());

    act(() => {
      result.current.setShowMobileNav(true);
    });

    expect(result.current.showMobileNav).toBe(true);

    act(() => {
      result.current.setShowMobileNav(false);
    });

    expect(result.current.showMobileNav).toBe(false);
  });

  it('can toggle desktop sidebar', () => {
    const { result } = renderHook(() => useModalState());

    expect(result.current.showDesktopSidebar).toBe(true);

    act(() => {
      result.current.setShowDesktopSidebar(false);
    });

    expect(result.current.showDesktopSidebar).toBe(false);

    act(() => {
      result.current.setShowDesktopSidebar(true);
    });

    expect(result.current.showDesktopSidebar).toBe(true);
  });

  it('can manage task board modal state', () => {
    const { result } = renderHook(() => useModalState());

    act(() => {
      result.current.setShowTaskBoard(true);
    });

    expect(result.current.showTaskBoard).toBe(true);

    act(() => {
      result.current.setShowTaskBoard(false);
    });

    expect(result.current.showTaskBoard).toBe(false);
  });

  it('can manage task creation modal state', () => {
    const { result } = renderHook(() => useModalState());

    act(() => {
      result.current.setShowTaskCreation(true);
    });

    expect(result.current.showTaskCreation).toBe(true);

    act(() => {
      result.current.setShowTaskCreation(false);
    });

    expect(result.current.showTaskCreation).toBe(false);
  });

  it('can manage task display modal state with task selection', () => {
    const { result } = renderHook(() => useModalState());

    const mockTask = {
      id: 'task-1',
      title: 'Test Task',
      description: 'A test task',
      status: 'pending' as const,
      priority: 'medium' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
      createdBy: 'user-1',
      threadId: 'thread-1',
    };

    act(() => {
      result.current.setSelectedTaskForDisplay(mockTask);
      result.current.setShowTaskDisplay(true);
    });

    expect(result.current.showTaskDisplay).toBe(true);
    expect(result.current.selectedTaskForDisplay).toEqual(mockTask);

    act(() => {
      result.current.setShowTaskDisplay(false);
      result.current.setSelectedTaskForDisplay(null);
    });

    expect(result.current.showTaskDisplay).toBe(false);
    expect(result.current.selectedTaskForDisplay).toBeNull();
  });

  it('can manage auto-open project creation state', () => {
    const { result } = renderHook(() => useModalState());

    act(() => {
      result.current.setAutoOpenCreateProject(true);
    });

    expect(result.current.autoOpenCreateProject).toBe(true);

    act(() => {
      result.current.setAutoOpenCreateProject(false);
    });

    expect(result.current.autoOpenCreateProject).toBe(false);
  });

  it('manages all modal states independently', () => {
    const { result } = renderHook(() => useModalState());

    act(() => {
      result.current.setShowMobileNav(true);
      result.current.setShowTaskBoard(true);
      result.current.setShowTaskCreation(true);
      result.current.setAutoOpenCreateProject(true);
    });

    expect(result.current.showMobileNav).toBe(true);
    expect(result.current.showTaskBoard).toBe(true);
    expect(result.current.showTaskCreation).toBe(true);
    expect(result.current.autoOpenCreateProject).toBe(true);
    expect(result.current.showTaskDisplay).toBe(false);
    expect(result.current.showDesktopSidebar).toBe(true);
  });
});
