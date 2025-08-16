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

// Use real theme provider instead of mocking internal business logic
import { ThemeProvider } from '@/components/providers/ThemeProvider';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: React.ComponentProps<'button'>) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock child components to avoid complex dependencies
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
  SidebarSection: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar-section">{children}</div>
  ),
  SidebarItem: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar-item">{children}</div>
  ),
  SidebarButton: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="sidebar-button">{children}</div>
  ),
}));

vi.mock('@/components/layout/MobileSidebar', () => ({
  MobileSidebar: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mobile-sidebar">{children}</div>
  ),
}));

vi.mock('@/components/timeline/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view">Timeline</div>,
}));

vi.mock('@/components/chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input">Chat Input</div>,
}));

vi.mock('@/components/modals/ToolApprovalModal', () => ({
  ToolApprovalModal: () => <div data-testid="tool-approval-modal">Tool Approval Modal</div>,
}));

vi.mock('@/components/config/SessionConfigPanel', () => ({
  SessionConfigPanel: () => <div data-testid="session-config-panel">Session Config Panel</div>,
}));

vi.mock('@/components/config/ProjectSelectorPanel', () => ({
  ProjectSelectorPanel: () => (
    <div data-testid="project-selector-panel">Project Selector Panel</div>
  ),
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

// Mock EventSource for useEventStream hook
class MockEventSource {
  static readonly CLOSED = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = MockEventSource.CONNECTING;
  url: string;

  constructor(url: string) {
    this.url = url;
    // Simulate immediate connection failure to avoid hanging tests
    setTimeout(() => {
      this.readyState = MockEventSource.CLOSED;
      if (this.onerror) {
        this.onerror(new Event('error'));
      }
    }, 0);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

global.EventSource = MockEventSource as unknown as typeof EventSource;

// Helper to render with real theme provider
const renderWithProviders = (component: React.ReactElement) => {
  return render(<ThemeProvider>{component}</ThemeProvider>);
};

describe('LaceApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    renderWithProviders(<LaceApp />);

    // Should show the basic layout elements (no header text assertion)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('shows correct initial layout structure', () => {
    renderWithProviders(<LaceApp />);

    // Should have sidebar
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('has mobile navigation button', () => {
    renderWithProviders(<LaceApp />);

    // Should have a mobile navigation button (hamburger menu)
    const mobileNavButton = screen.getByRole('button');
    expect(mobileNavButton).toBeInTheDocument();
  });

  it('applies correct CSS classes for theme', () => {
    const { container } = renderWithProviders(<LaceApp />);

    // Should have base theme classes
    const mainContainer = container.firstChild as HTMLElement | null;
    expect(mainContainer).toBeTruthy();
    expect(mainContainer!).toHaveClass('bg-gradient-to-br', 'from-base-100', 'text-base-content');
  });
});
