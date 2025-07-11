import { useCallback } from 'react';
import type { StreamEvent } from '~/types';

interface UseSSEStreamOptions {
  onEvent?: (event: StreamEvent) => void;
  onComplete?: (content: string) => void;
  onError?: (error: string) => void;
}

export function useSSEStream({ onEvent, onComplete, onError }: UseSSEStreamOptions = {}) {
  const processStream = useCallback(async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response stream');
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
            onEvent?.(event);
            
            if (event.type === 'complete' && event.content) {
              onComplete?.(event.content);
            } else if (event.type === 'error' && event.error) {
              onError?.(event.error);
            }
          } catch (parseError) {
            console.warn('Failed to parse SSE event:', parseError);
          }
        }
      }
    }
  }, [onEvent, onComplete, onError]);

  return { processStream };
}