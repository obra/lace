// ABOUTME: Generalized code syntax highlighting component using highlight.js for terminal display
// ABOUTME: Supports JSON, bash, python, javascript and other languages with fallback to plain text

import React from 'react';
import { Text } from 'ink';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';

// Register common languages
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);

interface CodeDisplayProps {
  code: string;
  language?: string;
  compact?: boolean;
}

export function CodeDisplay({ code, language = 'text', compact = false }: CodeDisplayProps) {
  // Format JSON if it's JSON and not compact
  let displayCode = code;
  if (language === 'json') {
    try {
      const parsed = JSON.parse(code) as unknown;
      displayCode = JSON.stringify(parsed, null, compact ? 0 : 2);
    } catch {
      // Keep original if not valid JSON
    }
  }

  // Handle plain text directly without highlighting to avoid stderr output
  if (language === 'text' || language === 'plain') {
    return <Text color="white">{displayCode}</Text>;
  }

  try {
    const highlighted = hljs.highlight(displayCode, { language });
    return renderHighlightedCode(highlighted.value);
  } catch (error) {
    // Fallback to plain text if language not supported or highlighting fails
    return <Text color="white">{displayCode}</Text>;
  }
}

function renderHighlightedCode(highlightedHtml: string): React.ReactElement {
  // Convert highlight.js HTML output to Ink Text components
  const lines = highlightedHtml.split('\n');

  return (
    <React.Fragment>
      {lines.map((line, lineIndex) => (
        <Text key={lineIndex}>
          {parseHighlightedLine(line)}
          {lineIndex < lines.length - 1 ? '\n' : ''}
        </Text>
      ))}
    </React.Fragment>
  );
}

function parseHighlightedLine(line: string): React.ReactNode {
  // Decode HTML entities first
  const decodedLine = line
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
  // Map highlight.js CSS classes to Ink colors
  if (className.includes('string')) return 'green';
  if (className.includes('number')) return 'yellow';
  if (className.includes('keyword')) return 'blue';
  if (className.includes('literal')) return 'cyan';
  if (className.includes('comment')) return 'gray';
  if (className.includes('attr')) return 'cyan';
  if (className.includes('title')) return 'magenta';
  if (className.includes('built_in')) return 'blue';
  if (className.includes('variable')) return 'yellow';
  if (className.includes('operator')) return 'white';

  return 'white'; // Default
}
