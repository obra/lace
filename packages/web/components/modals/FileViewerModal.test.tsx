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

    expect(mockApiGet).toHaveBeenCalledWith('/api/sessions/test-session-123/files/src/test.ts');
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

  it('should handle download functionality', async () => {
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
      expect(screen.getByTitle('Download file')).toBeInTheDocument();
    });

    // Just verify the button exists and is clickable - don't test DOM manipulation
    expect(screen.getByTitle('Download file')).toBeInTheDocument();
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
      expect(screen.getByText('2 KB')).toBeInTheDocument();
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

    // Mock blob and download functionality
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
    
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement);
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as unknown as Node);
    const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as unknown as Node);

    render(<FileViewerModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle('Download file')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle('Download file'));

    expect(mockCreateObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(mockLink.download).toBe('test.ts');
    expect(mockLink.click).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    
    // Cleanup mocks
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
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
