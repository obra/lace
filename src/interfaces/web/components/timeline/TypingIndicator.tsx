// ABOUTME: Animated typing indicator component for chat interface
// ABOUTME: Shows agent-specific colored bouncing dots during AI response generation

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '~/lib/fontawesome';

interface TypingIndicatorProps {
  agent: string;
}

export function TypingIndicator({ agent }: TypingIndicatorProps) {
  const agentColors = {
    Claude: 'bg-orange-500',
    'GPT-4': 'bg-green-600',
    Gemini: 'bg-blue-600',
  };

  const dotColor = agentColors[agent as keyof typeof agentColors] || 'bg-gray-600';

  return (
    <div className="flex gap-3 lg:gap-4">
      <div className="flex-shrink-0">
        <div
          className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${
            agentColors[agent as keyof typeof agentColors] || 'bg-gray-600'
          } text-white`}
        >
          <FontAwesomeIcon icon={faRobot} className="text-xs" />
        </div>
      </div>
      <div className="bg-base-100 border border-base-300 rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <div className={`w-2 h-2 rounded-full animate-bounce ${dotColor}`}></div>
          <div
            className={`w-2 h-2 rounded-full animate-bounce ${dotColor}`}
            style={{ animationDelay: '0.1s' }}
          ></div>
          <div
            className={`w-2 h-2 rounded-full animate-bounce ${dotColor}`}
            style={{ animationDelay: '0.2s' }}
          ></div>
        </div>
      </div>
    </div>
  );
}