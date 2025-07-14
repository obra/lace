import ChatMessage from '~/components/chat/ChatMessage';
import { Avatar, LoadingDots } from '~/components/ui';
import type { Message } from '~/types';

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
