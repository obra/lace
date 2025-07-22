// ABOUTME: Hook for managing conversation stream with SSE connection and message processing
// ABOUTME: Provides real-time streaming conversation interface with event handling

import { useState, useCallback, useRef } from 'react';
import type { StreamEvent } from '@/types';

interface UseConversationStreamOptions {
  onStreamEvent?: (event: StreamEvent) => void;
  onMessageComplete?: (content: string) => void;
  onError?: (error: string) => void;
}

interface ConversationStreamState {
  isConnected: boolean;
  isStreaming: boolean;
  isThinking: boolean;
  currentThreadId: string | null;
  error?: string;
}

export function useConversationStream({
  onStreamEvent,
  onMessageComplete,
  onError,
}: UseConversationStreamOptions = {}) {
  const [state, setState] = useState<ConversationStreamState>({
    isConnected: false,
    isStreaming: false,
    isThinking: false,
    currentThreadId: null,
  });

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentContentRef = useRef<string>('');
  const isProcessingRef = useRef<boolean>(false);
  const connectionKeyRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {
        // Ignore cancel errors
      });
      readerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    connectionKeyRef.current = null;
    setState((prev) => ({ ...prev, isConnected: false, isStreaming: false, isThinking: false }));
  }, []);

  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      onStreamEvent?.(event);

      switch (event.type) {
        case 'connection':
          setState((prev) => ({
            ...prev,
            currentThreadId: event.threadId,
            isConnected: true,
          }));
          connectionKeyRef.current = event.connectionKey || null;
          break;

        case 'thinking_start':
          setState((prev) => ({ ...prev, isThinking: true }));
          break;

        case 'streaming_start':
          setState((prev) => ({ ...prev, isStreaming: true, isThinking: false }));
          break;

        case 'streaming_token':
          if (event.token) {
            currentContentRef.current += event.token;
            setState((prev) => ({ ...prev, currentContent: currentContentRef.current }));
          }
          break;

        case 'streaming_complete':
          setState((prev) => ({ ...prev, isStreaming: false }));

          // Call completion callback if provided
          if (currentContentRef.current) {
            onMessageComplete?.(currentContentRef.current);
          }

          // Reset content for next message
          currentContentRef.current = '';
          break;

        case 'ready_for_input':
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            isThinking: false,
          }));
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
    },
    [onStreamEvent, onMessageComplete, onError]
  );

  const processStream = useCallback(async () => {
    if (!readerRef.current || isProcessingRef.current) return;

    isProcessingRef.current = true;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (readerRef.current) {
        const { done, value } = await readerRef.current.read();

        if (done) {
          // Stream ended naturally
          readerRef.current = null;
          setState((prev) => ({ ...prev, isConnected: false }));
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as StreamEvent;
              handleStreamEvent(event);
            } catch (parseError) {
              console.warn('Failed to parse SSE event:', parseError);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Stream processing error:', error);
        onError?.(`Stream error: ${error.message}`);
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [handleStreamEvent, onError]);

  const sendMessage = useCallback(
    async (message: string, threadId?: string) => {
      if (!message.trim()) return;

      try {
        setState((prev) => ({
          ...prev,
          isStreaming: true,
          isThinking: false,
          error: undefined,
        }));

        currentContentRef.current = '';

        // Create new abort controller if needed
        if (!abortControllerRef.current) {
          abortControllerRef.current = new AbortController();
        }

        // Start new streaming connection for this message
        const response = await fetch('/api/conversations/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            threadId: threadId || state.currentThreadId,
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

        // Set the new reader and start processing
        readerRef.current = reader;
        setState((prev) => ({ ...prev, isConnected: true }));

        // Start reading the stream
        processStream().catch((error) => {
          console.error('Stream processing error:', error);
          onError?.(error instanceof Error ? error.message : 'Stream processing failed');
        });
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
    [state.currentThreadId, processStream, onError]
  );

  const interruptStream = useCallback(() => {
    // Interrupting stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    cleanup();
  }, [cleanup]);

  // Initialize connection on mount
  /*
  useEffect(() => {
    // Don't auto-initialize connection - wait for first message
    return () => {
      cleanup();
    };
  }, [cleanup]);
  */

  return {
    ...state,
    sendMessage,
    interruptStream,
    cleanup,
  };
}
