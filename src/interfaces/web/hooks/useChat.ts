// ABOUTME: Chat hook providing message management and API communication
// ABOUTME: Handles user input, message sending, and streaming responses
import { useState, useCallback } from 'react';
import type { Message } from '~/types';
import { useSSEStream } from '~/interfaces/web/hooks/useSSEStream';

const INITIAL_MESSAGE: Message = {
  id: '1',
  role: 'assistant',
  content: "Hello! I'm Lace, your AI coding assistant. How can I help you today?",
  timestamp: new Date(),
};

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const updateMessageContent = useCallback((messageId: string, content: string) => {
    setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, content } : msg)));
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Create assistant message for streaming
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch('/api/lace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Create a stream processor with message-specific completion handler
      const { processStream } = useSSEStream({
        onComplete: (content: string) => {
          updateMessageContent(assistantMessageId, content);
        },
      });

      await processStream(response);
      setIsLoading(false);
    } catch (error) {
      console.error('Error calling API:', error);
      updateMessageContent(
        assistantMessageId,
        'Sorry, there was an error connecting to the Lace backend. Please try again.'
      );
      setIsLoading(false);
    }
  }, [input, isLoading, updateMessageContent]);

  return {
    messages,
    input,
    setInput,
    isLoading,
    sendMessage,
  };
}
