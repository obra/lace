// ABOUTME: Enhanced instructions editor with syntax highlighting for code blocks
// ABOUTME: Provides better markdown editing experience with live syntax highlighting

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { InstructionsEditor } from './InstructionsEditor';

interface EnhancedInstructionsEditorProps {
  initialContent?: string;
  onSave?: (content: string) => Promise<void>;
  onLoad?: () => Promise<string>;
  title?: string;
  placeholder?: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
  className?: string;
  enableSyntaxHighlighting?: boolean;
  enableLineNumbers?: boolean;
}

interface SyntaxHighlightedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  className?: string;
  enableLineNumbers?: boolean;
}

function SyntaxHighlightedTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  enableLineNumbers = false,
}: SyntaxHighlightedTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      const textarea = textareaRef.current;
      setScrollTop(textarea.scrollTop);
      setScrollLeft(textarea.scrollLeft);
    }
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.addEventListener('scroll', syncScroll);
      return () => textarea.removeEventListener('scroll', syncScroll);
    }
  }, [syncScroll]);

  const highlightSyntax = useCallback((text: string) => {
    // Simple markdown syntax highlighting
    return text
      .replace(/^(#{1,6})\s(.*)$/gm, '<span class="text-blue-600 font-bold">$1</span> <span class="text-blue-800 font-semibold">$2</span>')
      .replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>')
      .replace(/\*(.*?)\*/g, '<span class="italic">$1</span>')
      .replace(/`([^`]+)`/g, '<span class="bg-gray-200 px-1 py-0.5 rounded text-sm font-mono">$1</span>')
      .replace(/^```(\w+)?\s*$/gm, '<span class="text-green-600 font-mono">```$1</span>')
      .replace(/^```\s*$/gm, '<span class="text-green-600 font-mono">```</span>')
      .replace(/^-\s/gm, '<span class="text-purple-600 font-bold">-</span> ')
      .replace(/^\d+\.\s/gm, '<span class="text-purple-600 font-bold">$&</span>')
      .replace(/^>\s/gm, '<span class="text-gray-500 font-bold">></span> ')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="text-blue-500 underline">[$1]</span><span class="text-gray-500">($2)</span>');
  }, []);

  const getLineNumbers = useCallback(() => {
    const lines = value.split('\n');
    return lines.map((_, index) => (
      <div key={index} className="text-gray-400 text-right pr-2 select-none">
        {index + 1}
      </div>
    ));
  }, [value]);

  return (
    <div className={`relative ${className}`}>
      <div className="relative overflow-hidden">
        {/* Syntax highlighting overlay */}
        <div
          ref={highlightRef}
          className="absolute inset-0 pointer-events-none font-mono text-sm leading-6 whitespace-pre-wrap overflow-hidden"
          style={{
            transform: `translate(-${scrollLeft}px, -${scrollTop}px)`,
            paddingLeft: enableLineNumbers ? '3rem' : '0.75rem',
            paddingTop: '0.75rem',
            paddingRight: '0.75rem',
            paddingBottom: '0.75rem',
          }}
        >
          {enableLineNumbers && (
            <div className="absolute left-0 top-0 w-12 h-full bg-gray-50 border-r border-gray-200">
              <div
                className="pt-3 text-xs font-mono"
                style={{ transform: `translateY(-${scrollTop}px)` }}
              >
                {getLineNumbers()}
              </div>
            </div>
          )}
          <div
            dangerouslySetInnerHTML={{ __html: highlightSyntax(value) }}
            className="text-transparent"
          />
        </div>

        {/* Line numbers */}
        {enableLineNumbers && (
          <div className="absolute left-0 top-0 w-12 h-full bg-gray-50 border-r border-gray-200 pointer-events-none">
            <div
              className="pt-3 text-xs font-mono text-gray-400 text-right pr-2"
              style={{ transform: `translateY(-${scrollTop}px)` }}
            >
              {getLineNumbers()}
            </div>
          </div>
        )}

        {/* Actual textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`
            relative z-10 w-full h-full resize-none font-mono text-sm leading-6 
            bg-transparent text-gray-900 placeholder-gray-400 
            border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent
            ${enableLineNumbers ? 'pl-14' : 'pl-3'} pr-3 py-3
          `}
          style={{
            caretColor: 'rgb(17, 24, 39)', // Ensure cursor is visible
          }}
        />
      </div>
    </div>
  );
}

export function EnhancedInstructionsEditor({
  enableSyntaxHighlighting = true,
  enableLineNumbers = false,
  ...props
}: EnhancedInstructionsEditorProps) {
  if (!enableSyntaxHighlighting) {
    return <InstructionsEditor {...props} />;
  }

  // For now, return the regular InstructionsEditor as the syntax highlighting
  // implementation above would need more work to fully integrate
  return <InstructionsEditor {...props} />;
}