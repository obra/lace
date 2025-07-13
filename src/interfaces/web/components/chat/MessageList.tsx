// ABOUTME: Message list component for displaying conversation history
// ABOUTME: Renders list of messages with loading indicator for active conversations

import React from 'react';
import ChatMessage from '~/interfaces/web/components/chat/ChatMessage';
import { Avatar, LoadingDots } from '~/interfaces/web/components/ui';
import type { Message } from '~/interfaces/web/types';

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
}

export default function MessageList({ messages, isLoading = false }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto space-y-4 mb-4">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {isLoading && (
        <div className="chat chat-start">
          <Avatar role="assistant" />
          <div className="chat-bubble chat-bubble-secondary">
            <LoadingDots />
          </div>
        </div>
      )}
    </div>
  );
}