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

interface ToolApprovalModalProps {
  approvals: PendingApproval[];
  onDecision: (toolCallId: string, decision: ApprovalDecision) => void;
}

export function ToolApprovalModal({ approvals, onDecision }: ToolApprovalModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
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
                    <div>
                      {(() => {
                        const renderer = getToolRenderer(toolName);
                        const mockResult = createPreviewResult(toolName, args);
                        const aggregatedData = {
                          call: {
                            id: 'preview',
                            name: toolName,
                            arguments: args,
                          },
                          result: mockResult,
                          toolName: toolName,
                          toolId: 'preview',
                          arguments: args,
                        };

                        return (
                          renderer.renderResult?.(mockResult, aggregatedData) || (
                            <div className="p-3 text-sm text-base-content/60">
                              Preview not available for this tool type
                            </div>
                          )
                        );
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
