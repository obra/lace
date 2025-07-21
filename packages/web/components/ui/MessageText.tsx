'use client';

import React, { useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify';
import CodeBlock from './CodeBlock';
import InlineCode from './InlineCode';

interface MessageTextProps {
  content: string;
  className?: string;
}

interface ContentPart {
  type: 'text' | 'code-block' | 'inline-code';
  content: string;
  language?: string;
}

export default function MessageText({ content, className = '' }: MessageTextProps) {
  const processInlineCode = useCallback((text: string): ContentPart[] => {
    const parts: ContentPart[] = [];
    let currentIndex = 0;
    
    const inlineCodeRegex = /`([^`]+)`/g;
    let match;
    
    while ((match = inlineCodeRegex.exec(text)) !== null) {
      // Add text before inline code
      if (match.index > currentIndex) {
        const textContent = text.slice(currentIndex, match.index);
        if (textContent) {
          parts.push({ type: 'text', content: textContent });
        }
      }
      
      // Add inline code
      parts.push({ type: 'inline-code', content: match[1] });
      currentIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (currentIndex < text.length) {
      const remainingText = text.slice(currentIndex);
      if (remainingText) {
        parts.push({ type: 'text', content: remainingText });
      }
    }
    
    return parts.length > 0 ? parts : [{ type: 'text', content: text }];
  }, []);

  const parsedContent = useMemo(() => {
    const parts: ContentPart[] = [];
    let currentIndex = 0;
    
    // First pass: Extract code blocks
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const codeBlockMatches: Array<{
      match: RegExpExecArray;
      language: string;
      code: string;
    }> = [];
    
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      codeBlockMatches.push({
        match,
        language: match[1] || 'text',
        code: match[2].trim(),
      });
    }
    
    // Sort matches by index to process them in order
    codeBlockMatches.sort((a, b) => a.match.index - b.match.index);
    
    // Process content with code blocks
    for (const { match, language, code } of codeBlockMatches) {
      // Add text before code block
      if (match.index > currentIndex) {
        const textContent = content.slice(currentIndex, match.index);
        if (textContent) {
          parts.push({ type: 'text', content: textContent });
        }
      }
      
      // Add code block
      parts.push({ type: 'code-block', content: code, language });
      currentIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (currentIndex < content.length) {
      const remainingText = content.slice(currentIndex);
      if (remainingText) {
        parts.push({ type: 'text', content: remainingText });
      }
    }
    
    // Second pass: Process inline code in text parts
    const processedParts: ContentPart[] = [];
    
    for (const part of parts) {
      if (part.type === 'text') {
        const textParts = processInlineCode(part.content);
        processedParts.push(...textParts);
      } else {
        processedParts.push(part);
      }
    }
    
    return processedParts;
  }, [content, processInlineCode]);

  const formatTextContent = (text: string) => {
    // Convert newlines to <br> tags and sanitize HTML
    const withBreaks = text.replace(/\n/g, '<br>');
    return DOMPurify.sanitize(withBreaks);
  };

  return (
    <div className={`text-sm leading-relaxed text-base-content ${className}`}>
      {parsedContent.map((part, index) => {
        switch (part.type) {
          case 'code-block':
            return (
              <div key={index} className="my-2">
                <CodeBlock
                  code={part.content}
                  language={part.language}
                  showLineNumbers={false}
                  showHeader={true}
                  maxHeight="400px"
                />
              </div>
            );
          
          case 'inline-code':
            return (
              <InlineCode
                key={index}
                code={part.content}
                enableHighlighting={false}
              />
            );
          
          case 'text':
          default:
            return (
              <span
                key={index}
                dangerouslySetInnerHTML={{
                  __html: formatTextContent(part.content),
                }}
              />
            );
        }
      })}
    </div>
  );
}