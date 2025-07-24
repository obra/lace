// ABOUTME: Tool approval modal component for interactive approval decisions  
// ABOUTME: Updated with DaisyUI styling and integrated with new design system

import React, { useEffect } from 'react';
import type { ToolApprovalRequestData } from '@/types/api';
import { ApprovalDecision } from '@/types/api';

interface ToolApprovalModalProps {
  request: ToolApprovalRequestData;
  onDecision: (decision: ApprovalDecision) => void;
}

export function ToolApprovalModal({ request, onDecision }: ToolApprovalModalProps) {

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'y':
        case 'a':
          e.preventDefault();
          onDecision(ApprovalDecision.ALLOW_ONCE);
          break;
        case 's':
          e.preventDefault();
          onDecision(ApprovalDecision.ALLOW_SESSION);
          break;
        case 'n':
        case 'd':
          e.preventDefault();
          onDecision(ApprovalDecision.DENY);
          break;
        case 'escape':
          e.preventDefault();
          onDecision(ApprovalDecision.DENY);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onDecision]);

  const getRiskClasses = () => {
    switch (request.riskLevel) {
      case 'safe':
        return 'text-success border-success';
      case 'moderate': 
        return 'text-warning border-warning';
      case 'destructive':
        return 'text-error border-error';
    }
  };

  const getRiskEmoji = () => {
    switch (request.riskLevel) {
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
    return JSON.stringify(input, null, 2);
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
                {getRiskEmoji()} {request.riskLevel.toUpperCase()}
              </span>
              <span className="text-base-content/40">•</span>
              <span className="text-sm text-base-content/60">
                {request.isReadOnly ? 'Read-only' : 'May modify data'}
              </span>
            </div>
          </div>
        </div>

        {/* Tool Info */}
        <div className={`border-2 rounded-lg p-4 mb-4 ${getRiskClasses()}`}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-lg font-mono font-semibold text-base-content">{request.toolName}</h3>
              {request.toolAnnotations?.title && (
                <div className="text-sm text-base-content/60 mt-1">{request.toolAnnotations.title}</div>
              )}
              {request.toolDescription && (
                <p className="text-sm text-base-content/80 mt-2">{request.toolDescription}</p>
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
            <pre className="text-sm"><code>{formatInput(request.input)}</code></pre>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onDecision(ApprovalDecision.ALLOW_ONCE)}
            className="btn btn-success flex-1"
          >
            Allow Once
            <span className="text-xs opacity-70 ml-2">[Y/A]</span>
          </button>
          <button
            onClick={() => onDecision(ApprovalDecision.ALLOW_SESSION)}
            className="btn btn-info flex-1"
          >
            Allow Session
            <span className="text-xs opacity-70 ml-2">[S]</span>
          </button>
          <button
            onClick={() => onDecision(ApprovalDecision.DENY)}
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
            • <strong>Allow Session:</strong> Approve all calls to {request.toolName} this session
          </div>
          <div>
            • <strong>Deny:</strong> Reject this tool call
          </div>
        </div>
      </div>
    </div>
  );
}