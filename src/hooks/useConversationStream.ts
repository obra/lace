import { useState, useCallback, useRef } from 'react';
import type { StreamEvent } from '~/types';

interface UseConversationStreamOptions {
  onStreamEvent?: (event: StreamEvent) => void;
  onMessageComplete?: (content: string) => void;
  onError?: (error: string) => void;
}

interface ConversationStreamState {
  isStreaming: boolean;
  isThinking: boolean;
  currentThreadId?: string;
  error?: string;
}

export function useConversationStream({
  onStreamEvent,
  onMessageComplete,
  onError,
}: UseConversationStreamOptions = {}) {
  const [state, setState] = useState<ConversationStreamState>({
    isStreaming: false,
    isThinking: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentContentRef = useRef<string>('');

  const sendMessage = useCallback(
    async (message: string, threadId?: string) => {
      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      currentContentRef.current = '';

      setState({
        isStreaming: true,
        isThinking: false,
        currentThreadId: threadId,
        error: undefined,
      });

      try {
        const response = await fetch('/api/conversations/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            threadId,
            provider: 'anthropic',
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response stream available');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as StreamEvent;
                onStreamEvent?.(event);

                switch (event.type) {
                  case 'connection':
                    setState((prev) => ({
                      ...prev,
                      currentThreadId: event.threadId,
                    }));
                    break;

                  case 'thinking_start':
                    setState((prev) => ({
                      ...prev,
                      isThinking: true,
                    }));
                    break;

                  case 'thinking_complete':
                    setState((prev) => ({
                      ...prev,
                      isThinking: false,
                    }));
                    break;

                  case 'token':
                    if (event.content) {
                      currentContentRef.current += event.content;
                    }
                    break;

                  case 'conversation_complete':
                    setState((prev) => ({
                      ...prev,
                      isStreaming: false,
                      isThinking: false,
                    }));
                    if (currentContentRef.current) {
                      onMessageComplete?.(currentContentRef.current);
                    }
                    break;

                  case 'error':
                    setState((prev) => ({
                      ...prev,
                      isStreaming: false,
                      isThinking: false,
                      error: event.error,
                    }));
                    if (event.error) {
                      onError?.(event.error);
                    }
                    break;
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE event:', parseError);
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          const errorMessage = error.message || 'Failed to send message';
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            isThinking: false,
            error: errorMessage,
          }));
          onError?.(errorMessage);
        }
      }
    },
    [onStreamEvent, onMessageComplete, onError]
  );

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      isThinking: false,
    }));
  }, []);

  return {
    ...state,
    sendMessage,
    stopStream,
  };
}
