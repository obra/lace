// ABOUTME: Search and replace component for instructions editor
// ABOUTME: Provides find/replace functionality with regex support

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  XMarkIcon, 
  MagnifyingGlassIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';

interface SearchReplaceProps {
  content: string;
  onContentChange: (content: string) => void;
  onClose: () => void;
  isOpen: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

interface SearchState {
  query: string;
  replaceQuery: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  currentMatch: number;
  matches: Array<{ start: number; end: number; text: string }>;
}

export function SearchReplace({
  content,
  onContentChange,
  onClose,
  isOpen,
  textareaRef,
}: SearchReplaceProps) {
  const [state, setState] = useState<SearchState>({
    query: '',
    replaceQuery: '',
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    currentMatch: 0,
    matches: [],
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Find matches when query or content changes
  useEffect(() => {
    if (!state.query || !content) {
      setState(prev => ({ ...prev, matches: [], currentMatch: 0 }));
      return;
    }

    const matches = findMatches(content, state.query, {
      caseSensitive: state.caseSensitive,
      wholeWord: state.wholeWord,
      useRegex: state.useRegex,
    });

    setState(prev => ({
      ...prev,
      matches,
      currentMatch: matches.length > 0 ? 0 : -1,
    }));
  }, [content, state.query, state.caseSensitive, state.wholeWord, state.useRegex]);

  // Highlight current match in textarea
  useEffect(() => {
    if (textareaRef?.current && state.matches.length > 0 && state.currentMatch >= 0) {
      const match = state.matches[state.currentMatch];
      if (match) {
        textareaRef.current.setSelectionRange(match.start, match.end);
        textareaRef.current.focus();
      }
    }
  }, [state.currentMatch, state.matches, textareaRef]);

  const findMatches = useCallback((
    text: string,
    query: string,
    options: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
  ) => {
    const matches: Array<{ start: number; end: number; text: string }> = [];
    
    try {
      let regex: RegExp;
      
      if (options.useRegex) {
        const flags = options.caseSensitive ? 'g' : 'gi';
        regex = new RegExp(query, flags);
      } else {
        let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (options.wholeWord) {
          escapedQuery = `\\b${escapedQuery}\\b`;
        }
        const flags = options.caseSensitive ? 'g' : 'gi';
        regex = new RegExp(escapedQuery, flags);
      }

      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        });
        
        // Prevent infinite loop with zero-width matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    } catch (error) {
      // Invalid regex, return no matches
      return [];
    }
    
    return matches;
  }, []);

  const goToNext = useCallback(() => {
    if (state.matches.length === 0) return;
    
    setState(prev => ({
      ...prev,
      currentMatch: (prev.currentMatch + 1) % prev.matches.length,
    }));
  }, [state.matches.length]);

  const goToPrevious = useCallback(() => {
    if (state.matches.length === 0) return;
    
    setState(prev => ({
      ...prev,
      currentMatch: prev.currentMatch <= 0 ? prev.matches.length - 1 : prev.currentMatch - 1,
    }));
  }, [state.matches.length]);

  const replaceCurrent = useCallback(() => {
    if (state.matches.length === 0 || state.currentMatch < 0) return;
    
    const match = state.matches[state.currentMatch];
    const newContent = 
      content.slice(0, match.start) + 
      state.replaceQuery + 
      content.slice(match.end);
    
    onContentChange(newContent);
    
    // Update current match position after replacement
    const lengthDiff = state.replaceQuery.length - match.text.length;
    setState(prev => ({
      ...prev,
      currentMatch: prev.currentMatch < prev.matches.length - 1 ? prev.currentMatch : 0,
    }));
  }, [content, state.matches, state.currentMatch, state.replaceQuery, onContentChange]);

  const replaceAll = useCallback(() => {
    if (state.matches.length === 0) return;
    
    // Replace from end to beginning to maintain correct indices
    let newContent = content;
    for (let i = state.matches.length - 1; i >= 0; i--) {
      const match = state.matches[i];
      newContent = 
        newContent.slice(0, match.start) + 
        state.replaceQuery + 
        newContent.slice(match.end);
    }
    
    onContentChange(newContent);
    
    // Clear search after replace all
    setState(prev => ({
      ...prev,
      query: '',
      matches: [],
      currentMatch: 0,
    }));
  }, [content, state.matches, state.replaceQuery, onContentChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      goToNext();
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      goToPrevious();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.currentTarget === searchInputRef.current) {
        replaceInputRef.current?.focus();
      } else {
        searchInputRef.current?.focus();
      }
    }
  }, [onClose, goToNext, goToPrevious]);

  if (!isOpen) return null;

  return (
    <div className="bg-base-100 border-b border-base-300 p-4 shadow-sm">
      <div className="flex items-center gap-4 max-w-4xl mx-auto">
        {/* Search Input */}
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-base-content/40" />
            <input
              ref={searchInputRef}
              type="text"
              value={state.query}
              onChange={(e) => setState(prev => ({ ...prev, query: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              className="input input-sm w-full pl-10 pr-4 border border-base-300 focus:border-primary"
            />
          </div>
        </div>

        {/* Replace Input */}
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <DocumentTextIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-base-content/40" />
            <input
              ref={replaceInputRef}
              type="text"
              value={state.replaceQuery}
              onChange={(e) => setState(prev => ({ ...prev, replaceQuery: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="Replace..."
              className="input input-sm w-full pl-10 pr-4 border border-base-300 focus:border-primary"
            />
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-2">
          <div className="text-sm text-base-content/60">
            {state.matches.length > 0 
              ? `${state.currentMatch + 1} of ${state.matches.length}`
              : state.query ? 'No matches' : ''
            }
          </div>
          <button
            onClick={goToPrevious}
            disabled={state.matches.length === 0}
            className="btn btn-sm btn-ghost btn-square"
            title="Previous (Shift+Enter)"
          >
            <ArrowUpIcon className="w-4 h-4" />
          </button>
          <button
            onClick={goToNext}
            disabled={state.matches.length === 0}
            className="btn btn-sm btn-ghost btn-square"
            title="Next (Enter)"
          >
            <ArrowDownIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Replace Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={replaceCurrent}
            disabled={state.matches.length === 0 || state.currentMatch < 0}
            className="btn btn-sm btn-outline"
            title="Replace current match"
          >
            Replace
          </button>
          <button
            onClick={replaceAll}
            disabled={state.matches.length === 0}
            className="btn btn-sm btn-outline"
            title="Replace all matches"
          >
            Replace All
          </button>
        </div>

        {/* Options */}
        <div className="flex items-center gap-2">
          <label className="label cursor-pointer">
            <input
              type="checkbox"
              checked={state.caseSensitive}
              onChange={(e) => setState(prev => ({ ...prev, caseSensitive: e.target.checked }))}
              className="checkbox checkbox-sm"
            />
            <span className="label-text ml-2 text-sm">Aa</span>
          </label>
          <label className="label cursor-pointer">
            <input
              type="checkbox"
              checked={state.wholeWord}
              onChange={(e) => setState(prev => ({ ...prev, wholeWord: e.target.checked }))}
              className="checkbox checkbox-sm"
            />
            <span className="label-text ml-2 text-sm">Word</span>
          </label>
          <label className="label cursor-pointer">
            <input
              type="checkbox"
              checked={state.useRegex}
              onChange={(e) => setState(prev => ({ ...prev, useRegex: e.target.checked }))}
              className="checkbox checkbox-sm"
            />
            <span className="label-text ml-2 text-sm">.*</span>
          </label>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="btn btn-sm btn-ghost btn-square"
          title="Close (Escape)"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}