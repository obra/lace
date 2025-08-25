// ABOUTME: Standalone file viewer page for pop-out file viewing functionality
// ABOUTME: Provides full-screen file content viewing with syntax highlighting and download/copy actions

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFile, faDownload, faCopy, faSpinner, faExclamationTriangle } from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type { SessionFileContentResponse } from '@/types/session-files';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

// Import highlight.js theme - you may want to match your app theme
import 'highlight.js/styles/github.css';

interface FileViewerContentProps {
  sessionId: string;
  filePath: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function FileViewerContent({ sessionId, filePath }: FileViewerContentProps) {
  const [fileContent, setFileContent] = useState<SessionFileContentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedContent, setHighlightedContent] = useState<string>('');

  // Load file content
  useEffect(() => {
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
  }, [sessionId, filePath]);

  // Syntax highlighting effect
  useEffect(() => {
    if (!fileContent?.content) {
      setHighlightedContent('');
      return;
    }

    try {
      // Let highlight.js auto-detect the language
      const highlighted = hljs.highlightAuto(fileContent.content).value;

      const sanitized = DOMPurify.sanitize(highlighted);
      setHighlightedContent(sanitized);
    } catch (err) {
      console.warn('Failed to highlight code:', err);
      setHighlightedContent(DOMPurify.sanitize(fileContent.content));
    }
  }, [fileContent]);

  const handleDownload = () => {
    if (!fileContent) return;

    const blob = new Blob([fileContent.content], { type: fileContent.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filePath.split('/').pop() || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!fileContent) return;

    try {
      await navigator.clipboard.writeText(fileContent.content);
      // Simple feedback - could be enhanced with toast
      const button = document.getElementById('copy-button');
      if (button) {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy content:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center">
          <FontAwesomeIcon icon={faSpinner} className="w-8 h-8 animate-spin text-primary mb-4" />
          <div className="text-lg">Loading file content...</div>
          <div className="text-sm text-base-content/60 mt-2">{filePath}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center max-w-md">
          <FontAwesomeIcon icon={faExclamationTriangle} className="w-12 h-12 text-error mb-4" />
          <div className="text-lg font-medium mb-2">Failed to Load File</div>
          <div className="text-error mb-4">{error}</div>
          <div className="text-sm text-base-content/60">
            The file may be too large, binary, or inaccessible.
          </div>
          <div className="text-sm text-base-content/60 mt-2 font-mono">{filePath}</div>
        </div>
      </div>
    );
  }

  if (!fileContent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center">
          <div className="text-lg">No file content available</div>
        </div>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <header className="bg-base-200 border-b border-base-300 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faFile} className="w-5 h-5 text-base-content/60" />
            <div>
              <h1 className="text-lg font-medium">{fileName}</h1>
              <div className="text-sm text-base-content/60">{filePath}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-base-content/60">
              {fileContent.mimeType} • {formatFileSize(fileContent.size)}
            </div>

            <button
              id="copy-button"
              onClick={handleCopy}
              className="btn btn-ghost btn-sm"
              title="Copy content to clipboard"
            >
              <FontAwesomeIcon icon={faCopy} className="w-4 h-4 mr-2" />
              Copy
            </button>

            <button
              onClick={handleDownload}
              className="btn btn-primary btn-sm"
              title="Download file"
            >
              <FontAwesomeIcon icon={faDownload} className="w-4 h-4 mr-2" />
              Download
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
          <pre className="p-6 text-sm font-mono leading-relaxed overflow-auto">
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
          </pre>
        </div>
      </main>
    </div>
  );
}

function FileViewerPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const filePath = searchParams.get('file');

  if (!sessionId || !filePath) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center">
          <FontAwesomeIcon icon={faExclamationTriangle} className="w-12 h-12 text-error mb-4" />
          <div className="text-lg font-medium mb-2">Invalid File Viewer URL</div>
          <div className="text-base-content/60">
            Missing required session ID or file path parameters.
          </div>
        </div>
      </div>
    );
  }

  return <FileViewerContent sessionId={sessionId} filePath={filePath} />;
}

// Wrap in Suspense since we're using useSearchParams
export default function FileViewerPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-base-100">
          <FontAwesomeIcon icon={faSpinner} className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <FileViewerPage />
    </Suspense>
  );
}
