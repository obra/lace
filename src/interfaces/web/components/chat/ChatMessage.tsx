// ABOUTME: Basic chat message component for displaying user and assistant messages
// ABOUTME: Shows avatar, timestamp, and message content with role-based styling

import React from 'react';
import { Avatar } from '~/interfaces/web/components/ui';
import type { Message } from '~/interfaces/web/types';

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  return (
    <div className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
      <Avatar role={message.role} />
      <div className="chat-header">
        {message.role === 'user' ? 'You' : 'Lace'}
        <time className="text-xs opacity-50 ml-1">{message.timestamp.toLocaleTimeString()}</time>
      </div>
      <div
        className={`chat-bubble ${
          message.role === 'user' ? 'chat-bubble-primary' : 'chat-bubble-secondary'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
