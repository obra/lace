// ABOUTME: Simple inline code component with optional syntax highlighting
// ABOUTME: Used for short code snippets within text content

'use client';

import React, { useState, useEffect } from 'react';
import { syntaxHighlighting, type HighlightResult } from '~/lib/syntax-highlighting';

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
  const [highlightResult, setHighlightResult] = useState<HighlightResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enableHighlighting || !language || !code.trim()) {
      return;
    }

    let isCancelled = false;
    setIsLoading(true);

    const highlightCode = async () => {
      try {
        await syntaxHighlighting.initialize();
        const result = await syntaxHighlighting.highlightCode(code, language);
        
        if (!isCancelled) {
          setHighlightResult(result);
        }
      } catch (err) {
        if (!isCancelled) {
          // Fallback to plain text
          setHighlightResult({ highlighted: code, language: 'plaintext', success: false });
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    highlightCode();

    return () => {
      isCancelled = true;
    };
  }, [code, language, enableHighlighting]);

  if (isLoading) {
    return (
      <code className={`inline-code ${className}`}>
        {code}
      </code>
    );
  }

  if (enableHighlighting && highlightResult && highlightResult.language !== 'plaintext') {
    return (
      <code 
        className={`inline-code ${className}`}
        dangerouslySetInnerHTML={{ __html: highlightResult.highlighted }}
      />
    );
  }

  return (
    <code className={`inline-code ${className}`}>
      {code}
    </code>
  );
}