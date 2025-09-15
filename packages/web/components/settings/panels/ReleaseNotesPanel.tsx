// ABOUTME: Settings panel for displaying release notes with manual access
// ABOUTME: Shows current release notes in settings and allows viewing full content

'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { getCurrentReleaseNotes } from '@/lib/services/release-notes-service';

export function ReleaseNotesPanel() {
  const releaseNotesData = getCurrentReleaseNotes();

  if (!releaseNotesData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-base-content mb-2">Release Notes</h2>
          <p className="text-base-content/70">
            Release notes are not available. This typically happens in development mode before the
            build process has run.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-base-content mb-2">Release Notes</h2>
        <p className="text-base-content/70 mb-4">
          View the latest release notes and updates for Lace. These are automatically shown when new
          updates are available.
        </p>
      </div>

      <div className="bg-base-200 rounded-lg p-6">
        <div className="prose prose-sm max-w-none">
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
                  <code className="bg-base-300 text-base-content px-1 rounded text-sm" {...props}>
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
            {releaseNotesData.content}
          </ReactMarkdown>
        </div>
      </div>

      <div className="text-xs text-base-content/50">
        Content Hash: {releaseNotesData.hash?.substring(0, 8) || 'unknown'}...
      </div>
    </div>
  );
}
