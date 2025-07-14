// ABOUTME: Tool approval modal component for interactive approval decisions
// ABOUTME: Shows tool details, risk level, and allows user to approve/deny execution

import React, { useState, useEffect } from 'react';
import type { ToolApprovalRequestData } from '@/types/api';
import { ApprovalDecision } from '@/lib/server/lace-imports';

interface ToolApprovalModalProps {
  request: ToolApprovalRequestData;
  onDecision: (decision: ApprovalDecision) => void;
  onTimeout: () => void;
}

export function ToolApprovalModal({ request, onDecision, onTimeout }: ToolApprovalModalProps) {
  const [timeLeft, setTimeLeft] = useState(request.timeout || 30);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onTimeout]);

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

  const getRiskColor = () => {
    switch (request.riskLevel) {
      case 'safe':
        return 'text-green-400 border-green-400';
      case 'moderate':
        return 'text-yellow-400 border-yellow-400';
      case 'destructive':
        return 'text-red-400 border-red-400';
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
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-bold mb-1">Tool Approval Required</h2>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${getRiskColor().split(' ')[0]}`}>
                {getRiskEmoji()} {request.riskLevel.toUpperCase()}
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-sm text-gray-400">
                {request.isReadOnly ? 'Read-only' : 'May modify data'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-gray-300">{timeLeft}s</div>
            <div className="text-xs text-gray-500">until auto-deny</div>
          </div>
        </div>

        {/* Tool Info */}
        <div className={`border rounded-lg p-4 mb-4 ${getRiskColor().split(' ')[1]}`}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="text-lg font-mono font-semibold">{request.toolName}</h3>
              {request.toolAnnotations?.title && (
                <div className="text-sm text-gray-400 mt-1">{request.toolAnnotations.title}</div>
              )}
              {request.toolDescription && (
                <p className="text-sm text-gray-300 mt-2">{request.toolDescription}</p>
              )}
            </div>
          </div>

          {/* Tool Annotations */}
          {request.toolAnnotations && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {request.toolAnnotations.readOnlyHint && (
                <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded">
                  Read-only
                </span>
              )}
              {request.toolAnnotations.idempotentHint && (
                <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded">
                  Idempotent
                </span>
              )}
              {request.toolAnnotations.destructiveHint && (
                <span className="text-xs bg-red-900/30 text-red-400 px-2 py-1 rounded">
                  Destructive
                </span>
              )}
              {request.toolAnnotations.safeInternal && (
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
                  Internal
                </span>
              )}
            </div>
          )}
        </div>

        {/* Parameters */}
        <div className="flex-1 overflow-auto mb-4">
          <h4 className="text-sm font-semibold text-gray-400 mb-2">Parameters:</h4>
          <div className="bg-gray-900 rounded p-3 overflow-x-auto">
            <pre className="text-sm text-gray-300 font-mono">{formatInput(request.input)}</pre>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onDecision(ApprovalDecision.ALLOW_ONCE)}
            className="flex-1 px-4 py-3 bg-green-600 rounded hover:bg-green-700 font-medium transition-colors"
          >
            Allow Once
            <span className="text-xs text-green-200 ml-2">[Y/A]</span>
          </button>
          <button
            onClick={() => onDecision(ApprovalDecision.ALLOW_SESSION)}
            className="flex-1 px-4 py-3 bg-blue-600 rounded hover:bg-blue-700 font-medium transition-colors"
          >
            Allow Session
            <span className="text-xs text-blue-200 ml-2">[S]</span>
          </button>
          <button
            onClick={() => onDecision('deny')}
            className="flex-1 px-4 py-3 bg-red-600 rounded hover:bg-red-700 font-medium transition-colors"
          >
            Deny
            <span className="text-xs text-red-200 ml-2">[N/D]</span>
          </button>
        </div>

        {/* Help Text */}
        <div className="mt-4 text-xs text-gray-500 space-y-1">
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
