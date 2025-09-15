// ABOUTME: Modal component for displaying release notes with markdown rendering
// ABOUTME: Handles user dismissal and triggers settings update when closed

'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Modal } from '@/components/ui/Modal';

interface ReleaseNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  onMarkAsSeen?: () => void;
}

/** @public */
export function ReleaseNotesModal({
  isOpen,
  onClose,
  content,
  onMarkAsSeen,
}: ReleaseNotesModalProps) {
  const handleClose = () => {
    onMarkAsSeen?.();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Release Notes"
      size="lg"
      className="max-h-[80vh]"
    >
      <div className="prose prose-sm max-w-none overflow-y-auto max-h-[60vh] pr-2">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            // Customize link behavior
            a: ({ href, children, ...props }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="link link-primary"
                {...props}
              >
                {children}
              </a>
            ),
            // Customize code blocks
            code: ({ children, className, ...props }) => {
              const match = /language-(\w+)/.exec(className || '');
              return match ? (
                <code className={`${className} text-sm`} {...props}>
                  {children}
                </code>
              ) : (
                <code className="bg-base-200 text-base-content px-1 rounded text-sm" {...props}>
                  {children}
                </code>
              );
            },
            // Customize headings to work with DaisyUI theme
            h1: ({ children, ...props }) => (
              <h1 className="text-2xl font-bold text-base-content mb-4" {...props}>
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2 className="text-xl font-semibold text-base-content mb-3 mt-6" {...props}>
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3 className="text-lg font-medium text-base-content mb-2 mt-4" {...props}>
                {children}
              </h3>
            ),
            // Customize lists
            ul: ({ children, ...props }) => (
              <ul className="list-disc list-inside space-y-1 text-base-content/90" {...props}>
                {children}
              </ul>
            ),
            li: ({ children, ...props }) => (
              <li className="text-sm leading-relaxed" {...props}>
                {children}
              </li>
            ),
            // Customize paragraphs
            p: ({ children, ...props }) => (
              <p className="text-base-content/90 leading-relaxed mb-3" {...props}>
                {children}
              </p>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      <div className="flex justify-end mt-4 pt-4 border-t border-base-300">
        <button onClick={handleClose} className="btn btn-primary">
          Got it!
        </button>
      </div>
    </Modal>
  );
}
