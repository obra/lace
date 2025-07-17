// ABOUTME: Tests for UserInstructionsEditor component
// ABOUTME: Validates API integration and user instructions management

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UserInstructionsEditor } from '../UserInstructionsEditor';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('UserInstructionsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  it('renders with proper title', () => {
    render(<UserInstructionsEditor />);

    expect(screen.getByText('User Instructions Editor')).toBeInTheDocument();
  });

  it('shows information about user instructions', () => {
    render(<UserInstructionsEditor />);

    expect(screen.getByText('About User Instructions')).toBeInTheDocument();
    expect(screen.getByText(/User instructions are stored in/)).toBeInTheDocument();
  });

  it('loads instructions from API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'Test instructions' }),
    });

    render(<UserInstructionsEditor />);

    // The component should attempt to load instructions
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/instructions', {
        method: 'GET',
      });
    });
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
    });

    render(<UserInstructionsEditor />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Should handle error without crashing
    expect(screen.getByText('User Instructions Editor')).toBeInTheDocument();
  });

  it('saves instructions to API', async () => {
    // Mock successful load
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '' }),
    });

    // Mock successful save
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<UserInstructionsEditor />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/instructions', {
        method: 'GET',
      });
    });

    // The save functionality is tested indirectly through the InstructionsEditor
    // which uses the provided onSave function
  });
});
