'use client';

// ABOUTME: Bash tool renderer implementation with terminal-specific formatting
// ABOUTME: Provides custom display logic for bash command execution results

import React, { useState } from 'react';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';
import type { ToolAggregatedEventData } from '@/types/web-events';
import { Alert } from '@/components/ui/Alert';

// Type for structured bash output
interface BashOutput {
  stdoutPreview?: string;
  stderrPreview?: string;
  exitCode?: number;
}

// Type guard to validate bash output structure
function isBashOutput(obj: unknown): obj is BashOutput {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (typeof (obj as BashOutput).stdoutPreview === 'string' ||
      (obj as BashOutput).stdoutPreview === undefined) &&
    (typeof (obj as BashOutput).stderrPreview === 'string' ||
      (obj as BashOutput).stderrPreview === undefined) &&
    (typeof (obj as BashOutput).exitCode === 'number' || (obj as BashOutput).exitCode === undefined)
  );
}

// Safe bash output parser
function parseBashOutput(rawOutput: string): BashOutput | null {
  try {
    const parsed: unknown = JSON.parse(rawOutput);
    return isBashOutput(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Expandable result component for bash output with 15-line folding threshold
function BashExpandableResult({ content, isError }: { content: string; isError: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const lines = content.split('\n');
  const shouldShowExpand = lines.length > 15;
  const displayContent = isExpanded ? content : lines.slice(0, 15).join('\n');

  return (
    <div className="p-2">
      <div
        className={`text-sm rounded border ${
          isError
            ? 'bg-error/5 border-error/20 text-error'
            : 'bg-base-100/80 border-base-300/50 text-base-content/80'
        }`}
      >
        <pre className="p-3 font-mono text-sm whitespace-pre-wrap break-words leading-relaxed">
          {displayContent}
          {shouldShowExpand && !isExpanded && (
            <button
              onClick={() => setIsExpanded(true)}
              className="text-base-content/40 hover:text-base-content/70 cursor-pointer mt-2 block text-xs"
            >
              + {lines.length - 15} more lines
            </button>
          )}
          {shouldShowExpand && isExpanded && (
            <button
              onClick={() => setIsExpanded(false)}
              className="text-base-content/40 hover:text-base-content/70 cursor-pointer mt-2 block text-xs"
            >
              − Show less
            </button>
          )}
        </pre>
      </div>
    </div>
  );
}

/**
 * Bash-specific tool renderer providing terminal-style formatting
 * and command display optimized for shell operations
 */
export const bashRenderer: ToolRenderer = {
  getSummary: (args: unknown, result?: ToolResult): string => {
    if (typeof args === 'object' && args !== null && 'command' in args) {
      const command = (args as { command?: unknown }).command;
      if (typeof command === 'string') {
        let summary = `$ ${command}`;

        // Add exit code if non-zero
        if (result?.content) {
          try {
            const rawOutput = result.content.map((block) => block.text || '').join('');
            const bashOutput = parseBashOutput(rawOutput);

            if (bashOutput?.exitCode != null && bashOutput.exitCode !== 0) {
              summary += ` (exit ${bashOutput.exitCode})`;
            }
          } catch {
            // Ignore parsing errors
          }
        }

        return summary;
      }
    }
    return '$ [no command]';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status === 'failed' || result.status === 'denied') return true;

    // Check for non-zero exit code in structured output
    const rawOutput = result.content?.map((block) => block.text || '').join('') || '';
    const bashOutput = parseBashOutput(rawOutput);

    if (bashOutput?.exitCode != null && bashOutput.exitCode !== 0) {
      return true;
    }

    return false;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60 p-3">
          <em>No output</em>
        </div>
      );
    }

    const rawOutput = result.content.map((block) => block.text || '').join('');

    // Try to parse structured bash output
    const bashOutput = parseBashOutput(rawOutput);

    if (!bashOutput) {
      // Fallback to raw output if not structured - use ExpandableResult for consistency
      const isError = result.status !== 'completed';
      return <BashExpandableResult content={rawOutput} isError={isError} />;
    }

    const { stdoutPreview: stdout, stderrPreview: stderr, exitCode } = bashOutput;
    const hasStdout = stdout?.trim();
    const hasStderr = stderr?.trim();
    const hasNonZeroExit = exitCode != null && exitCode !== 0;

    // Combine stdout and stderr for unified display
    const unifiedOutput = [hasStdout && stdout, hasStderr && stderr].filter(Boolean).join('\n');

    if (unifiedOutput) {
      return <BashExpandableResult content={unifiedOutput} isError={hasNonZeroExit} />;
    }

    // Show success indicator if no output but successful
    if (!hasNonZeroExit) {
      return (
        <div className="text-sm text-base-content/60 p-3 text-center">
          Command completed successfully
        </div>
      );
    }

    return null;
  },

  getIcon: () => {
    return faTerminal;
  },
};
