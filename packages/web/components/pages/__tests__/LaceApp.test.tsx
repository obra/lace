// ABOUTME: Unit tests for LaceApp component
// ABOUTME: Tests component rendering, theme integration, and basic UI interactions

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LaceApp } from '@/components/pages/LaceApp';

// Mock the theme context
vi.mock('@/components/providers/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock child components to avoid complex dependencies
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar">{children}</div>,
  SidebarSection: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-section">{children}</div>,
  SidebarItem: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-item">{children}</div>,
  SidebarButton: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar-button">{children}</div>,
}));

vi.mock('@/components/layout/MobileSidebar', () => ({
  MobileSidebar: ({ children }: { children?: React.ReactNode }) => <div data-testid="mobile-sidebar">{children}</div>,
}));

vi.mock('@/components/timeline/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view">Timeline</div>,
}));

vi.mock('@/components/chat/EnhancedChatInput', () => ({
  EnhancedChatInput: () => <div data-testid="chat-input">Chat Input</div>,
}));

vi.mock('@/components/modals/ToolApprovalModal', () => ({
  ToolApprovalModal: () => <div data-testid="tool-approval-modal">Tool Approval Modal</div>,
}));

vi.mock('@/components/config/SessionConfigPanel', () => ({
  SessionConfigPanel: () => <div data-testid="session-config-panel">Session Config Panel</div>,
}));

vi.mock('@/components/config/ProjectSelectorPanel', () => ({
  ProjectSelectorPanel: () => <div data-testid="project-selector-panel">Project Selector Panel</div>,
}));

vi.mock('@/lib/timeline-converter', () => ({
  convertSessionEventsToTimeline: () => [],
}));

vi.mock('@/types/events', () => ({
  getAllEventTypes: () => [],
}));

// Mock fetch for API calls - make them never resolve so we can test loading states
const mockFetch = vi.fn(() => new Promise(() => {})); // Promise that never resolves
global.fetch = mockFetch as unknown as typeof fetch;

// Mock EventSource
global.EventSource = vi.fn().mockImplementation(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  close: vi.fn(),
  onerror: vi.fn(),
}));

describe('LaceApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(<LaceApp />);
    
    // Should show the basic layout elements
    expect(screen.getByText('Select a Project')).toBeInTheDocument();
  });

  it('shows correct initial layout structure', () => {
    render(<LaceApp />);
    
    // Should have sidebar
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    
    // Should show "Select a Project" in header
    expect(screen.getByText('Select a Project')).toBeInTheDocument();
  });

  it('has mobile navigation button', () => {
    render(<LaceApp />);
    
    // Should have a mobile navigation button (hamburger menu)
    const mobileNavButton = screen.getByRole('button');
    expect(mobileNavButton).toBeInTheDocument();
  });

  it('applies correct CSS classes for theme', () => {
    const { container } = render(<LaceApp />);
    
    // Should have base theme classes
    const mainContainer = container.firstChild as HTMLElement | null;
    expect(mainContainer).toBeTruthy();
    expect(mainContainer!).toHaveClass('bg-base-200', 'text-base-content');
  });
});