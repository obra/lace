// ABOUTME: Unit tests for LaceAppWithDesignSystem component
// ABOUTME: Tests component rendering, theme integration, and basic UI interactions

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LaceAppWithDesignSystem } from '../LaceAppWithDesignSystem';

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

// Mock child components to avoid React import issues
vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: ({ children }: { children?: React.ReactNode }) => <div data-testid="sidebar">{children}</div>,
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

vi.mock('@/lib/timeline-converter', () => ({
  convertSessionEventsToTimeline: () => [],
}));

vi.mock('@/types/events', () => ({
  getAllEventTypes: () => [],
}));

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock EventSource
global.EventSource = vi.fn().mockImplementation(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  close: vi.fn(),
  onerror: vi.fn(),
}));

describe('LaceAppWithDesignSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as vi.MockedFunction<typeof fetch>).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(<LaceAppWithDesignSystem />);
    
    // Should show placeholder content initially
    expect(screen.getByText('TODO: Add real project/session/agent management here')).toBeInTheDocument();
  });

  it('shows correct initial state in header', () => {
    render(<LaceAppWithDesignSystem />);
    
    // Should show "No Session" when no session is selected
    expect(screen.getByText('No Session')).toBeInTheDocument();
  });

  it('has mobile navigation button', () => {
    render(<LaceAppWithDesignSystem />);
    
    // Should have a mobile navigation button (hamburger menu)
    const mobileNavButton = screen.getByRole('button');
    expect(mobileNavButton).toBeInTheDocument();
  });

  it('applies correct CSS classes for theme', () => {
    const { container } = render(<LaceAppWithDesignSystem />);
    
    // Should have base theme classes
    const mainContainer = container.firstChild as HTMLElement;
    expect(mainContainer).toHaveClass('bg-base-200', 'text-base-content');
  });

  it('initializes with empty business logic state', () => {
    render(<LaceAppWithDesignSystem />);
    
    // Component should render with initial empty state
    // This is verified by the placeholder text being visible
    expect(screen.getByText('TODO: Add real project/session/agent management here')).toBeInTheDocument();
  });
});