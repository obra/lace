// ABOUTME: Simple code block component with syntax highlighting for web interface
// ABOUTME: Uses highlight.js with CSS theme integration, no complex theme management

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck, faExpand, faCompress } from '@/lib/fontawesome';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  startLineNumber?: number;
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
  startLineNumber = 1,
  showCopyButton = true,
  showLanguageLabel = false,
  showHeader = true,
  maxHeight = '400px',
  className = '',
  onCopy,
  collapsed = false,
  collapsible = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!collapsed);

  // Safe sanitizer function that works in both client and server environments
  const safeSanitize = (html: string): string => {
    if (typeof window !== 'undefined' && DOMPurify?.sanitize) {
      return DOMPurify.sanitize(html);
    }
    // Fallback for server-side rendering - just return the html without sanitization
    // This is safe for syntax highlighting since hljs output is controlled
    return html;
  };

  // Simple syntax highlighting
  const highlightCode = (code: string, lang?: string) => {
    // Try to detect language from filename if no language provided
    if (!lang && filename) {
      const ext = filename.split('.').pop()?.toLowerCase();
      // Map common extensions to highlight.js language names
      const extMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        cpp: 'cpp',
        c: 'c',
        h: 'c',
        hpp: 'cpp',
        java: 'java',
        cs: 'csharp',
        php: 'php',
        swift: 'swift',
        kt: 'kotlin',
        sh: 'bash',
        yml: 'yaml',
        yaml: 'yaml',
        json: 'json',
        xml: 'xml',
        html: 'html',
        css: 'css',
        scss: 'scss',
        sass: 'sass',
        less: 'less',
        sql: 'sql',
        md: 'markdown',
      };
      lang = extMap[ext || ''];
    }

    if (!lang) {
      try {
        const result = hljs.highlightAuto(code);
        return { value: result.value, language: result.language || 'plaintext' };
      } catch (e) {
        return { value: code, language: 'plaintext' };
      }
    }

    try {
      // Format JSON if it's JSON
      let codeToHighlight = code;
      if (lang === 'json' || code.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(code) as unknown;
          codeToHighlight = JSON.stringify(parsed, null, 2);
        } catch {
          // Keep original if not valid JSON
        }
      }

      const result = hljs.highlight(codeToHighlight, { language: lang });
      return { value: result.value, language: result.language || lang };
    } catch (e) {
      // Fallback to auto-detection or plain text
      try {
        const result = hljs.highlightAuto(code);
        return { value: result.value, language: result.language || 'plaintext' };
      } catch {
        return { value: code, language: 'plaintext' };
      }
    }
  };

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
    setTimeout(() => setCopied(false), 2000);
  };

  const renderLineNumbers = (lines: string[]) => {
    if (!showLineNumbers) return null;

    return (
      <div className="line-numbers">
        {lines.map((_, index) => (
          <div key={index} className="text-right">
            {startLineNumber + index}
          </div>
        ))}
      </div>
    );
  };

  const highlightResult = highlightCode(code, language);
  const lines = highlightResult.value.split('\n');
  const detectedLanguage = highlightResult.language;
  const displayLanguage = detectedLanguage === 'plaintext' ? 'text' : detectedLanguage;

  return (
    <div className={`code-block ${className}`}>
      {showHeader && (
        <div className="code-block-header">
          <div className="flex items-center gap-2">
            {filename && <span className="text-sm font-mono text-base-content/80">{filename}</span>}
            {showLanguageLabel && <span className="code-block-language">{displayLanguage}</span>}
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
        <div className="code-block-content" style={{ maxHeight }}>
          <div className="font-mono text-sm">
            <div className="code-line">
              {showLineNumbers && renderLineNumbers(lines)}
              <div className="code-line-content">
                {detectedLanguage === 'plaintext' ? (
                  <pre className="whitespace-pre-wrap p-4">{code}</pre>
                ) : (
                  <code
                    className="hljs"
                    dangerouslySetInnerHTML={{ __html: safeSanitize(highlightResult.value) }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
