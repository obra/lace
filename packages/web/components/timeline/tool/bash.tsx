'use client';

// ABOUTME: Bash tool renderer implementation with terminal-specific formatting
// ABOUTME: Provides custom display logic for bash command execution results

import React from 'react';
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from './types';

/**
 * Bash-specific tool renderer providing terminal-style formatting
 * and command display optimized for shell operations
 */
export const bashRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'command' in args) {
      const command = (args as { command?: unknown }).command;
      if (typeof command === 'string') {
        return `$ ${command}`;
      }
    }
    return '$ [no command]';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    // Check for non-zero exit code in structured output
    try {
      const rawOutput = result.content?.map((block) => block.text || '').join('') || '';
      const bashOutput = JSON.parse(rawOutput) as { exitCode?: number };
      return bashOutput.exitCode != null && bashOutput.exitCode !== 0;
    } catch {
      return result.status !== 'completed';
    }
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>No output</em>
        </div>
      );
    }

    const rawOutput = result.content.map((block) => block.text || '').join('');

    // Try to parse structured bash output
    let bashOutput: { stdout?: string; stderr?: string; exitCode?: number };
    try {
      bashOutput = JSON.parse(rawOutput) as { stdout?: string; stderr?: string; exitCode?: number };
    } catch {
      // Fallback to raw output if not structured
      return (
        <div
          className={`font-mono text-sm whitespace-pre-wrap leading-relaxed ${
            result.status !== 'completed'
              ? 'text-error bg-error/10 border border-error/20'
              : 'text-base-content/80 bg-base-100/80 backdrop-blur-sm border border-base-300/50'
          } rounded-xl p-4 shadow-sm terminal-syntax`}
        >
          {rawOutput}
        </div>
      );
    }

    const { stdout, stderr, exitCode } = bashOutput;
    const hasStdout = stdout && stdout.trim();
    const hasStderr = stderr && stderr.trim();
    const hasNonZeroExit = exitCode != null && exitCode !== 0;

    return (
      <div className="space-y-2">
        {/* Stdout output */}
        {hasStdout && (
          <div className="font-mono text-sm whitespace-pre-wrap leading-relaxed text-base-content/80 bg-base-100/80 backdrop-blur-sm border border-base-300/50 rounded-xl p-4 shadow-sm terminal-syntax">
            {stdout}
          </div>
        )}

        {/* Stderr output */}
        {hasStderr && (
          <div className="font-mono text-sm whitespace-pre-wrap leading-relaxed text-error bg-error/10 border border-error/30 rounded-xl p-4 shadow-sm">
            <div className="text-error/70 text-xs font-bold mb-1">STDERR:</div>
            {stderr}
          </div>
        )}

        {/* Exit code (only show if non-zero) */}
        {hasNonZeroExit && (
          <div className="text-sm text-error/80 bg-error/5 border border-error/20 rounded px-2 py-1">
            <span className="font-semibold">Exit code:</span> {exitCode}
          </div>
        )}

        {/* Show success indicator if no output but successful */}
        {!hasStdout && !hasStderr && !hasNonZeroExit && (
          <div className="text-sm text-success/80 bg-success/5 border border-success/20 rounded px-2 py-1">
            Command completed successfully (exit code: 0)
          </div>
        )}
      </div>
    );
  },

  getIcon: () => {
    return faTerminal;
  },
};
