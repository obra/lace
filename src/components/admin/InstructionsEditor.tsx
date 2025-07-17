// ABOUTME: Comprehensive instructions editor component with markdown support
// ABOUTME: Provides rich text editing, live preview, auto-save, and template system

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  DocumentTextIcon, 
  EyeIcon, 
  EyeSlashIcon, 
  ArrowDownTrayIcon, 
  ArrowUpTrayIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  MagnifyingGlassIcon,
  DocumentDuplicateIcon,
  Bars3Icon,
  CodeBracketIcon,
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListBulletIcon,
  NumberedListIcon,
  QuoteIcon,
  TableCellsIcon
} from '@heroicons/react/24/outline';
import { marked } from 'marked';

interface InstructionsEditorProps {
  initialContent?: string;
  onSave?: (content: string) => Promise<void>;
  onLoad?: () => Promise<string>;
  title?: string;
  placeholder?: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
  className?: string;
}

interface EditorState {
  content: string;
  isDirty: boolean;
  lastSaved: Date | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  previewMode: boolean;
  splitView: boolean;
}

interface UndoRedoState {
  history: string[];
  currentIndex: number;
  maxHistorySize: number;
}

interface SearchState {
  isOpen: boolean;
  query: string;
  replaceQuery: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  currentMatch: number;
  totalMatches: number;
}

const MARKDOWN_TEMPLATES = {
  'Basic Instructions': `# Instructions

## Overview
Brief description of what this instruction set covers.

## Guidelines
- Key guideline 1
- Key guideline 2
- Key guideline 3

## Examples
\`\`\`
Example code or usage
\`\`\`

## Notes
Additional notes or considerations.`,
  
  'Code Review Guidelines': `# Code Review Guidelines

## Standards
- Follow TypeScript strict mode
- Use meaningful variable names
- Write comprehensive tests
- Document complex logic

## Patterns to Follow
- Event-driven architecture
- Immutable data structures
- Error handling with structured errors
- Dependency injection

## Patterns to Avoid
- Using 'any' type
- Side effects in pure functions
- Global state mutations
- Unhandled promise rejections`,
  
  'API Documentation': `# API Documentation

## Endpoints

### GET /api/endpoint
\`\`\`typescript
interface Response {
  data: any[];
  status: 'success' | 'error';
  message?: string;
}
\`\`\`

**Parameters:**
- \`param1\` (string): Description
- \`param2\` (number, optional): Description

**Response:**
- 200: Success
- 400: Bad Request
- 500: Server Error`,
  
  'Project Setup': `# Project Setup Instructions

## Prerequisites
- Node.js 18+
- npm or yarn
- TypeScript 5.0+

## Installation
\`\`\`bash
npm install
npm run build
npm start
\`\`\`

## Configuration
1. Copy \`.env.example\` to \`.env\`
2. Fill in required environment variables
3. Run initial setup: \`npm run setup\`

## Development
- \`npm run dev\` - Start development server
- \`npm test\` - Run tests
- \`npm run lint\` - Check code style`
};

