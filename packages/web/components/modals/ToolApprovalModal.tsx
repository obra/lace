// ABOUTME: Tool approval modal component for interactive approval decisions  
// ABOUTME: Updated to support multiple approvals per spec Phase 3.4

import React, { useEffect, useState } from 'react';
import type { PendingApproval } from '@/types/api';
import { ApprovalDecision } from '@/types/core';
import { safeStringify } from '~/utils/safeStringify';

interface ToolApprovalModalProps {
  approvals: PendingApproval[];
  onDecision: (toolCallId: string, decision: ApprovalDecision) => void;
}

export function ToolApprovalModal({ approvals, onDecision }: ToolApprovalModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
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

  // Default values for missing fields (handle incomplete data)
  const riskLevel = request.riskLevel || 'moderate';
  const isReadOnly = request.isReadOnly ?? false;
  const toolName = request.toolName || currentApproval.toolCall?.name || 'Unknown Tool';
  const toolDescription = request.toolDescription;
  const input = request.input || currentApproval.toolCall?.arguments;

  const getRiskClasses = () => {
    switch (riskLevel) {
      case 'safe':
        return 'text-success border-success';
      case 'moderate': 
        return 'text-warning border-warning';
      case 'destructive':
        return 'text-error border-error';
    }
  };

  const getRiskEmoji = () => {
    switch (riskLevel) {
      case 'safe':
        return '🟢';
      case 'moderate':
        return '🟡';
      case 'destructive':
        return '🔴';
    }
  };

  const formatInput = (input: unknown): string => {
    if (typeof input === 'string') return input;
    return safeStringify(input);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] min-h-0 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold text-base-content mb-1">Tool Approval Required</h2>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getRiskClasses().split(' ')[0]}`}>
                {getRiskEmoji()} {riskLevel.toUpperCase()}
              </span>
              <span className="text-base-content/40">•</span>
              <span className="text-sm text-base-content/60">
                {isReadOnly ? 'Read-only' : 'May modify data'}
              </span>
            </div>
          </div>
          {/* Approval Counter - spec Phase 3.4 */}
          {approvals.length > 1 && (
            <div className="text-sm font-medium text-base-content/60 bg-base-200 px-3 py-1 rounded">
              {currentIndex + 1} of {approvals.length}
            </div>
          )}
        </div>

        {/* Tool Info */}
        <div className={`border-2 rounded-lg p-4 mb-4 ${getRiskClasses()}`}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-lg font-mono font-semibold text-base-content">{toolName}</h3>
              {request.toolAnnotations?.title && (
                <div className="text-sm text-base-content/60 mt-1">{request.toolAnnotations.title}</div>
              )}
              {toolDescription && (
                <p className="text-sm text-base-content/80 mt-2">{toolDescription}</p>
              )}
            </div>
          </div>

          {/* Tool Annotations */}
          {request.toolAnnotations && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {request.toolAnnotations.readOnlyHint && (
                <span className="badge badge-success badge-sm">
                  Read-only
                </span>
              )}
              {request.toolAnnotations.idempotentHint && (
                <span className="badge badge-info badge-sm">
                  Idempotent
                </span>
              )}
              {request.toolAnnotations.destructiveHint && (
                <span className="badge badge-error badge-sm">
                  Destructive
                </span>
              )}
              {request.toolAnnotations.safeInternal && (
                <span className="badge badge-neutral badge-sm">
                  Internal
                </span>
              )}
            </div>
          )}
        </div>

        {/* Parameters */}
        <div className="flex-1 overflow-auto mb-4 min-h-0">
          <h4 className="text-sm font-semibold text-base-content/70 mb-2">Parameters:</h4>
          <div className="mockup-code">
            <pre className="text-sm"><code>{formatInput(input)}</code></pre>
          </div>
        </div>

        {/* Navigation for multiple approvals - spec Phase 3.4 */}
        {approvals.length > 1 && (
          <div className="flex justify-between items-center mb-4 bg-base-200 rounded-lg p-3">
            <button
              onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className="btn btn-sm btn-ghost"
            >
              ← Previous
              <span className="text-xs opacity-70 ml-1">[←]</span>
            </button>
            <span className="text-sm text-base-content/70">
              Navigate between pending approvals
            </span>
            <button
              onClick={() => setCurrentIndex(Math.min(approvals.length - 1, currentIndex + 1))}
              disabled={currentIndex === approvals.length - 1}
              className="btn btn-sm btn-ghost"
            >
              Next →
              <span className="text-xs opacity-70 ml-1">[→]</span>
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_ONCE)}
            className="btn btn-success flex-1"
          >
            Allow Once
            <span className="text-xs opacity-70 ml-2">[Y/A]</span>
          </button>
          <button
            onClick={() => onDecision(currentApproval.toolCallId, ApprovalDecision.ALLOW_SESSION)}
            className="btn btn-info flex-1"
          >
            Allow Session
            <span className="text-xs opacity-70 ml-2">[S]</span>
          </button>
          <button
            onClick={() => onDecision(currentApproval.toolCallId, ApprovalDecision.DENY)}
            className="btn btn-error flex-1"
          >
            Deny
            <span className="text-xs opacity-70 ml-2">[N/D]</span>
          </button>
        </div>

        {/* Help Text */}
        <div className="mt-4 text-xs text-base-content/60 space-y-1">
          <div>
            • <strong>Allow Once:</strong> Approve this specific call only
          </div>
          <div>
            • <strong>Allow Session:</strong> Approve all calls to {toolName} this session
          </div>
          <div>
            • <strong>Deny:</strong> Reject this tool call
          </div>
        </div>
      </div>
    </div>
  );
}