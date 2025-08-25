// ABOUTME: Tests for SessionFileTree component
// ABOUTME: Tests file tree rendering, expand/collapse functionality, search filtering, and API integration

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionFileTree } from './SessionFileTree';
import * as apiClient from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

const mockApiGet = vi.mocked(apiClient.api.get);

describe('SessionFileTree', () => {
  const mockOnFileSelect = vi.fn();
  const defaultProps = {
    sessionId: 'test-session-123',
    onFileSelect: mockOnFileSelect,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading state initially', () => {
    render(<SessionFileTree {...defaultProps} />);
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
  });

  it('should load and display file tree on mount', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'src',
          path: 'src',
          type: 'directory' as const,
          lastModified: new Date(),
          isReadable: true,
        },
        {
          name: 'package.json',
          path: 'package.json',
          type: 'file' as const,
          size: 1024,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/test-session-123/files');
  });

  it('should handle file selection', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'test.ts',
          path: 'test.ts',
          type: 'file' as const,
          size: 512,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('test.ts'));

    expect(mockOnFileSelect).toHaveBeenCalledWith('test.ts', 'test.ts');
  });

  it('should expand directories when clicked', async () => {
    const rootResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'src',
          path: 'src',
          type: 'directory' as const,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    const subDirResponse = {
      workingDirectory: '/test/dir',
      currentPath: 'src',
      entries: [
        {
          name: 'index.ts',
          path: 'src/index.ts',
          type: 'file' as const,
          size: 256,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce(rootResponse).mockResolvedValueOnce(subDirResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('src'));

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(mockApiGet).toHaveBeenLastCalledWith('/api/sessions/test-session-123/files?path=src');
  });

  it('should filter files based on search term', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'component.tsx',
          path: 'component.tsx',
          type: 'file' as const,
          size: 1024,
          lastModified: new Date(),
          isReadable: true,
        },
        {
          name: 'test.js',
          path: 'test.js',
          type: 'file' as const,
          size: 512,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} searchTerm="comp" />);

    await waitFor(() => {
      // Use a function matcher to handle highlighted text
      expect(
        screen.getByText((content, element) => {
          return element?.textContent === 'component.tsx';
        })
      ).toBeInTheDocument();
      expect(screen.queryByText('test.js')).not.toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('should show file sizes for files', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'small.txt',
          path: 'small.txt',
          type: 'file' as const,
          size: 1024,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('small.txt')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument(); // formatFileSize returns "1 KB" not "1.0 KB"
    });
  });

  it('should highlight search terms in file names', async () => {
    const mockResponse = {
      workingDirectory: '/test/dir',
      currentPath: '',
      entries: [
        {
          name: 'component.tsx',
          path: 'component.tsx',
          type: 'file' as const,
          size: 1024,
          lastModified: new Date(),
          isReadable: true,
        },
      ],
    };

    mockApiGet.mockResolvedValueOnce(mockResponse);

    render(<SessionFileTree {...defaultProps} searchTerm="comp" />);

    await waitFor(() => {
      // Use a function matcher to handle highlighted text
      expect(
        screen.getByText((content, element) => {
          return element?.textContent === 'component.tsx';
        })
      ).toBeInTheDocument();
      // Should have highlighted text
      expect(document.querySelector('mark')).toBeInTheDocument();
    });
  });
});