export function InstructionsEditor({
  initialContent = '',
  onSave,
  onLoad,
  title = 'Instructions Editor',
  placeholder = 'Enter your instructions here...',
  autoSave = true,
  autoSaveDelay = 2000,
  className = '',
}: InstructionsEditorProps) {
  const [state, setState] = useState<EditorState>({
    content: initialContent,
    isDirty: false,
    lastSaved: null,
    isLoading: false,
    isSaving: false,
    error: null,
    previewMode: false,
    splitView: false,
  });

  const [undoRedo, setUndoRedo] = useState<UndoRedoState>({
    history: [initialContent],
    currentIndex: 0,
    maxHistorySize: 50,
  });

  const [search, setSearch] = useState<SearchState>({
    isOpen: false,
    query: '',
    replaceQuery: '',
    caseSensitive: false,
    wholeWord: false,
    currentMatch: 0,
    totalMatches: 0,
  });

  const [showTemplates, setShowTemplates] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();

  // Auto-save functionality
  useEffect(() => {
    if (!autoSave || !onSave || !state.isDirty) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, autoSaveDelay);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [state.content, state.isDirty, autoSave, autoSaveDelay, onSave]);

  // Load initial content
  useEffect(() => {
    if (onLoad) {
      loadContent();
    }
  }, [onLoad]);

  const loadContent = useCallback(async () => {
    if (!onLoad) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const content = await onLoad();
      setState(prev => ({ 
        ...prev, 
        content, 
        isDirty: false, 
        isLoading: false,
        lastSaved: new Date()
      }));
      addToHistory(content);
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to load content',
        isLoading: false
      }));
    }
  }, [onLoad]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setState(prev => ({ ...prev, isSaving: true, error: null }));
    try {
      await onSave(state.content);
      setState(prev => ({ 
        ...prev, 
        isDirty: false, 
        isSaving: false,
        lastSaved: new Date()
      }));
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Failed to save content',
        isSaving: false
      }));
    }
  }, [onSave, state.content]);

  const addToHistory = useCallback((content: string) => {
    setUndoRedo(prev => {
      const newHistory = prev.history.slice(0, prev.currentIndex + 1);
      newHistory.push(content);
      
      if (newHistory.length > prev.maxHistorySize) {
        newHistory.shift();
      }
      
      return {
        ...prev,
        history: newHistory,
        currentIndex: newHistory.length - 1,
      };
    });
  }, []);

  const handleContentChange = useCallback((newContent: string) => {
    setState(prev => ({ ...prev, content: newContent, isDirty: true }));
    
    // Add to history for undo/redo (debounced)
    const timeoutId = setTimeout(() => {
      addToHistory(newContent);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [addToHistory]);

  const handleUndo = useCallback(() => {
    if (undoRedo.currentIndex > 0) {
      const newIndex = undoRedo.currentIndex - 1;
      const content = undoRedo.history[newIndex];
      setState(prev => ({ ...prev, content, isDirty: true }));
      setUndoRedo(prev => ({ ...prev, currentIndex: newIndex }));
    }
  }, [undoRedo.currentIndex, undoRedo.history]);

  const handleRedo = useCallback(() => {
    if (undoRedo.currentIndex < undoRedo.history.length - 1) {
      const newIndex = undoRedo.currentIndex + 1;
      const content = undoRedo.history[newIndex];
      setState(prev => ({ ...prev, content, isDirty: true }));
      setUndoRedo(prev => ({ ...prev, currentIndex: newIndex }));
    }
  }, [undoRedo.currentIndex, undoRedo.history]);

  const insertMarkdown = useCallback((markdown: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = state.content;
    const before = text.substring(0, start);
    const after = text.substring(end);
    const newContent = before + markdown + after;

    handleContentChange(newContent);
    
    // Set cursor position after insertion
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + markdown.length, start + markdown.length);
    }, 0);
  }, [state.content, handleContentChange]);

  const insertTemplate = useCallback((template: string) => {
    setState(prev => ({ ...prev, content: template, isDirty: true }));
    addToHistory(template);
    setShowTemplates(false);
  }, [addToHistory]);

  const exportContent = useCallback(() => {
    const blob = new Blob([state.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'instructions.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state.content]);

  const importContent = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setState(prev => ({ ...prev, content, isDirty: true }));
      addToHistory(content);
    };
    reader.readAsText(file);
  }, [addToHistory]);

  const renderPreview = useCallback(() => {
    try {
      const html = marked(state.content);
      return { __html: html };
    } catch (error) {
      return { __html: '<p>Error rendering preview</p>' };
    }
  }, [state.content]);

  const formatLastSaved = useCallback(() => {
    if (!state.lastSaved) return 'Never';
    
    const now = new Date();
    const diff = now.getTime() - state.lastSaved.getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    
    return state.lastSaved.toLocaleDateString();
  }, [state.lastSaved]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey) {
      switch (event.key) {
        case 's':
          event.preventDefault();
          handleSave();
          break;
        case 'z':
          event.preventDefault();
          if (event.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
          break;
        case 'f':
          event.preventDefault();
          setSearch(prev => ({ ...prev, isOpen: !prev.isOpen }));
          break;
        case 'b':
          event.preventDefault();
          insertMarkdown('**bold**');
          break;
        case 'i':
          event.preventDefault();
          insertMarkdown('*italic*');
          break;
      }
    }
  }, [handleSave, handleUndo, handleRedo, insertMarkdown]);

  return (
    <div className={`instructions-editor ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-base-100 border-b border-base-300">
        <div className="flex items-center gap-4">
          <DocumentTextIcon className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">{title}</h1>
          {state.isDirty && (
            <div className="flex items-center gap-2 text-sm text-warning">
              <ExclamationTriangleIcon className="w-4 h-4" />
              Unsaved changes
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Save Status */}
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            {state.isSaving ? (
              <>
                <ClockIcon className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircleIcon className="w-4 h-4" />
                {formatLastSaved()}
              </>
            )}
          </div>
          
          {/* Action Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={undoRedo.currentIndex <= 0}
              className="btn btn-sm btn-ghost"
              title="Undo (Ctrl+Z)"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={undoRedo.currentIndex >= undoRedo.history.length - 1}
              className="btn btn-sm btn-ghost"
              title="Redo (Ctrl+Shift+Z)"
            >
              <ArrowUturnRightIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSearch(prev => ({ ...prev, isOpen: !prev.isOpen }))}
              className="btn btn-sm btn-ghost"
              title="Search (Ctrl+F)"
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="btn btn-sm btn-ghost"
              title="Templates"
            >
              <DocumentDuplicateIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 bg-base-200 border-b border-base-300">
        <div className="flex items-center gap-1">
          <button
            onClick={() => insertMarkdown('**bold**')}
            className="btn btn-xs btn-ghost"
            title="Bold (Ctrl+B)"
          >
            <BoldIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => insertMarkdown('*italic*')}
            className="btn btn-xs btn-ghost"
            title="Italic (Ctrl+I)"
          >
            <ItalicIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => insertMarkdown('[link](url)')}
            className="btn btn-xs btn-ghost"
            title="Link"
          >
            <LinkIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => insertMarkdown('`code`')}
            className="btn btn-xs btn-ghost"
            title="Code"
          >
            <CodeBracketIcon className="w-3 h-3" />
          </button>
        </div>
        
        <div className="w-px h-4 bg-base-300" />
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => insertMarkdown('- ')}
            className="btn btn-xs btn-ghost"
            title="Bullet List"
          >
            <ListBulletIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => insertMarkdown('1. ')}
            className="btn btn-xs btn-ghost"
            title="Numbered List"
          >
            <NumberedListIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => insertMarkdown('> ')}
            className="btn btn-xs btn-ghost"
            title="Quote"
          >
            <QuoteIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => insertMarkdown('| Column 1 | Column 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |')}
            className="btn btn-xs btn-ghost"
            title="Table"
          >
            <TableCellsIcon className="w-3 h-3" />
          </button>
        </div>
        
        <div className="w-px h-4 bg-base-300" />
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => setState(prev => ({ ...prev, splitView: !prev.splitView }))}
            className={`btn btn-xs btn-ghost ${state.splitView ? 'btn-active' : ''}`}
            title="Split View"
          >
            <Bars3Icon className="w-3 h-3" />
          </button>
          <button
            onClick={() => setState(prev => ({ ...prev, previewMode: !prev.previewMode }))}
            className={`btn btn-xs btn-ghost ${state.previewMode ? 'btn-active' : ''}`}
            title="Preview Mode"
          >
            {state.previewMode ? <EyeSlashIcon className="w-3 h-3" /> : <EyeIcon className="w-3 h-3" />}
          </button>
        </div>
        
        <div className="w-px h-4 bg-base-300" />
        
        <div className="flex items-center gap-1">
          <label className="btn btn-xs btn-ghost cursor-pointer" title="Import">
            <ArrowUpTrayIcon className="w-3 h-3" />
            <input
              type="file"
              accept=".md,.txt"
              onChange={importContent}
              className="hidden"
            />
          </label>
          <button
            onClick={exportContent}
            className="btn btn-xs btn-ghost"
            title="Export"
          >
            <ArrowDownTrayIcon className="w-3 h-3" />
          </button>
        </div>
        
        <div className="ml-auto">
          <button
            onClick={handleSave}
            disabled={!state.isDirty || state.isSaving}
            className="btn btn-xs btn-primary"
          >
            {state.isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {state.error && (
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>{state.error}</span>
          <button
            onClick={() => setState(prev => ({ ...prev, error: null }))}
            className="btn btn-sm btn-ghost"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Templates Panel */}
      {showTemplates && (
        <div className="p-4 bg-base-200 border-b border-base-300">
          <h3 className="font-semibold mb-2">Templates</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(MARKDOWN_TEMPLATES).map(([name, template]) => (
              <button
                key={name}
                onClick={() => insertTemplate(template)}
                className="btn btn-sm btn-outline"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="flex-1 flex" style={{ height: 'calc(100vh - 200px)' }}>
        {/* Editor */}
        {(!state.previewMode || state.splitView) && (
          <div className={`flex-1 ${state.splitView ? 'w-1/2' : 'w-full'}`}>
            <textarea
              ref={textareaRef}
              value={state.content}
              onChange={(e) => handleContentChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="textarea textarea-bordered w-full h-full resize-none font-mono text-sm"
              style={{ borderRadius: 0 }}
            />
          </div>
        )}
        
        {/* Preview */}
        {(state.previewMode || state.splitView) && (
          <div className={`flex-1 ${state.splitView ? 'w-1/2 border-l border-base-300' : 'w-full'}`}>
            <div className="p-4 h-full overflow-y-auto bg-base-100">
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={renderPreview()}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}