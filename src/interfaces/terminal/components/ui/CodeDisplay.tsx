// ABOUTME: Enhanced code syntax highlighting component using comprehensive syntax highlighting service
// ABOUTME: Supports many languages with lazy loading, auto-detection, and proper error handling

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { syntaxHighlighting, type HighlightResult } from '~/lib/syntax-highlighting.js';

interface CodeDisplayProps {
  code: string;
  language?: string;
  compact?: boolean;
  filename?: string;
  showLineNumbers?: boolean;
  maxLines?: number;
}

export function CodeDisplay({ 
  code, 
  language, 
  compact = false, 
  filename,
  showLineNumbers = false,
  maxLines = 1000 
}: CodeDisplayProps) {
  const [highlightResult, setHighlightResult] = useState<HighlightResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const highlightCode = async () => {
      if (!code.trim()) {
        setHighlightResult({ highlighted: code, language: 'plaintext', success: true });
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Initialize the service if not already done
        await syntaxHighlighting.initialize();

        // Format JSON if it's JSON and not compact
        let displayCode = code;
        if (language === 'json' || (!language && code.trim().startsWith('{'))) {
          try {
            const parsed = JSON.parse(code);
            displayCode = JSON.stringify(parsed, null, compact ? 0 : 2);
          } catch {
            // Keep original if not valid JSON
          }
        }

        // Truncate if too long
        if (displayCode.split('\n').length > maxLines) {
          const lines = displayCode.split('\n');
          displayCode = lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
        }

        const result = await syntaxHighlighting.highlightCode(displayCode, language, filename);
        
        if (!isCancelled) {
          setHighlightResult(result);
        }
      } catch (err) {
        if (!isCancelled) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError(errorMessage);
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
  }, [code, language, filename, compact, maxLines]);

  if (isLoading) {
    return <Text color="gray">Highlighting code...</Text>;
  }

  if (error) {
    return (
      <>
        <Text color="red">Error highlighting code: {error}</Text>
        <Text color="white">{code}</Text>
      </>
    );
  }

  if (!highlightResult) {
    return <Text color="white">{code}</Text>;
  }

  // Handle plain text directly without highlighting
  if (highlightResult.language === 'plaintext' || highlightResult.language === 'text') {
    return <Text color="white">{highlightResult.highlighted}</Text>;
  }

  return renderHighlightedCode(highlightResult.highlighted, showLineNumbers);
}

function renderHighlightedCode(highlightedHtml: string, showLineNumbers = false): React.ReactElement {
  // Convert highlight.js HTML output to Ink Text components
  const lines = highlightedHtml.split('\n');

  return (
    <React.Fragment>
      {lines.map((line, lineIndex) => (
        <Text key={lineIndex}>
          {showLineNumbers && (
            <Text color="gray">{String(lineIndex + 1).padStart(3, ' ')} | </Text>
          )}
          {parseHighlightedLine(line)}
          {lineIndex < lines.length - 1 ? '\n' : ''}
        </Text>
      ))}
    </React.Fragment>
  );
}

function parseHighlightedLine(line: string): React.ReactNode {
  // Decode HTML entities first
  let decodedLine = line
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'");

  // Parse highlight.js HTML and convert to Ink colors
  const parts: React.ReactNode[] = [];
  let currentIndex = 0;

  // Match HTML tags with their content
  const tagRegex = /<span class="([^"]*)"[^>]*>([^<]*)<\/span>/g;
  let match;

  while ((match = tagRegex.exec(decodedLine)) !== null) {
    // Add text before the tag
    if (match.index > currentIndex) {
      const beforeText = decodedLine.slice(currentIndex, match.index);
      if (beforeText) {
        parts.push(
          <Text key={`before-${currentIndex}`} color="white">
            {beforeText}
          </Text>
        );
      }
    }

    // Add the colored content based on highlight.js class
    const className = match[1];
    const content = match[2];
    const color = getColorForClass(className);

    parts.push(
      <Text key={`highlight-${match.index}`} color={color}>
        {content}
      </Text>
    );

    currentIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (currentIndex < decodedLine.length) {
    const remainingText = decodedLine.slice(currentIndex);
    if (remainingText) {
      parts.push(
        <Text key={`remaining-${currentIndex}`} color="white">
          {remainingText}
        </Text>
      );
    }
  }

  return parts.length > 0 ? parts : decodedLine.replace(/<[^>]*>/g, ''); // Strip any remaining HTML
}

function getColorForClass(className: string): string {
  // Enhanced mapping of highlight.js CSS classes to Ink colors
  // String literals
  if (className.includes('string')) return 'green';
  
  // Numbers and numeric literals
  if (className.includes('number')) return 'yellow';
  
  // Keywords and language constructs
  if (className.includes('keyword')) return 'blue';
  if (className.includes('built_in')) return 'blue';
  if (className.includes('type')) return 'blue';
  
  // Literals and constants
  if (className.includes('literal')) return 'cyan';
  if (className.includes('boolean')) return 'cyan';
  if (className.includes('null')) return 'cyan';
  if (className.includes('undefined')) return 'cyan';
  
  // Comments
  if (className.includes('comment')) return 'gray';
  if (className.includes('quote')) return 'gray';
  
  // Attributes and properties
  if (className.includes('attr')) return 'cyan';
  if (className.includes('property')) return 'cyan';
  if (className.includes('attribute')) return 'cyan';
  
  // Function and class names
  if (className.includes('title')) return 'magenta';
  if (className.includes('function')) return 'magenta';
  if (className.includes('class')) return 'magenta';
  
  // Variables and identifiers
  if (className.includes('variable')) return 'yellow';
  if (className.includes('name')) return 'yellow';
  if (className.includes('identifier')) return 'yellow';
  
  // Operators and punctuation
  if (className.includes('operator')) return 'white';
  if (className.includes('punctuation')) return 'white';
  
  // Tags (HTML/XML)
  if (className.includes('tag')) return 'blue';
  if (className.includes('tag-name')) return 'blue';
  
  // Special highlighting
  if (className.includes('emphasis')) return 'white';
  if (className.includes('strong')) return 'white';
  if (className.includes('link')) return 'cyan';
  if (className.includes('code')) return 'green';
  
  // Meta and preprocessor
  if (className.includes('meta')) return 'gray';
  if (className.includes('preprocessor')) return 'gray';
  if (className.includes('pragma')) return 'gray';
  
  // Regular expressions
  if (className.includes('regexp')) return 'red';
  if (className.includes('regex')) return 'red';
  
  // Symbols and special characters
  if (className.includes('symbol')) return 'cyan';
  if (className.includes('char')) return 'green';
  
  // Sections and headers
  if (className.includes('section')) return 'blue';
  if (className.includes('header')) return 'blue';
  
  // Additions and deletions (for diffs)
  if (className.includes('addition')) return 'green';
  if (className.includes('deletion')) return 'red';

  return 'white'; // Default
}
