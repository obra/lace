// ABOUTME: File modal button component for full-screen file viewing
// ABOUTME: Provides "View Full File" action with animated modal and copy functionality

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpand, faCopy, faCheck, faCompress } from '@fortawesome/free-solid-svg-icons';
import { AnimatedModal } from './AnimatedModal';
import CodeBlock from './CodeBlock';
import type { ToolResult } from '@/components/timeline/tool/types';

interface FileModalButtonProps {
  content: string;
  filePath?: string;
  result: ToolResult;
  startLineNumber?: number;
}

export default function FileModalButton({
  content,
  filePath,
  result,
  startLineNumber = 1,
}: FileModalButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const displayName = filePath ? filePath.split('/').pop() : 'File Content';
  const totalLines = content.split('\n').length;

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="text-xs text-primary hover:text-primary-focus flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/10 transition-colors"
      >
        <FontAwesomeIcon icon={faExpand} className="text-xs" />
        View Full File
      </button>

      <AnimatedModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="full"
        closeOnBackdropClick={true}
        closeOnEscape={true}
        className="file-viewer-modal"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-base-300 bg-base-50">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-base-content">{displayName}</h2>
              {filePath && (
                <span className="text-sm text-base-content/60 font-mono">{filePath}</span>
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
          <div className="flex-1 overflow-auto p-4 bg-base-100">
            <CodeBlock
              code={content}
              filename={filePath}
              showLineNumbers={true}
              startLineNumber={startLineNumber}
              showCopyButton={false}
              showLanguageLabel={true}
              showHeader={false}
              maxHeight="none"
              className="border border-base-300 rounded-lg"
            />
          </div>
          <div className="p-3 border-t border-base-300 bg-base-50">
            <div className="text-sm text-base-content/60 text-center">
              {totalLines} lines • Press Esc to close
            </div>
          </div>
        </div>
      </AnimatedModal>
    </>
  );
}
