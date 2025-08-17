'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@/lib/fontawesome';

interface TypingIndicatorProps {
  agent: string;
}

export function TypingIndicator({ agent }: TypingIndicatorProps) {
  const getAgentStyles = (agentName: string) => {
    switch (agentName) {
      case 'Claude':
        return {
          dotClass: 'bg-[rgb(var(--agent-claude))]',
          avatarClass: 'bg-[rgb(var(--agent-claude))] text-white',
        };
      case 'GPT-4':
        return {
          dotClass: 'bg-[rgb(var(--agent-gpt4))]',
          avatarClass: 'bg-[rgb(var(--agent-gpt4))] text-white',
        };
      case 'Gemini':
        return {
          dotClass: 'bg-[rgb(var(--agent-gemini))]',
          avatarClass: 'bg-[rgb(var(--agent-gemini))] text-white',
        };
      default:
        return {
          dotClass: 'bg-neutral',
          avatarClass: 'bg-neutral text-neutral-content',
        };
    }
  };

  const { dotClass, avatarClass } = getAgentStyles(agent);

  return (
    <div className="flex gap-3 lg:gap-4">
      <div className="flex-shrink-0">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${avatarClass}`}
        >
          <FontAwesomeIcon icon={faRobot} className="text-xs" />
        </div>
      </div>
      <div className="bg-base-100 border border-base-300 rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <div className={`w-2 h-2 rounded-full animate-bounce ${dotClass}`}></div>
          <div
            className={`w-2 h-2 rounded-full animate-bounce ${dotClass}`}
            style={{ animationDelay: '0.1s' }}
          ></div>
          <div
            className={`w-2 h-2 rounded-full animate-bounce ${dotClass}`}
            style={{ animationDelay: '0.2s' }}
          ></div>
        </div>
      </div>
    </div>
  );
}
