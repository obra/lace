'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStop, faRobot } from '@/lib/fontawesome';

interface StreamingIndicatorProps {
  isVisible: boolean;
  onInterrupt?: () => void;
  agent?: string;
}

export function StreamingIndicator({
  isVisible,
  onInterrupt,
  agent = 'Claude',
}: StreamingIndicatorProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-base-100 border border-base-300 rounded-full px-4 py-2 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center">
            <FontAwesomeIcon icon={faRobot} className="text-white text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-base-content">{agent} is responding</span>
            <div className="flex gap-1">
              <div className="w-1 h-1 bg-orange-500 rounded-full animate-pulse"></div>
              <div
                className="w-1 h-1 bg-orange-500 rounded-full animate-pulse"
                style={{ animationDelay: '0.2s' }}
              ></div>
              <div
                className="w-1 h-1 bg-orange-500 rounded-full animate-pulse"
                style={{ animationDelay: '0.4s' }}
              ></div>
            </div>
          </div>
        </div>

        {onInterrupt && (
          <button
            onClick={onInterrupt}
            className="ml-2 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors text-xs"
            title="Stop response (ESC)"
          >
            <FontAwesomeIcon icon={faStop} className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
