// ABOUTME: File content renderer with inline preview and full-screen modal expansion
// ABOUTME: Shows first 10 lines inline with animated modal for viewing complete content

'use client';

import React, { useState, useMemo } from 'react';
import CodeBlock from './CodeBlock';
import { AnimatedModal } from './AnimatedModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpand, faCompress, faCopy, faCheck } from '@/lib/fontawesome';

interface FileRendererProps {
  content: string;
  filename?: string;
  fileSize?: string;
  maxLines?: number;
  showLineNumbers?: boolean;
  startLineNumber?: number;
  showCopyButton?: boolean;
  className?: string;
  hideFooter?: boolean;
}

const INLINE_PREVIEW_LINES = 10;

export default function FileRenderer({
  content,
  filename,
  fileSize,
  maxLines = INLINE_PREVIEW_LINES,
  showLineNumbers = false,
  startLineNumber = 1,
  showCopyButton = true,
  className = '',
  hideFooter = false,
}: FileRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Calculate preview content and line counts
  const { previewContent, totalLines, needsExpansion } = useMemo(() => {
    const lines = content.split('\n');
    const total = lines.length;
    const needsExp = total > maxLines;
    const preview = needsExp ? lines.slice(0, maxLines).join('\n') : content;

    return {
      previewContent: preview,
      totalLines: total,
      needsExpansion: needsExp,
    };
  }, [content, maxLines]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Extract just the filename from path for display
  const displayName = filename ? filename.split('/').pop() : 'File Content';

  return (
    <div className={className}>
      {/* Inline preview */}
      <div className="relative">
        <CodeBlock
          code={previewContent}
          filename={filename}
          showLineNumbers={showLineNumbers}
          startLineNumber={startLineNumber}
          showCopyButton={false}
          showLanguageLabel={false}
          showHeader={false}
          maxHeight="400px"
          className="border-0 bg-transparent"
        />

        {/* Footer with file info and expansion */}
        {!hideFooter && (needsExpansion || fileSize) && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-base-300">
            <div className="text-xs text-base-content/60">
              {totalLines} lines{fileSize && ` • ${fileSize}`}
            </div>
            {needsExpansion && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="text-xs text-primary hover:text-primary-focus flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-primary/10 transition-colors"
              >
                <FontAwesomeIcon icon={faExpand} className="w-3 h-3" />
                View Full File
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full-screen modal */}
      <AnimatedModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="full"
        closeOnBackdropClick={true}
        closeOnEscape={true}
        className="file-viewer-modal"
      >
        <div className="flex flex-col h-full">
          {/* Modal header */}
          <div className="flex items-center justify-between p-4 border-b border-base-300 bg-base-50">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-base-content">{displayName}</h2>
              {filename && (
                <span className="text-sm text-base-content/60 font-mono">{filename}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="btn btn-sm btn-ghost"
                title="Copy to clipboard"
              >
                <FontAwesomeIcon
                  icon={copied ? faCheck : faCopy}
                  className={`w-4 h-4 ${copied ? 'text-success' : ''}`}
                />
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => setIsModalOpen(false)}
                className="btn btn-sm btn-ghost"
                title="Close (Esc)"
              >
                <FontAwesomeIcon icon={faCompress} className="w-4 h-4" />
                Close
              </button>
            </div>
          </div>

          {/* Modal content */}
          <div className="flex-1 overflow-auto p-4 bg-base-100">
            <CodeBlock
              code={content}
              filename={filename}
              showLineNumbers={true}
              startLineNumber={startLineNumber}
              showCopyButton={false}
              showLanguageLabel={true}
              showHeader={false}
              maxHeight="none"
              className="border border-base-300 rounded-lg"
            />
          </div>

          {/* Modal footer */}
          <div className="p-3 border-t border-base-300 bg-base-50">
            <div className="text-sm text-base-content/60 text-center">
              {totalLines} lines • Press Esc to close
            </div>
          </div>
        </div>
      </AnimatedModal>
    </div>
  );
}
