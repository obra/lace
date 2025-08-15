'use client';

import React, { useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import InlineCode from './InlineCode';

interface MessageTextProps {
  content: string;
  className?: string;
}

export default function MessageText({ content, className = '' }: MessageTextProps) {
  // Normalize content first to keep hooks at top-level (no early returns before hooks)
  const safeContent = typeof content === 'string' ? content : '';

  const markdownComponents: Components = {
    // Headers
    h1: ({ children }) => <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="text-sm font-bold mb-1 mt-2 first:mt-0">{children}</h4>,
    h5: ({ children }) => (
      <h5 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-semibold mb-1 mt-2 first:mt-0">{children}</h6>
    ),

    // Paragraphs
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

    // Lists - better spacing and overflow handling
    ul: ({ children }) => <ul className="list-disc mb-2 ml-6 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal mb-2 ml-6 space-y-1">{children}</ol>,
    li: ({ children }) => <li className="break-words leading-relaxed pl-1">{children}</li>,

    // Text formatting
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,

    // Code blocks - use our existing CodeBlock component
    code: (props: {
      node?: unknown;
      inline?: boolean;
      className?: string;
      children?: React.ReactNode;
    }) => {
      const { node, inline, className: codeClassName, children } = props;
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : 'text';

      if (!inline && String(children).includes('\n')) {
        // Multi-line code block
        return (
          <div className="my-2">
            <CodeBlock
              code={String(children).replace(/\n$/, '')}
              language={language}
              showLineNumbers={false}
              showHeader={true}
              maxHeight="400px"
            />
          </div>
        );
      } else {
        // Inline code
        return <InlineCode code={String(children)} enableHighlighting={false} />;
      }
    },

    // Links
    a: ({ children, href }) => (
      <a
        href={href}
        className="text-blue-400 hover:text-blue-300 underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-base-300 pl-4 my-2 text-base-content/80 italic">
        {children}
      </blockquote>
    ),

    // Horizontal rule
    hr: () => <hr className="border-base-300 my-4" />,

    // Tables
    table: ({ children }) => (
      <div className="overflow-x-auto my-2">
        <table className="table table-compact w-full">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => <th className="bg-base-200">{children}</th>,
    td: ({ children }) => <td>{children}</td>,
  };

  if (!safeContent) {
    return (
      <div className={`text-sm leading-relaxed text-base-content ${className}`}>
        <div className="text-base-content/50">No content</div>
      </div>
    );
  }

  return (
    <div className={`text-sm leading-relaxed text-base-content pr-4 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}
