'use client';

import { ChatHeader, ChatInput, MessageList } from '~/components/chat';
import { useChat } from '~/hooks';

export default function ChatInterface() {
  const { messages, input, setInput, isLoading, sendMessage } = useChat();

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      <ChatHeader />
      <div className="flex-1 container mx-auto max-w-4xl p-4 flex flex-col">
        <MessageList messages={messages} isLoading={isLoading} />
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={sendMessage}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
