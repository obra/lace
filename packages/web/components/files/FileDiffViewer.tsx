// ABOUTME: A professional file diff viewer component for displaying code changes
// ABOUTME: Supports side-by-side and unified diff views with syntax highlighting preparation

import React, { useState, useMemo, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faColumns, faList, faCopy, faExpand, faCompress } from '@/lib/fontawesome';
import { syntaxHighlighting, type HighlightResult } from '@/lib/syntax-highlighting';
import { syntaxThemeManager } from '@/lib/syntax-themes';

// Core diff data structures
export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
  isHighlighted?: boolean;
  highlightedContent?: string;
}

export interface DiffChunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldFilePath: string;
  newFilePath: string;
  oldContent?: string;
  newContent?: string;
  chunks: DiffChunk[];
  language?: string;
  isBinary?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
  isRenamed?: boolean;
}

export interface FileDiffViewerProps {
  diff: FileDiff;
  viewMode?: 'side-by-side' | 'unified';
  showLineNumbers?: boolean;
  showFullFile?: boolean;
  maxLines?: number;
  onCopy?: (content: string) => void;
  className?: string;
}

export default function FileDiffViewer({
  diff,
  viewMode: initialViewMode = 'side-by-side',
  showLineNumbers = true,
  showFullFile = false,
  maxLines = 500,
  onCopy,
  className = ''
}: FileDiffViewerProps) {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>(initialViewMode);
  const [isExpanded, setIsExpanded] = useState(showFullFile);
  const [highlightedLines, setHighlightedLines] = useState<Map<string, string>>(new Map());
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [themeInitialized, setThemeInitialized] = useState(false);

  // Calculate stats
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    diff.chunks.forEach(chunk => {
      chunk.lines.forEach(line => {
        switch (line.type) {
          case 'added':
            added++;
            break;
          case 'removed':
            removed++;
            break;
          case 'unchanged':
            unchanged++;
            break;
        }
      });
    });

    return { added, removed, unchanged };
  }, [diff]);

  // Initialize syntax highlighting
  useEffect(() => {
    let isCancelled = false;

    const initializeHighlighting = async () => {
      if (diff.isBinary || !diff.language) return;

      try {
        setIsHighlighting(true);
        
        // Initialize services
        await syntaxHighlighting.initialize();
        
        if (!themeInitialized) {
          await syntaxThemeManager.autoLoadTheme();
          setThemeInitialized(true);
        }

        // Highlight all lines
        const newHighlightedLines = new Map<string, string>();
        const allLines = diff.chunks.flatMap(chunk => chunk.lines);
        
        for (const line of allLines) {
          if (line.content.trim()) {
            try {
              const result = await syntaxHighlighting.highlightCode(
                line.content,
                diff.language,
                diff.newFilePath
              );
              
              if (!isCancelled && result.success) {
                const key = `${line.oldLineNumber || 'new'}-${line.newLineNumber || 'old'}`;
                newHighlightedLines.set(key, result.highlighted);
              }
            } catch (error) {
              // Silently fail for individual lines
              // Silently fail for individual line highlighting
            }
          }
        }

        if (!isCancelled) {
          setHighlightedLines(newHighlightedLines);
        }
      } catch (error) {
        console.error('Failed to initialize syntax highlighting:', error);
      } finally {
        if (!isCancelled) {
          setIsHighlighting(false);
        }
      }
    };

    initializeHighlighting();

    return () => {
      isCancelled = true;
    };
  }, [diff.chunks, diff.language, diff.newFilePath, diff.isBinary, themeInitialized]);

  // Process lines for display
  const processedLines = useMemo(() => {
    const allLines = diff.chunks.flatMap(chunk => chunk.lines);
    return isExpanded ? allLines : allLines.slice(0, maxLines);
  }, [diff.chunks, isExpanded, maxLines]);

  // Get file extension for syntax highlighting hint
  const getFileExtension = (filePath: string) => {
    return filePath.split('.').pop()?.toLowerCase() || '';
  };

  // Get language-specific styling hints
  const getLanguageClass = (language?: string) => {
    if (!language) return '';
    return `language-${language}`;
  };

  // Handle copy functionality
  const handleCopy = (content: string) => {
    if (onCopy) {
      onCopy(content);
    } else {
      navigator.clipboard?.writeText(content);
    }
  };

  // Copy all diff content
  const copyAllDiff = () => {
    const content = diff.chunks
      .flatMap(chunk => chunk.lines)
      .map(line => {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        return `${prefix}${line.content}`;
      })
      .join('\n');
    handleCopy(content);
  };

  // Render line numbers
  const renderLineNumbers = (line: DiffLine) => {
    if (!showLineNumbers) return null;

    return (
      <div className="flex text-xs text-base-content/40 select-none">
        <span className="w-8 text-right pr-1">
          {line.oldLineNumber ? line.oldLineNumber : ''}
        </span>
        <span className="w-8 text-right pr-2">
          {line.newLineNumber ? line.newLineNumber : ''}
        </span>
      </div>
    );
  };

  // Render diff indicator
  const renderDiffIndicator = (line: DiffLine) => {
    const indicator = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
    const colorClass = 
      line.type === 'added' ? 'text-green-600' :
      line.type === 'removed' ? 'text-red-600' :
      'text-base-content/40';

    return (
      <span className={`w-4 text-center select-none ${colorClass}`}>
        {indicator}
      </span>
    );
  };

  // Get highlighted content for a line
  const getHighlightedContent = (line: DiffLine) => {
    const key = `${line.oldLineNumber || 'new'}-${line.newLineNumber || 'old'}`;
    return highlightedLines.get(key) || line.content;
  };

  // Render unified diff view
  const renderUnifiedView = () => {
    return (
      <div className="overflow-x-auto">
        <div className="font-mono text-sm">
          {processedLines.map((line, index) => {
            const bgClass = 
              line.type === 'added' ? 'diff-line added' :
              line.type === 'removed' ? 'diff-line removed' :
              line.isHighlighted ? 'diff-line highlighted' : 'diff-line';

            const highlightedContent = getHighlightedContent(line);
            const hasHighlighting = highlightedContent !== line.content;

            return (
              <div
                key={index}
                className={`${bgClass} hover:bg-base-200`}
              >
                {renderLineNumbers(line)}
                {renderDiffIndicator(line)}
                <div className="flex-1 px-2 py-1 min-w-0">
                  {hasHighlighting ? (
                    <code 
                      className="whitespace-pre hljs"
                      dangerouslySetInnerHTML={{ __html: highlightedContent }}
                    />
                  ) : (
                    <code className={`whitespace-pre ${getLanguageClass(diff.language)}`}>
                      {line.content}
                    </code>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render side-by-side diff view
  const renderSideBySideView = () => {
    // Split lines into old and new columns
    const oldLines: (DiffLine | null)[] = [];
    const newLines: (DiffLine | null)[] = [];

    let oldIndex = 0;
    let newIndex = 0;

    processedLines.forEach(line => {
      if (line.type === 'removed') {
        oldLines.push(line);
        newLines.push(null);
      } else if (line.type === 'added') {
        oldLines.push(null);
        newLines.push(line);
      } else {
        oldLines.push(line);
        newLines.push(line);
      }
    });

    return (
      <div className="grid grid-cols-2 gap-2 overflow-x-auto">
        {/* Old file column */}
        <div className="border-r border-base-300">
          <div className="bg-base-200 px-2 py-1 text-xs font-medium text-base-content/70 border-b border-base-300">
            {diff.oldFilePath}
          </div>
          <div className="font-mono text-sm">
            {oldLines.map((line, index) => {
              if (!line) {
                return <div key={index} className="h-6"></div>;
              }

              const bgClass = 
                line.type === 'removed' ? 'bg-red-50' :
                line.isHighlighted ? 'bg-yellow-50' : '';

              const highlightedContent = getHighlightedContent(line);
              const hasHighlighting = highlightedContent !== line.content;

              return (
                <div
                  key={index}
                  className={`flex items-start hover:bg-base-200 ${bgClass}`}
                >
                  {showLineNumbers && (
                    <span className="w-8 text-right pr-2 text-xs text-base-content/40 select-none">
                      {line.oldLineNumber || ''}
                    </span>
                  )}
                  <div className="flex-1 px-2 py-1 min-w-0">
                    {hasHighlighting ? (
                      <code 
                        className="whitespace-pre hljs"
                        dangerouslySetInnerHTML={{ __html: highlightedContent }}
                      />
                    ) : (
                      <code className={`whitespace-pre ${getLanguageClass(diff.language)}`}>
                        {line.content}
                      </code>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* New file column */}
        <div>
          <div className="bg-base-200 px-2 py-1 text-xs font-medium text-base-content/70 border-b border-base-300">
            {diff.newFilePath}
          </div>
          <div className="font-mono text-sm">
            {newLines.map((line, index) => {
              if (!line) {
                return <div key={index} className="h-6"></div>;
              }

              const bgClass = 
                line.type === 'added' ? 'bg-green-50' :
                line.isHighlighted ? 'bg-yellow-50' : '';

              const highlightedContent = getHighlightedContent(line);
              const hasHighlighting = highlightedContent !== line.content;

              return (
                <div
                  key={index}
                  className={`flex items-start hover:bg-base-200 ${bgClass}`}
                >
                  {showLineNumbers && (
                    <span className="w-8 text-right pr-2 text-xs text-base-content/40 select-none">
                      {line.newLineNumber || ''}
                    </span>
                  )}
                  <div className="flex-1 px-2 py-1 min-w-0">
                    {hasHighlighting ? (
                      <code 
                        className="whitespace-pre hljs"
                        dangerouslySetInnerHTML={{ __html: highlightedContent }}
                      />
                    ) : (
                      <code className={`whitespace-pre ${getLanguageClass(diff.language)}`}>
                        {line.content}
                      </code>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // Handle binary files
  if (diff.isBinary) {
    return (
      <div className={`border border-base-300 rounded-lg overflow-hidden ${className}`}>
        <div className="bg-base-200 px-4 py-3 border-b border-base-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon icon={faEye} className="w-4 h-4 text-base-content/60" />
              <span className="font-medium text-sm">Binary file</span>
            </div>
          </div>
        </div>
        <div className="p-4 text-center text-base-content/60">
          <p>Binary files cannot be displayed in diff view</p>
          <p className="text-xs mt-1">
            {diff.oldFilePath} → {diff.newFilePath}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`border border-base-300 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="bg-base-200 px-4 py-3 border-b border-base-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faEye} className="w-4 h-4 text-base-content/60" />
            <span className="font-medium text-sm">
              {diff.oldFilePath === diff.newFilePath ? diff.oldFilePath : `${diff.oldFilePath} → ${diff.newFilePath}`}
            </span>
            {diff.language && (
              <span className="text-xs bg-base-300 px-2 py-1 rounded">
                {diff.language}
              </span>
            )}
            {isHighlighting && (
              <span className="text-xs text-base-content/60 flex items-center gap-1">
                <div className="loading loading-spinner loading-xs"></div>
                Highlighting...
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex bg-base-300 rounded overflow-hidden">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`px-2 py-1 text-xs ${
                  viewMode === 'side-by-side' 
                    ? 'bg-primary text-primary-content' 
                    : 'hover:bg-base-200'
                }`}
                title="Side by side"
              >
                <FontAwesomeIcon icon={faColumns} className="w-3 h-3" />
              </button>
              <button
                onClick={() => setViewMode('unified')}
                className={`px-2 py-1 text-xs ${
                  viewMode === 'unified' 
                    ? 'bg-primary text-primary-content' 
                    : 'hover:bg-base-200'
                }`}
                title="Unified"
              >
                <FontAwesomeIcon icon={faList} className="w-3 h-3" />
              </button>
            </div>

            {/* Copy button */}
            <button
              onClick={copyAllDiff}
              className="px-2 py-1 text-xs bg-base-300 hover:bg-base-200 rounded"
              title="Copy diff"
            >
              <FontAwesomeIcon icon={faCopy} className="w-3 h-3" />
            </button>

            {/* Expand/collapse button */}
            {!showFullFile && diff.chunks.flatMap(c => c.lines).length > maxLines && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="px-2 py-1 text-xs bg-base-300 hover:bg-base-200 rounded"
                title={isExpanded ? 'Collapse' : 'Expand all'}
              >
                <FontAwesomeIcon icon={isExpanded ? faCompress : faExpand} className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-2 text-xs text-base-content/60">
          <span className="flex items-center gap-1">
            <span className="text-green-600">+{stats.added}</span>
            <span>additions</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-red-600">-{stats.removed}</span>
            <span>deletions</span>
          </span>
          {stats.unchanged > 0 && (
            <span>{stats.unchanged} unchanged</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {viewMode === 'unified' ? renderUnifiedView() : renderSideBySideView()}
      </div>

      {/* Truncation indicator */}
      {!isExpanded && !showFullFile && diff.chunks.flatMap(c => c.lines).length > maxLines && (
        <div className="bg-base-200 px-4 py-2 text-center text-xs text-base-content/60 border-t border-base-300">
          Showing {maxLines} of {diff.chunks.flatMap(c => c.lines).length} lines
          <button
            onClick={() => setIsExpanded(true)}
            className="ml-2 text-primary hover:underline"
          >
            Show all
          </button>
        </div>
      )}
    </div>
  );
}