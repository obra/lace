// ABOUTME: Smart autoscroll hook for chat timeline
// ABOUTME: Handles autoscroll logic based on user scroll position and message events

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useScrollContext } from '@/components/providers/ScrollProvider';

interface UseSmartAutoscrollOptions {
  // Threshold in pixels from bottom to consider "near bottom"
  nearBottomThreshold?: number;
  // Delay before scrolling to allow for animations
  scrollDelay?: number;
}

interface UseSmartAutoscrollReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: (force?: boolean) => void;
  isNearBottom: () => boolean;
}

export function useSmartAutoscroll({
  nearBottomThreshold = 100,
  scrollDelay = 50,
}: UseSmartAutoscrollOptions = {}): UseSmartAutoscrollReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(true); // Start assuming we're at bottom

  // Check if user is near the bottom of the container
  const isNearBottom = useCallback((): boolean => {
    const container = containerRef.current;
    if (!container) return false;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= nearBottomThreshold;
  }, [nearBottomThreshold]);

  // Scroll to bottom with optional force parameter
  const scrollToBottom = useCallback(
    (force = false) => {
      const container = containerRef.current;
      if (!container) return;

      // Always scroll if forced, or if user was near bottom
      if (force || wasNearBottomRef.current) {
        setTimeout(() => {
          if (container) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'smooth',
            });
            // Update our tracking state
            wasNearBottomRef.current = true;
          }
        }, scrollDelay);
      }
    },
    [scrollDelay]
  );

  // Track user scroll position to maintain near-bottom state
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Update our tracking of whether user is near bottom
      wasNearBottomRef.current = isNearBottom();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isNearBottom]);

  return {
    containerRef,
    scrollToBottom,
    isNearBottom,
  };
}

// Hook specifically for timeline autoscroll with message-aware logic
export function useTimelineAutoscroll(
  events: unknown[],
  isTyping: boolean,
  _streamingContent?: string, // Deprecated: now detected from events
  options?: UseSmartAutoscrollOptions
) {
  const { containerRef, scrollToBottom, isNearBottom } = useSmartAutoscroll(options);
  const { registerScrollHandler } = useScrollContext();
  const prevEventsLengthRef = useRef(0);
  const lastUserMessageTimeRef = useRef<number>(0);
  const hasInitiallyScrolledRef = useRef(false);

  // Register this timeline's scroll handler with the context
  useEffect(() => {
    registerScrollHandler(scrollToBottom);
  }, [registerScrollHandler, scrollToBottom]);

  // Scroll to bottom when content is first loaded from server
  useEffect(() => {
    if (events.length > 0 && !hasInitiallyScrolledRef.current && containerRef.current) {
      hasInitiallyScrolledRef.current = true;
      // Use requestAnimationFrame to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        scrollToBottom(true); // Force scroll on initial load
      });
    }
  }, [events.length, scrollToBottom, containerRef]);

  // Track when user sends a message (events array grows with USER_MESSAGE)
  useEffect(() => {
    const currentLength = events.length;
    const hadNewEvent = currentLength > prevEventsLengthRef.current;

    if (hadNewEvent && events.length > 0) {
      const lastEvent = events[events.length - 1] as { type: string };

      // If the last event is a user message, always scroll (force = true)
      if (lastEvent?.type === 'USER_MESSAGE') {
        lastUserMessageTimeRef.current = Date.now();
        scrollToBottom(true); // Force scroll on user message
      } else {
        // For other events (agent messages, tool calls, etc.), only scroll if near bottom
        scrollToBottom(false);
      }
    }

    prevEventsLengthRef.current = currentLength;
  }, [events, scrollToBottom]);

  // Detect streaming content from events
  const hasStreamingContent = useMemo(() => {
    return events.some((e) => {
      return (
        typeof e === 'object' &&
        e !== null &&
        'type' in e &&
        (e as { type: unknown }).type === 'AGENT_STREAMING'
      );
    });
  }, [events]);

  // Handle typing indicator and streaming content
  useEffect(() => {
    const recentUserMessage = Date.now() - lastUserMessageTimeRef.current < 30000; // 30 seconds

    // Scroll for typing/streaming if we just had a user message or if user is near bottom
    if (isTyping || hasStreamingContent) {
      if (recentUserMessage) {
        scrollToBottom(true); // Force scroll if recent user interaction
      } else {
        scrollToBottom(false); // Smart scroll based on position
      }
    }
  }, [isTyping, hasStreamingContent, scrollToBottom]);

  return {
    containerRef,
    scrollToBottom,
    isNearBottom,
  };
}
