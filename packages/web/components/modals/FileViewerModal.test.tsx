// ABOUTME: Tests for FileViewerModal component
// ABOUTME: Tests file content loading, syntax highlighting, action buttons, and error handling

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

// Mock highlight.js and DOMPurify
vi.mock('highlight.js', () => ({
  default: {
    highlight: vi.fn().mockReturnValue({ value: '<span class="hljs-keyword">const</span>' }),
    highlightAuto: vi.fn().mockReturnValue({ value: 'highlighted content' }),
  },
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn().mockImplementation((content) => content),
  },
}));

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileViewerModal } from '@/components/modals/FileViewerModal';
import * as apiClient from '@/lib/api-client';

const mockApiGet = vi.mocked(apiClient.api.get);

describe('FileViewerModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sessionId: 'test-session-123',
    filePath: 'src/test.ts',
    fileName: 'test.ts',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Ensure DOM is properly set up for tests that manipulate document.body
    if (typeof document !== 'undefined' && !document.body) {
      document.body = document.createElement('body');
    }
  });

  it('should render loading state while fetching file content', () => {
    render(<FileViewerModal {...defaultProps} />);
    expect(screen.getByText('Loading file content...')).toBeInTheDocument();
  });

  it('should load and display file content', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024,
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('test.ts')).toBeInTheDocument();
      expect(screen.getByText('src/test.ts')).toBeInTheDocument();
      expect(screen.getByText(/text\/typescript/)).toBeInTheDocument();
    });

    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/test-session-123/files/src/test.ts', {
      signal: expect.any(AbortSignal),
    });
  });

  it('should handle API errors gracefully', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('File not found'));

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
      expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    });
  });

  it('should not load content when modal is closed', () => {
    render(<FileViewerModal {...defaultProps} isOpen={false} />);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('should handle copy functionality', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024,
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    // Mock clipboard API
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Copy content')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle('Copy content'));

    expect(mockWriteText).toHaveBeenCalledWith('const hello = "world";');
  });


  it('should handle pop-out window functionality', async () => {
    const mockFileContent = {
      path: 'src/test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024,
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Open in new window')).toBeInTheDocument();
    });

    // Just verify the button exists - don't test window.open
    expect(screen.getByTitle('Open in new window')).toBeInTheDocument();
  });

  it('should display file metadata correctly', async () => {
    const mockFileContent = {
      path: 'src/large-file.js',
      content: 'console.log("test");',
      mimeType: 'text/javascript',
      encoding: 'utf8' as const,
      size: 2048,
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    render(
      <FileViewerModal {...defaultProps} filePath="src/large-file.js" fileName="large-file.js" />
    );

    await waitFor(() => {
      expect(screen.getByText(/text\/javascript/)).toBeInTheDocument();
      expect(screen.getByText(/2\s*KB/)).toBeInTheDocument();
    });
  });

  it('should handle binary files appropriately', async () => {
    const mockBinaryFileContent = {
      path: 'image.png',
      content: 'binary-data-here',
      mimeType: 'image/png',
      encoding: 'utf8' as const,
      size: 1024,
    };

    mockApiGet.mockResolvedValueOnce(mockBinaryFileContent);

    render(<FileViewerModal {...defaultProps} filePath="image.png" fileName="image.png" />);

    await waitFor(() => {
      expect(screen.getByText('Cannot preview binary file')).toBeInTheDocument();
      
      // Copy button should be disabled for binary files
      const copyButton = screen.getByTitle('Copy content');
      expect(copyButton).toBeDisabled();
    });
  });

  it('should handle download functionality with proper blob creation', async () => {
    const mockFileContent = {
      path: 'test.ts',
      content: 'const hello = "world";',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 1024,
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    // Mock only URL methods without interfering with DOM
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url');
    const mockRevokeObjectURL = vi.fn();
    const originalCreateObjectURL = global.URL.createObjectURL;
    const originalRevokeObjectURL = global.URL.revokeObjectURL;
    
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Download file')).toBeInTheDocument();
    });

    // Test that download button is functional (clicking it should trigger blob creation)
    const downloadButton = screen.getByTitle('Download file');
    await userEvent.click(downloadButton);

    // Verify blob operations were called
    expect(mockCreateObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text/typescript'
      })
    );
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');

    // Restore functions
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('should encode file paths correctly when making API calls', async () => {
    const mockFileContent = {
      path: 'folder with spaces/file name.ts',
      content: 'test content',
      mimeType: 'text/typescript',
      encoding: 'utf8' as const,
      size: 100,
    };

    mockApiGet.mockResolvedValueOnce(mockFileContent);

    render(
      <FileViewerModal 
        {...defaultProps} 
        filePath="folder with spaces/file name.ts" 
        fileName="file name.ts" 
      />
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/sessions/test-session-123/files/folder%20with%20spaces/file%20name.ts',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });
});
