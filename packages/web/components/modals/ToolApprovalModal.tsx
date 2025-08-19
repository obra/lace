// ABOUTME: Tool approval modal component for interactive approval decisions
// ABOUTME: Updated to support multiple approvals per spec Phase 3.4

import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { PendingApproval } from '@/types/api';
import { ApprovalDecision } from '@/types/core';
import { getToolRenderer } from '@/components/timeline/tool';
import { getToolIcon, createDefaultToolSummary } from '@/components/ui/ToolCallDisplay';

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

  const modalTitle = (
    <div className="flex justify-between items-start w-full">
      <div>
        <h2 className="text-xl font-bold text-base-content">Approve: {toolName}</h2>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-base-content/60">
            {isReadOnly ? 'Read-only' : 'May modify data'}
          </span>
        </div>
      </div>
      {/* Approval Counter with Navigation */}
      {approvals.length > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="btn btn-xs btn-ghost"
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
                {/* Tool display styled like timeline */}
                <div className="flex gap-3 mb-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center text-sm bg-warning/10 text-warning">
                      <FontAwesomeIcon icon={toolIcon} className="text-xs" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
                      {/* Tool header */}
                      <div className="p-3 bg-base-50 border-b border-base-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {toolName.toLowerCase() === 'bash' &&
                            args &&
                            typeof args === 'object' &&
                            'command' in args ? (
                              <code className="text-sm font-mono bg-base-300 px-2 py-1 rounded text-base-content break-all">
                                $ {String((args as { command: unknown }).command)}
                              </code>
                            ) : (
                              <span className="text-sm text-base-content/80">
                                {String(toolSummary)}
                              </span>
                            )}
                          </div>

                          {hasArgs && (
                            <button
                              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                              className="text-xs text-base-content/50 hover:text-base-content px-2 py-1 rounded hover:bg-base-200 flex-shrink-0"
                            >
                              {showTechnicalDetails ? 'Hide' : 'Show'} Details
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Technical Details (when expanded) */}
                      {showTechnicalDetails && hasArgs && (
                        <div className="px-3 py-2 bg-base-50 border-b border-base-200">
                          <div className="text-xs text-base-content/70 mb-1 font-medium">
                            Technical Details:
                          </div>
                          <div className="text-xs font-mono text-base-content/80 whitespace-pre-wrap bg-base-100 p-2 rounded border">
                            <strong>Tool:</strong> {toolName}
                            {'\n'}
                            <strong>Arguments:</strong> {JSON.stringify(args, null, 2)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_ONCE)
                    }
                    className="btn btn-outline flex-1"
                  >
                    Allow Once
                    <span className="text-xs opacity-70 ml-2">[Y/A]</span>
                  </button>
                  <button
                    onClick={() =>
                      onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_SESSION)
                    }
                    className="btn btn-outline flex-1"
                  >
                    Allow Session
                    <span className="text-xs opacity-70 ml-2">[S]</span>
                  </button>
                  <button
                    onClick={() => onDecision(currentApproval.toolCallId, ApprovalDecision.DENY)}
                    className="btn btn-outline flex-1"
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
