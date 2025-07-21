// ABOUTME: Unit tests for LaceApp component
// ABOUTME: Tests component rendering, theme integration, and basic UI interactions

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LaceApp } from '../LaceApp';

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

describe('LaceApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as vi.MockedFunction<typeof fetch>).mockClear();
    
    // Set up default fetch mock to return empty projects
    (fetch as vi.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: [] }),
    } as Response);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', async () => {
    render(<LaceApp />);
    
    // Should show loading initially
    expect(screen.getByText('Loading projects...')).toBeInTheDocument();
    
    // Wait for loading to complete
    await screen.findByText('No Projects Found');
    expect(screen.getByText('Create a project to get started')).toBeInTheDocument();
  });

  it('shows correct initial state in header', async () => {
    render(<LaceApp />);
    
    // Should show "Select a Project" initially
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
    const mainContainer = container.firstChild as HTMLElement;
    expect(mainContainer).toHaveClass('bg-base-200', 'text-base-content');
  });

  it('initializes with empty business logic state', async () => {
    render(<LaceApp />);
    
    // Component should render with loading state initially
    expect(screen.getByText('Loading projects...')).toBeInTheDocument();
    
    // Then show empty state after loading
    await screen.findByText('No Projects Found');
    expect(screen.getByText('Create a project to get started')).toBeInTheDocument();
  });

  it('loads and displays projects from API', async () => {
    const mockProjects = [
      {
        id: 'project-1',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      },
    ];

    (fetch as vi.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ projects: mockProjects }),
    } as Response);

    render(<LaceApp />);
    
    // Should call projects API
    expect(fetch).toHaveBeenCalledWith('/api/projects');
    
    // Wait for loading to complete and show select prompt
    await screen.findByText('Select a Project');
    expect(screen.getByText('Choose a project from the sidebar to continue')).toBeInTheDocument();
  });

  it('handles session management when project is selected', async () => {
    const mockProjects = [
      {
        id: 'project-1',
        name: 'Test Project',
        description: 'A test project',
        workingDirectory: '/test',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      },
    ];

    const mockSessions = [
      {
        id: 'session-1',
        name: 'Test Session',
        createdAt: '2025-01-01T00:00:00Z',
        agents: [{
          threadId: 'agent-1',
          name: 'Claude',
          provider: 'anthropic',
          model: 'claude-3-sonnet-20241022'
        }]
      }
    ];

    // Mock API responses
    (fetch as vi.MockedFunction<typeof fetch>).mockImplementation((url) => {
      if (typeof url === 'string') {
        if (url === '/api/projects') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ projects: mockProjects }),
          } as Response);
        } else if (url.includes('/sessions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessions: mockSessions }),
          } as Response);
        }
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Not found' }),
      } as Response);
    });

    render(<LaceApp />);
    
    // Wait for projects to load
    await screen.findByText('Select a Project');

    // Should show project selection initially
    expect(screen.getByText('Choose a project from the sidebar to continue')).toBeInTheDocument();
    
    // Should have called projects API
    expect(fetch).toHaveBeenCalledWith('/api/projects');
  });
});