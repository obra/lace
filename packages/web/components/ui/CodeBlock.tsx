// ABOUTME: Advanced code block component with syntax highlighting for web interface
// ABOUTME: Features copy functionality, language detection, line numbers, and theme support

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck, faExpand, faCompress } from '@/lib/fontawesome';
import { syntaxHighlighting, type HighlightResult } from '@/lib/syntax-highlighting';
import { simpleSyntaxThemeManager } from '@/lib/syntax-themes-simple';
import { debounce, isCodeTooLarge } from '@/lib/performance-utils';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  showCopyButton?: boolean;
  showLanguageLabel?: boolean;
  showHeader?: boolean;
  maxHeight?: string;
  className?: string;
  onCopy?: (code: string) => void;
  collapsed?: boolean;
  collapsible?: boolean;
}

export default function CodeBlock({
  code,
  language,
  filename,
  showLineNumbers = false,
  showCopyButton = true,
  showLanguageLabel = true,
  showHeader = true,
  maxHeight = '400px',
  className = '',
  onCopy,
  collapsed = false,
  collapsible = false,
}: CodeBlockProps) {
  const [highlightResult, setHighlightResult] = useState<HighlightResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!collapsed);
  const [themeInitialized, setThemeInitialized] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout>();

  // Debounced highlighting function
  const debouncedHighlight = useRef(
    debounce(async (
      codeToHighlight: string,
      isCancelled: () => boolean,
      lang?: string,
      file?: string
    ) => {
      if (isCancelled()) return;

      setIsLoading(true);
      setError(null);

      try {
        // Initialize services
        await syntaxHighlighting.initialize();
        
        if (!themeInitialized) {
          await simpleSyntaxThemeManager.autoLoadTheme();
          setThemeInitialized(true);
        }

        // Format JSON if it's JSON
        let displayCode = codeToHighlight;
        if (lang === 'json' || (!lang && codeToHighlight.trim().startsWith('{'))) {
          try {
            const parsed = JSON.parse(codeToHighlight);
            displayCode = JSON.stringify(parsed, null, 2);
          } catch {
            // Keep original if not valid JSON
          }
        }

        // Use appropriate highlighting method based on code size
        const result = isCodeTooLarge(displayCode) 
          ? await syntaxHighlighting.highlightLargeCode(displayCode, lang, file)
          : await syntaxHighlighting.highlightCode(displayCode, lang, file);
        
        if (!isCancelled()) {
          setHighlightResult(result);
        }
      } catch (err) {
        if (!isCancelled()) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError(errorMessage);
          // Fallback to plain text
          setHighlightResult({ highlighted: codeToHighlight, language: 'plaintext', success: false });
        }
      } finally {
        if (!isCancelled()) {
          setIsLoading(false);
        }
      }
    }, 300)
  ).current;

  // Initialize syntax highlighting and theme
  useEffect(() => {
    let isCancelled = false;

    const initializeHighlighting = async () => {
      if (!code.trim()) {
        setHighlightResult({ highlighted: code, language: 'plaintext', success: true });
        setIsLoading(false);
        return;
      }

      // Use debounced highlighting for better performance
      debouncedHighlight.current(code, () => isCancelled, language, filename);
    };

    initializeHighlighting();

    return () => {
      isCancelled = true;
      debouncedHighlight.current.cancel();
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, [code, language, filename, themeInitialized, debouncedHighlight]);

  const handleCopy = async () => {
    if (onCopy) {
      onCopy(code);
    } else {
      try {
        await navigator.clipboard.writeText(code);
      } catch (err) {
        console.error('Failed to copy code:', err);
        return;
      }
    }

    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const renderLineNumbers = (lines: string[]) => {
    if (!showLineNumbers) return null;

    return (
      <div className="line-numbers">
        {lines.map((_, index) => (
          <div key={index} className="text-right">
            {index + 1}
          </div>
        ))}
      </div>
    );
  };

  const renderHighlightedCode = (highlighted: string) => {
    const lines = highlighted.split('\n');

    return (
      <div className="code-line">
        {showLineNumbers && renderLineNumbers(lines)}
        <div className="code-line-content">
          <code
            ref={codeRef}
            className="hljs"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </div>
      </div>
    );
  };

  const detectedLanguage = highlightResult?.language || language || 'text';
  const displayLanguage = detectedLanguage === 'plaintext' ? 'text' : detectedLanguage;

  return (
    <div className={`code-block ${className}`}>
      {showHeader && (
        <div className="code-block-header">
          <div className="flex items-center gap-2">
            {filename && (
              <span className="text-sm font-mono text-base-content/80">
                {filename}
              </span>
            )}
            {showLanguageLabel && (
              <span className="code-block-language">
                {displayLanguage}
              </span>
            )}
            {error && (
              <span className="text-xs text-error">
                Highlighting failed
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {collapsible && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs text-base-content/60 hover:text-base-content px-2 py-1 rounded hover:bg-base-200"
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                <FontAwesomeIcon icon={isExpanded ? faCompress : faExpand} className="w-3 h-3" />
              </button>
            )}
            
            {showCopyButton && (
              <button
                onClick={handleCopy}
                className="code-block-copy px-2 py-1 rounded hover:bg-base-200"
                title="Copy code"
              >
                <FontAwesomeIcon 
                  icon={copied ? faCheck : faCopy} 
                  className={`w-3 h-3 ${copied ? 'text-success' : ''}`} 
                />
              </button>
            )}
          </div>
        </div>
      )}

      {isExpanded && (
        <div 
          className="code-block-content"
          style={{ maxHeight }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <div className="loading loading-spinner loading-sm"></div>
              <span className="ml-2 text-sm text-base-content/60">
                Highlighting code...
              </span>
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="text-error text-sm mb-2">
                Failed to highlight code: {error}
              </div>
              <pre className="font-mono text-sm whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          ) : highlightResult ? (
            highlightResult.language === 'plaintext' ? (
              <pre className="font-mono text-sm whitespace-pre-wrap p-4">
                {highlightResult.highlighted}
              </pre>
            ) : (
              <div className="font-mono text-sm">
                {renderHighlightedCode(highlightResult.highlighted)}
              </div>
            )
          ) : (
            <pre className="font-mono text-sm whitespace-pre-wrap p-4">
              {code}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}