// ABOUTME: Simple inline code component with optional syntax highlighting
// ABOUTME: Used for short code snippets within text content

'use client';

import React from 'react';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

interface InlineCodeProps {
  code: string;
  language?: string;
  className?: string;
  enableHighlighting?: boolean;
}

export default function InlineCode({
  code,
  language,
  className = '',
  enableHighlighting = false,
}: InlineCodeProps) {
  // Simple syntax highlighting similar to CodeBlock
  const getHighlightedCode = () => {
    if (!enableHighlighting || !language || !code.trim()) {
      return code;
    }

    try {
      const result = hljs.highlight(code, { language });
      return DOMPurify.sanitize(result.value);
    } catch {
      // Fallback to auto-detection
      try {
        const result = hljs.highlightAuto(code);
        return DOMPurify.sanitize(result.value);
      } catch {
        return code;
      }
    }
  };

  const highlightedCode = getHighlightedCode();
  const shouldRenderAsHtml = enableHighlighting && language && highlightedCode !== code;

  if (shouldRenderAsHtml) {
    return (
      <code
        className={`inline-code ${className}`}
        dangerouslySetInnerHTML={{ __html: highlightedCode }}
      />
    );
  }

  return <code className={`inline-code ${className}`}>{code}</code>;
}
