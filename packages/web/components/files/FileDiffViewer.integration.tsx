// ABOUTME: Integration example showing how to use FileDiffViewer with existing tool renderers
// ABOUTME: Demonstrates creating diffs from file-edit tool arguments

import React from 'react';
import FileDiffViewer from './FileDiffViewer';
import { createFileDiffFromText, detectLanguageFromPath } from './FileDiffViewer.utils';

interface FileEditToolArguments {
  file_path: string;
  old_text: string;
  new_text: string;
}

interface FileEditDiffViewerProps {
  arguments: FileEditToolArguments;
  viewMode?: 'side-by-side' | 'unified';
  className?: string;
}

/**
 * Enhanced file edit renderer using FileDiffViewer
 * Can be used to replace or enhance the existing FileEditToolRenderer
 */
export function FileEditDiffViewer({ 
  arguments: args, 
  viewMode = 'side-by-side',
  className = ''
}: FileEditDiffViewerProps) {
  const { file_path, old_text, new_text } = args;
  const language = detectLanguageFromPath(file_path);
  
  const diff = createFileDiffFromText(
    old_text,
    new_text,
    file_path,
    language
  );

  return (
    <FileDiffViewer
      diff={diff}
      viewMode={viewMode}
      showLineNumbers={true}
      maxLines={100}
      className={className}
    />
  );
}

/**
 * Minimal diff viewer for timeline entries
 * Optimized for space-constrained environments
 */
export function MinimalFileDiffViewer({ 
  arguments: args,
  className = ''
}: FileEditDiffViewerProps) {
  const { file_path, old_text, new_text } = args;
  const language = detectLanguageFromPath(file_path);
  
  const diff = createFileDiffFromText(
    old_text,
    new_text,
    file_path,
    language
  );

  return (
    <FileDiffViewer
      diff={diff}
      viewMode="unified"
      showLineNumbers={false}
      maxLines={20}
      showFullFile={false}
      className={className}
    />
  );
}

/**
 * Example of how to create a custom diff viewer component
 * for specific use cases like PR reviews or code audits
 */
export function CodeReviewDiffViewer({ 
  arguments: args,
  onApprove,
  onReject,
  className = ''
}: FileEditDiffViewerProps & {
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const { file_path, old_text, new_text } = args;
  const language = detectLanguageFromPath(file_path);
  
  const diff = createFileDiffFromText(
    old_text,
    new_text,
    file_path,
    language
  );

  return (
    <div className={`space-y-4 ${className}`}>
      <FileDiffViewer
        diff={diff}
        viewMode="side-by-side"
        showLineNumbers={true}
        maxLines={200}
        onCopy={(content) => {
          void ('Copied diff content for review');
        }}
      />
      
      {(onApprove || onReject) && (
        <div className="flex gap-2 justify-end">
          {onReject && (
            <button 
              onClick={onReject}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Reject Changes
            </button>
          )}
          {onApprove && (
            <button 
              onClick={onApprove}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Approve Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FileEditDiffViewer;