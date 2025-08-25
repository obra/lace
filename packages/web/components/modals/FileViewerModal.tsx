// ABOUTME: Modal component for displaying file content with syntax highlighting
// ABOUTME: Provides file viewing with download, copy, and pop-out functionality

'use client';

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFile, faSave, faExternalLinkAlt, faCopy, faSpinner } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api-client';
import type { SessionFileContentResponse } from '@/types/session-files';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

interface FileViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  filePath: string;
  fileName: string;
}

interface FileViewerHeaderProps {
  fileName: string;
  filePath: string;
  onDownload: () => void;
  onPopOut: () => void;
  onCopy: () => void;
}

function FileViewerHeader({
  fileName,
  filePath,
  onDownload,
  onPopOut,
  onCopy,
}: FileViewerHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <FontAwesomeIcon icon={faFile} className="w-4 h-4 text-gray-500" />
        <div>
          <div className="font-medium">{fileName}</div>
          <div className="text-sm text-gray-500">{filePath}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onCopy} className="btn btn-ghost btn-sm" title="Copy content">
          <FontAwesomeIcon icon={faCopy} className="w-4 h-4" />
        </button>

        <button onClick={onDownload} className="btn btn-ghost btn-sm" title="Download file">
          <FontAwesomeIcon icon={faSave} className="w-4 h-4" />
        </button>

        <button onClick={onPopOut} className="btn btn-ghost btn-sm" title="Open in new window">
          <FontAwesomeIcon icon={faExternalLinkAlt} className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface FileContentProps {
  fileContent: SessionFileContentResponse | null;
  isLoading: boolean;
  error: string | null;
}

function FileContent({ fileContent, isLoading, error }: FileContentProps) {
  const [highlightedContent, setHighlightedContent] = useState<string>('');

  // Syntax highlighting effect
  useEffect(() => {
    if (!fileContent?.content) {
      setHighlightedContent('');
      return;
    }

    try {
      // Let highlight.js auto-detect the language
      const highlighted = hljs.highlightAuto(fileContent.content).value;

      // Sanitize the highlighted HTML
      const sanitized = DOMPurify.sanitize(highlighted);
      setHighlightedContent(sanitized);
    } catch (err) {
      console.warn('Failed to highlight code:', err);
      // Fallback to plain text
      setHighlightedContent(DOMPurify.sanitize(fileContent.content));
    }
  }, [fileContent]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <FontAwesomeIcon icon={faSpinner} className="w-6 h-6 animate-spin mr-3" />
        <span>Loading file content...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-600 mb-4">{error}</div>
        <div className="text-sm text-gray-500">
          The file could not be loaded. It may be too large, binary, or inaccessible.
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return <div className="p-8 text-center text-gray-500">No file selected</div>;
  }

  return (
    <div className="h-96 overflow-auto border border-gray-200 rounded">
      {/* File info header */}
      <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 text-sm text-gray-600">
        <div className="flex justify-between">
          <span>{fileContent.mimeType}</span>
          <span>{formatFileSize(fileContent.size)}</span>
        </div>
      </div>

      {/* Code content with syntax highlighting */}
      <div className="p-4">
        <pre className="text-sm font-mono leading-relaxed">
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
        </pre>
      </div>
    </div>
  );
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function FileViewerModal({
  isOpen,
  onClose,
  sessionId,
  filePath,
  fileName,
}: FileViewerModalProps) {
  const [fileContent, setFileContent] = useState<SessionFileContentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file content when modal opens or file path changes
  useEffect(() => {
    if (!isOpen || !filePath) {
      setFileContent(null);
      setError(null);
      return;
    }

    const loadFileContent = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const encodedPath = filePath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        const response = await api.get<SessionFileContentResponse>(
          `/api/sessions/${sessionId}/files/${encodedPath}`
        );
        setFileContent(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file content');
        setFileContent(null);
      } finally {
        setIsLoading(false);
      }
    };

    void loadFileContent();
  }, [isOpen, sessionId, filePath]);

  // Action handlers
  const handleDownload = () => {
    if (!fileContent) return;

    const blob = new Blob([fileContent.content], { type: fileContent.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!fileContent) return;

    try {
      await navigator.clipboard.writeText(fileContent.content);
      // Could add toast notification here
    } catch (err) {
      console.error('Failed to copy content:', err);
    }
  };

  const handlePopOut = () => {
    const popoutUrl = new URL('/file-viewer', window.location.origin);
    popoutUrl.searchParams.set('session', sessionId);
    popoutUrl.searchParams.set('file', filePath);

    const popoutWindow = window.open(
      popoutUrl.toString(),
      'file-viewer',
      'width=1200,height=800,location=no,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes'
    );

    if (popoutWindow) {
      popoutWindow.focus();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={
        <FileViewerHeader
          fileName={fileName}
          filePath={filePath}
          onDownload={handleDownload}
          onPopOut={handlePopOut}
          onCopy={handleCopy}
        />
      }
    >
      <FileContent fileContent={fileContent} isLoading={isLoading} error={error} />
    </Modal>
  );
}
