// ABOUTME: Conversation streaming hook for real-time AI chat communication
// ABOUTME: Handles SSE streams, message events, and connection management

import { useState, useCallback, useRef } from 'react';
import type { StreamEvent } from '~/interfaces/web/types';

export interface StreamRequest {
  message: string;
  agentId?: string;
  threadId?: string;
  provider?: string;
  model?: string;
}

interface UseConversationStreamOptions {
  onStreamEvent?: (event: StreamEvent) => void;
  onMessageComplete?: (content: string) => void;
  onError?: (error: string, messageId?: string) => void;
  // Additional callbacks for agent conversation integration
  onToken?: (content: string, messageId: string) => void;
  onComplete?: (finalContent: string, messageId: string) => void;
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
  onToken,
  onComplete,
}: UseConversationStreamOptions = {}) {
  const [state, setState] = useState<ConversationStreamState>({
    isStreaming: false,
    isThinking: false,
    isConnected: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentContentRef = useRef<string>('');

  // Establish persistent SSE connection
  const connectToStream = useCallback(
    async (request: StreamConnectionRequest) => {
      // Abort any existing connection
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: undefined,
      }));

      try {
        const response = await fetch('/api/conversations/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response stream available');
        }

        setState((prev) => ({ ...prev, isConnected: true }));

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
                      // Call onToken callback for real-time updates
                      if (onToken) {
                        // We don't have messageId in this context, so pass the content as messageId for now
                        onToken(currentContentRef.current, 'current-message');
                      }
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
                      // Call onComplete callback for final content
                      if (onComplete) {
                        onComplete(currentContentRef.current, 'current-message');
                      }
                    }
                    // Reset for next message
                    currentContentRef.current = '';
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
          const errorMessage = error.message || 'Failed to connect to stream';
          setState((prev) => ({
            ...prev,
            isConnected: false,
            error: errorMessage,
          }));
          onError?.(errorMessage);
        }
      }
    },
    [onStreamEvent, onMessageComplete, onError, onToken, onComplete]
  );

  // Send message through separate endpoint  
  const sendMessage = useCallback(
    async (message: string, threadId?: string, messageId?: string) => {
      if (!state.isConnected) {
        onError?.('Not connected to stream', messageId);
        return;
      }

      setState((prev) => ({
        ...prev,
        isStreaming: true,
        error: undefined,
      }));

      try {
        const response = await fetch('/api/conversations/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            threadId: threadId || state.currentThreadId,
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        // Success - the response will come through the SSE stream
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: errorMessage,
        }));
        onError?.(errorMessage, messageId);
      }
    },
    [state.isConnected, state.currentThreadId, onError]
  );

  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      isThinking: false,
      isConnected: false,
    }));
  }, []);

  // Legacy compatibility
  const startStream = useCallback(
    async (request: { message: string; threadId?: string }, messageId?: string) => {
      // If not connected, connect first
      if (!state.isConnected) {
        await connectToStream({
          threadId: request.threadId,
          provider: 'anthropic',
        });
      }
      
      // Then send the message
      await sendMessage(request.message, request.threadId, messageId);

      return {
        sessionId: state.currentThreadId,
      };
    },
    [state.isConnected, state.currentThreadId, connectToStream, sendMessage]
  );

  return {
    ...state,
    connectToStream,
    sendMessage,
    startStream, // Legacy compatibility
    disconnect,
    stopStream: disconnect, // Legacy compatibility
    currentThreadId: state.currentThreadId,
  };
}
