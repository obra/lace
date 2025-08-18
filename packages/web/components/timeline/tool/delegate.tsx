'use client';

// ABOUTME: Delegate tool renderer implementation with elegant subagent task display
// ABOUTME: Provides custom display logic for task delegation and subagent results

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUserFriends,
  faRobot,
  faSpinner,
  faCheckCircle,
  faExclamationTriangle,
  faClock,
  faMemory,
  faStopwatch,
  faCode,
} from '@fortawesome/free-solid-svg-icons';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';
import { Alert } from '@/components/ui/Alert';

/**
 * Status badge component for delegation status display
 */
const DelegateStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig = {
    completed: {
      style: 'bg-success/10 text-success border-success/20',
      icon: faCheckCircle,
      label: 'Completed',
    },
    failed: {
      style: 'bg-error/10 text-error border-error/20',
      icon: faExclamationTriangle,
      label: 'Failed',
    },
    denied: {
      style: 'bg-error/10 text-error border-error/20',
      icon: faExclamationTriangle,
      label: 'Denied',
    },
    aborted: {
      style: 'bg-warning/10 text-warning border-warning/20',
      icon: faExclamationTriangle,
      label: 'Aborted',
    },
    timeout: {
      style: 'bg-warning/10 text-warning border-warning/20',
      icon: faClock,
      label: 'Timeout',
    },
    in_progress: {
      style: 'bg-primary/10 text-primary border-primary/20',
      icon: faSpinner,
      label: 'Running',
    },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.in_progress;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${config.style}`}
    >
      <FontAwesomeIcon icon={config.icon} className="w-3 h-3" />
      {config.label}
    </span>
  );
};

/**
 * Model badge component for AI model display
 */
const ModelBadge: React.FC<{ model: string }> = ({ model }) => {
  // Extract model name for display
  const displayName = model.replace(/^claude-3-/, '').replace(/-\d{8}$/, '');

  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-base-200 text-base-content/70 text-xs font-mono">
      <FontAwesomeIcon icon={faRobot} className="w-3 h-3" />
      {displayName}
    </span>
  );
};

/**
 * Metrics display component for token usage and timing
 */
const DelegateMetrics: React.FC<{
  tokensUsed?: number;
  executionTime?: number;
  model?: string;
}> = ({ tokensUsed, executionTime, model }) => {
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div className="flex items-center gap-4 text-xs text-base-content/60">
      {tokensUsed && (
        <div className="flex items-center gap-1">
          <FontAwesomeIcon icon={faMemory} className="w-3 h-3" />
          {tokensUsed.toLocaleString()} tokens
        </div>
      )}

      {executionTime && (
        <div className="flex items-center gap-1">
          <FontAwesomeIcon icon={faStopwatch} className="w-3 h-3" />
          {formatDuration(executionTime)}
        </div>
      )}

      {model && <ModelBadge model={model} />}
    </div>
  );
};

/**
 * Parse structured tool result content
 */
function parseToolResult(result: ToolResult): unknown {
  if (!result.content || result.content.length === 0) return null;

  const rawOutput = result.content.map((block) => block.text || '').join('');

  try {
    return JSON.parse(rawOutput);
  } catch {
    return rawOutput;
  }
}

/**
 * Delegate Tool Renderer - Task delegation to subagents
 */
export const delegateRenderer: ToolRenderer = {
  getSummary: (args: unknown): string => {
    if (typeof args === 'object' && args !== null && 'instructions' in args) {
      const instructions = (args as { instructions?: unknown }).instructions;
      const model = (args as { model?: unknown }).model;

      if (typeof instructions === 'string') {
        // Truncate long instructions for summary
        const truncatedInstructions =
          instructions.length > 80 ? `${instructions.substring(0, 77)}...` : instructions;

        const modelSuffix = typeof model === 'string' ? ` (${model})` : '';
        return `Delegate: "${truncatedInstructions}"${modelSuffix}`;
      }
    }
    return 'Delegate task to subagent';
  },

  isError: (result: ToolResult): boolean => {
    if (result.status !== 'completed') return true;

    // Check for error statuses in structured output
    try {
      const parsed = parseToolResult(result);
      if (typeof parsed === 'object' && parsed !== null && 'status' in parsed) {
        const status = (parsed as { status?: string }).status;
        return (
          status === 'failed' || status === 'timeout' || status === 'aborted' || status === 'denied'
        );
      }
    } catch {
      // Fallback to result status check
    }

    return false;
  },

  renderResult: (result: ToolResult): React.ReactNode => {
    if (!result.content || result.content.length === 0) {
      return (
        <div className="font-mono text-sm text-base-content/60">
          <em>Delegation in progress...</em>
        </div>
      );
    }

    const parsed = parseToolResult(result);

    // Handle legacy plain text output
    if (typeof parsed === 'string') {
      const statusText = result.status !== 'completed' ? result.status.toUpperCase() : parsed;
      return result.status !== 'completed' ? (
        <Alert variant="error" title="Delegation Failed" description={statusText} />
      ) : (
        <div className="text-base-content/80 bg-base-200 border border-base-300 font-mono text-sm whitespace-pre-wrap rounded-lg p-3">
          {parsed}
        </div>
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      return (
        <div className="text-sm text-base-content/60 italic">Delegation result not available</div>
      );
    }

    const data = parsed as {
      delegateId?: string;
      status?: string;
      result?: string;
      error?: string;
      partialResult?: string;
      tokensUsed?: number;
      executionTime?: number;
      model?: string;
      startedAt?: string;
    };

    const isError =
      data.status === 'failed' || data.status === 'timeout' || result.status !== 'completed';
    const isInProgress = data.status === 'in_progress';
    const isCompleted = data.status === 'completed';

    return (
      <div className="bg-base-100 border border-base-300 rounded-lg">
        {/* Header */}
        <div className="p-3 border-b border-base-300 bg-base-200/50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-base-content">
              <FontAwesomeIcon icon={faUserFriends} className="w-4 h-4" />
              Subagent Delegation
            </div>

            {data.status && <DelegateStatusBadge status={data.status} />}
          </div>

          {data.delegateId && (
            <div className="text-xs font-mono text-base-content/60 mt-1">ID: {data.delegateId}</div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Success Result */}
          {isCompleted && data.result && (
            <Alert variant="success" title="Delegation Completed Successfully">
              <div className="text-sm whitespace-pre-wrap">{data.result}</div>
            </Alert>
          )}

          {/* Error Result */}
          {isError && data.error && (
            <Alert variant="error" title="Delegation Failed" description={data.error} />
          )}

          {/* Timeout with Partial Result */}
          {data.status === 'timeout' && data.partialResult && (
            <Alert
              variant="warning"
              title="Delegation Timed Out"
              description="Partial result before timeout:"
            >
              <div className="text-sm bg-base-100 border border-base-300 rounded p-2 whitespace-pre-wrap">
                {data.partialResult}
              </div>
            </Alert>
          )}

          {/* In Progress */}
          {isInProgress && (
            <div className="bg-primary/5 border border-primary/20 rounded p-3">
              <div className="flex items-center gap-2 text-primary text-sm font-medium">
                <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin" />
                Delegation in progress...
              </div>
              {data.startedAt && (
                <div className="text-xs text-base-content/60 mt-2">
                  Started: {new Date(data.startedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* Metrics */}
          {(data.tokensUsed || data.executionTime || data.model) && (
            <div className="pt-3 border-t border-base-300">
              <DelegateMetrics
                tokensUsed={data.tokensUsed}
                executionTime={data.executionTime}
                model={data.model}
              />
            </div>
          )}
        </div>
      </div>
    );
  },

  getIcon: () => faUserFriends,
};
