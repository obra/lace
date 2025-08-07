// ABOUTME: Markdown renderer component with proper markdown parsing and folding functionality  
// ABOUTME: Reuses existing truncation pattern from UnknownEventEntry, integrates with CodeBlock

'use client';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import DOMPurify from 'dompurify';
import { useFoldableContent } from '@/hooks/useFoldableContent';

interface MarkdownRendererProps {
  content: string;
  maxLines?: number;
  isRecentMessage?: boolean;
  className?: string;
}

const MAX_LINES = 4;

export default function MarkdownRenderer({ 
  content, 
  maxLines = MAX_LINES, 
  isRecentMessage = true,
  className = '' 
}: MarkdownRendererProps) {
  const { displayContent, shouldFold, isExpanded, toggleExpanded, remainingLines } = useFoldableContent(
    content,
    maxLines,
    isRecentMessage
  );

  const components: Components = {
    // Style elements to match our design system
    code: ({ className, children, ...props }) => {
      // For inline code (no language class)
      if (!className || (typeof className === 'string' && !className.includes('language-'))) {
        return (
          <code className="bg-base-200 px-1 py-0.5 rounded text-sm font-mono text-base-content" {...props}>
            {children}
          </code>
        );
      }
      // For code blocks, let rehype-highlight handle it with default styling
      return <code className={className as string} {...props}>{children}</code>;
    },
    pre: ({ children, ...props }) => (
      <pre className="bg-base-200 rounded-lg p-3 overflow-x-auto text-sm border border-base-300" {...props}>
        {children}
      </pre>
    ),
    h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-3 text-base-content">{children}</h1>,
    h2: ({ children }) => <h2 className="text-lg font-semibold mt-4 mb-2 text-base-content">{children}</h2>,
    h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-2 text-base-content">{children}</h3>,
    strong: ({ children }) => <strong className="font-semibold text-base-content">{children}</strong>,
    em: ({ children }) => <em className="italic text-base-content">{children}</em>,
    a: ({ href, children }) => {
      // Defense in depth: sanitize href even though react-markdown is generally safe
      const sanitizedHref = href ? DOMPurify.sanitize(href as string) : '';
      return (
        <a 
          href={sanitizedHref} 
          className="text-primary hover:underline" 
          target="_blank" 
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
    ul: ({ children }) => <ul className="list-disc list-inside ml-4 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside ml-4 space-y-1">{children}</ol>,
    li: ({ children }) => <li className="text-base-content">{children}</li>,
    p: ({ children }) => <p className="mb-2 text-base-content leading-relaxed">{children}</p>,
  };

  return (
    <div className={`bg-base-100 border border-base-300 rounded-lg p-4 ${className}`}>
      <div className="prose prose-sm max-w-none text-base-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={components as Components}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
      
      {shouldFold && !isExpanded && (
        <div className="text-center mt-3 pt-3 border-t border-base-300">
          <button
            onClick={toggleExpanded}
            className="text-xs text-primary hover:underline"
          >
            {`Show ${remainingLines} more lines...`}
          </button>
        </div>
      )}
    </div>
  );
}