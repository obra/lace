// ABOUTME: Test utilities and helpers for web interface components
// ABOUTME: Provides reusable test functions and mock data generators

import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import { TimelineEntry, Project, Timeline, Task, RecentFile } from '~/interfaces/web/types';

// Default render wrapper
export const renderWithDefaults = (ui: React.ReactElement, options?: RenderOptions) => {
  return render(ui, options);
};

// Mock data generators
export const createMockTimelineEntry = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: 'test-entry-1',
  type: 'human',
  content: 'Test message',
  timestamp: new Date(),
  ...overrides,
});

export const createMockProject = (overrides: Partial<Project> = {}): Project => ({
  id: 1,
  name: 'Test Project',
  path: '/test/project',
  ...overrides,
});

export const createMockTimeline = (overrides: Partial<Timeline> = {}): Timeline => ({
  id: 1,
  name: 'Test Timeline',
  agent: 'Claude',
  ...overrides,
});

export const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  title: 'Test Task',
  description: 'Test task description',
  priority: 'medium',
  assignee: 'Test User',
  status: 'pending',
  ...overrides,
});

export const createMockRecentFile = (overrides: Partial<RecentFile> = {}): RecentFile => ({
  name: 'test.txt',
  path: '/test/test.txt',
  ...overrides,
});

// Common test props
export const mockSidebarProps = {
  isOpen: true,
  onToggle: vi.fn(),
  currentProject: createMockProject(),
  projects: [createMockProject()],
  currentTimeline: createMockTimeline(),
  timelines: [createMockTimeline({ id: 2, name: 'Timeline 2' })],
  activeTasks: [createMockTask()],
  recentFiles: [createMockRecentFile()],
  currentTheme: 'dark',
  onProjectChange: vi.fn(),
  onTimelineChange: vi.fn(),
  onNewTimeline: vi.fn(),
  onOpenTask: vi.fn(),
  onOpenFile: vi.fn(),
  onTriggerTool: vi.fn(),
  onOpenTaskBoard: vi.fn(),
  onOpenFileManager: vi.fn(),
  onOpenRulesFile: vi.fn(),
  onThemeChange: vi.fn(),
};

export const mockChatInputProps = {
  value: '',
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  disabled: false,
  isListening: false,
  onStartVoice: vi.fn(),
  onStopVoice: vi.fn(),
};