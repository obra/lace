// ABOUTME: Tool approval modal component for interactive approval decisions
// ABOUTME: Updated to support multiple approvals per spec Phase 3.4

import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye, faCode } from '@/lib/fontawesome';
import type { PendingApproval } from '@/types/api';
import { ApprovalDecision } from '@/types/core';
import { getToolRenderer } from '@/components/timeline/tool';
import {
  getToolIcon,
  createDefaultToolSummary,
  ToolCallDisplay,
} from '@/components/ui/ToolCallDisplay';
import FileDiffViewer from '@/components/files/FileDiffViewer';
import FileRenderer from '@/components/ui/FileRenderer';
import {
  createPartialDiff,
  createPreviewResult,
  shouldShowPartialDiff,
} from './tool-approval-preview';
import { api } from '@/lib/api-client';
import { encodePathSegments } from '@/lib/path-utils';
import type { SessionFileContentResponse } from '@/types/session-files';
import type { ToolResult } from '@/components/timeline/tool/types';
import { useSessionContext } from '@/components/providers/SessionProvider';

interface ToolApprovalModalProps {
  approvals: PendingApproval[];
  onDecision: (toolCallId: string, decision: ApprovalDecision) => void;
}

// LRU Cache implementation for file previews
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing key
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export function ToolApprovalModal({ approvals, onDecision }: ToolApprovalModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [, forceUpdate] = useState({});
  const [filePreviewCache] = useState(() => new LRUCache<string, ToolResult>(20)); // Max 20 cached previews
  const { selectedSession } = useSessionContext();
  const currentApproval = approvals[currentIndex];
  const request = currentApproval?.requestData;

  // Keyboard shortcuts
  useEffect(() => {
    if (!currentApproval) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'y':
        case 'a':
          e.preventDefault();
          onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_ONCE);
          break;
        case 's':
          e.preventDefault();
          onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_SESSION);
          break;
        case 'n':
        case 'd':
          e.preventDefault();
          onDecision(currentApproval.toolCallId, ApprovalDecision.DENY);
          break;
        case 'escape':
          e.preventDefault();
          onDecision(currentApproval.toolCallId, ApprovalDecision.DENY);
          break;
        case 'arrowleft':
          e.preventDefault();
          if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
          break;
        case 'arrowright':
          e.preventDefault();
          if (currentIndex < approvals.length - 1) setCurrentIndex(currentIndex + 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onDecision, currentApproval, currentIndex, approvals.length]);

  // Cleanup cache when component unmounts
  useEffect(() => {
    return () => {
      filePreviewCache.clear();
    };
  }, [filePreviewCache]);

  // Fetch file content for file_read previews
  useEffect(() => {
    const toolName = request?.toolName || currentApproval?.toolCall?.name;
    if (toolName !== 'file_read' || !currentApproval || !selectedSession) return;

    const args = request?.input || currentApproval.toolCall?.arguments;
    const readArgs = args as { path?: string; startLine?: number; endLine?: number } | undefined;

    if (!readArgs?.path) return;

    const cacheKey = `${currentApproval.toolCallId}-${readArgs.path}-${readArgs.startLine}-${readArgs.endLine}`;

    // Check if we already have this file content cached
    if (filePreviewCache.has(cacheKey)) return;

    // Fetch file content from the server using the API client
    const fetchFileContent = async () => {
      try {
        const encodedPath = encodePathSegments(readArgs.path!);
        const fileData = await api.get<SessionFileContentResponse>(
          `/api/sessions/${selectedSession}/files/${encodedPath}`
        );

        let content = fileData.content || '';

        // Apply line range if specified (same logic as the file_read tool)
        if (readArgs.startLine || readArgs.endLine) {
          const lines = content.split('\n');
          const start = Math.max(0, (readArgs.startLine || 1) - 1);
          const end =
            readArgs.endLine !== undefined
              ? Math.min(lines.length, readArgs.endLine)
              : lines.length;
          const resultLines = lines.slice(start, end);
          content = resultLines.join('\n');
        }

        // Create a result with the actual file content (same format as successful file_read)
        const previewResult: ToolResult = {
          status: 'completed', // Use completed so it renders as success
          content: [{ type: 'text', text: content }],
          metadata: {
            isPreview: true,
            arguments: args,
            totalLines: fileData.content?.split('\n').length,
            linesReturned: content.split('\n').length,
            fileSize: fileData.size ? `${Math.round(fileData.size / 1024)} KB` : undefined,
          },
        };

        filePreviewCache.set(cacheKey, previewResult);
        forceUpdate({}); // Trigger re-render
      } catch (error) {
        // Create an error result for display
        const errorResult: ToolResult = {
          status: 'pending', // Keep as pending to show as preview
          content: [
            {
              type: 'text',
              text: `Cannot preview ${readArgs.path}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          metadata: { isPreview: true, arguments: args },
        };

        filePreviewCache.set(cacheKey, errorResult);
        forceUpdate({}); // Trigger re-render
      }
    };

    void fetchFileContent();
  }, [currentApproval, request, selectedSession, filePreviewCache]);

  // Early return after hooks to satisfy React rules
  if (!currentApproval || !request) return null;

  // Extract tool information
  const isReadOnly = request.isReadOnly ?? false;
  const toolName = request.toolName || currentApproval.toolCall?.name || 'Unknown Tool';
  const args = request.input || currentApproval.toolCall?.arguments;

  // Get tool display information using the same logic as ToolCallDisplay
  const renderer = getToolRenderer(toolName);
  const toolIcon = renderer.getIcon?.() ?? getToolIcon(toolName);
  const toolSummary = renderer.getSummary?.(args) ?? createDefaultToolSummary(toolName, args);
  const hasArgs = Boolean(
    args && typeof args === 'object' && args !== null && Object.keys(args).length > 0
  );

  const operationName = renderer.getSummary?.(args) ?? createDefaultToolSummary(toolName, args);

  const modalTitle = (
    <div className="flex justify-between items-start w-full">
      <div className="flex items-center gap-2">
        <FontAwesomeIcon icon={toolIcon} className="w-5 h-5 text-warning" />
        <div>
          <h2 className="text-xl font-bold text-base-content">
            Approval required: {operationName}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-base-content/60">
              {isReadOnly ? 'Read-only' : 'May modify data'}
            </span>
          </div>
        </div>
      </div>
      {/* Approval Counter with Navigation */}
      {approvals.length > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="btn btn-xs btn-ghost"
            data-testid="tool-approval-prev-button"
          >
            ←
          </button>
          <div className="text-sm font-medium text-base-content/60 bg-base-200 px-3 py-1 rounded">
            {currentIndex + 1} of {approvals.length}
          </div>
          <button
            onClick={() => setCurrentIndex(Math.min(approvals.length - 1, currentIndex + 1))}
            disabled={currentIndex === approvals.length - 1}
            className="btn btn-xs btn-ghost"
            data-testid="tool-approval-next-button"
          >
            →
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Transparent backdrop - only for modal isolation */}
      <div
        className="absolute inset-0 pointer-events-auto"
        onClick={() => onDecision(currentApproval.toolCallId, ApprovalDecision.DENY)}
      />

      {/* Modal anchored to bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
        <div className="max-w-2xl mx-auto pointer-events-auto">
          <div className="bg-base-100/95 backdrop-blur-md rounded-lg shadow-xl border border-base-300">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              {modalTitle}
            </div>

            {/* Content */}
            <div className="p-4">
              <div className="flex flex-col max-h-[75vh]">
                {/* Tool Preview (always shown, no toggle) */}
                {hasArgs && (
                  <div className="mb-4">
                    {/* File Edit: Show partial diff */}
                    {shouldShowPartialDiff(toolName) &&
                      (() => {
                        const partialDiff = createPartialDiff(toolName, args);
                        return partialDiff ? (
                          <div className="mb-3">
                            <FileDiffViewer
                              diff={partialDiff}
                              viewMode="unified"
                              showLineNumbers={true}
                              maxLines={20}
                              className="border border-info/20 rounded-lg"
                            />
                            <div className="text-xs text-base-content/60 mt-2 italic">
                              Showing edit operations (without full file context)
                            </div>
                          </div>
                        ) : null;
                      })()}

                    {/* All Tools: Use existing renderer directly */}
                    <div className="max-w-full overflow-hidden">
                      {(() => {
                        const renderer = getToolRenderer(toolName);

                        // For file_read tools, use cached file content if available
                        let resultToRender: ToolResult;
                        let cachedResult: ToolResult | undefined;

                        if (toolName === 'file_read') {
                          const readArgs = args as
                            | { path?: string; startLine?: number; endLine?: number }
                            | undefined;
                          const cacheKey = `${currentApproval.toolCallId}-${readArgs?.path}-${readArgs?.startLine}-${readArgs?.endLine}`;
                          cachedResult = filePreviewCache.get(cacheKey);
                          resultToRender = cachedResult || createPreviewResult(toolName, args);
                        } else {
                          resultToRender = createPreviewResult(toolName, args);
                        }

                        const aggregatedData = {
                          call: {
                            id: 'preview',
                            name: toolName,
                            arguments: (args as Record<string, unknown>) || {},
                          },
                          result: resultToRender,
                          toolName: toolName,
                          toolId: 'preview',
                          arguments: args,
                        };

                        const renderedContent = renderer.renderResult?.(
                          resultToRender,
                          aggregatedData
                        ) || (
                          <div className="p-3 text-sm text-base-content/60">
                            Preview not available for this tool type
                          </div>
                        );

                        // For file_read tools, wrap in a container that prevents line wrapping
                        if (toolName === 'file_read' && cachedResult?.status === 'completed') {
                          return (
                            <div
                              className="max-h-[400px] overflow-auto"
                              style={{
                                // Override any text wrapping in child elements
                                maxWidth: '100%',
                              }}
                            >
                              <div
                                style={{
                                  // Apply to all text content within
                                  whiteSpace: 'pre',
                                  overflowWrap: 'normal',
                                  wordBreak: 'normal',
                                  fontSize: 'inherit',
                                }}
                                className="[&_pre]:!whitespace-pre [&_code]:!whitespace-pre [&_*]:!overflow-wrap-normal [&_*]:!word-break-normal"
                              >
                                {renderedContent}
                              </div>
                            </div>
                          );
                        }

                        return renderedContent;
                      })()}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_ONCE)
                    }
                    className="btn btn-outline flex-1"
                    data-testid="tool-approval-allow-once-button"
                  >
                    Allow Once
                    <span className="text-xs opacity-70 ml-2">[Y/A]</span>
                  </button>
                  <button
                    onClick={() =>
                      onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_SESSION)
                    }
                    className="btn btn-outline flex-1"
                    data-testid="tool-approval-allow-session-button"
                  >
                    Allow Session
                    <span className="text-xs opacity-70 ml-2">[S]</span>
                  </button>
                  <button
                    onClick={() => onDecision(currentApproval.toolCallId, ApprovalDecision.DENY)}
                    className="btn btn-outline flex-1"
                    data-testid="tool-approval-deny-button"
                  >
                    Deny
                    <span className="text-xs opacity-70 ml-2">[N/D]</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
