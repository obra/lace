// ABOUTME: Main chat interface component with conversation display and input
// ABOUTME: Contains TimelineView for messages and MemoizedChatInput for sending messages

'use client';

import React, { memo, useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { TimelineView } from '@/components/timeline/TimelineView';
import { MemoizedChatInput } from '@/components/chat/MemoizedChatInput';
import { useTimelineAutoscroll } from '@/hooks/useSmartAutoscroll';
import {
  useSessionEvents,
  useAgentAPI,
  useCompactionState,
} from '@/components/providers/EventStreamProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useScrollContext } from '@/components/providers/ScrollProvider';
import { useTheme } from '@/components/providers/SettingsProvider';
import type { ThreadId, AgentInfo, LaceEvent } from '@/types/core';

export const Chat = memo(function Chat(): React.JSX.Element {
  // Get data from providers
  const { events } = useSessionEvents();
  const compactionState = useCompactionState();
  const { sessionDetails, selectedAgent, agentBusy } = useAgentContext();
  const { sendMessage: sendMessageAPI, stopAgent: stopAgentAPI } = useAgentAPI();
  const { triggerAutoscroll } = useScrollContext();
  const { getTimelineMaxWidthClass } = useTheme();

  // Handle navigation state for initial message pre-filling
  const [initialMessage, setInitialMessage] = useState<string | null>(null);

  // Safely access router hooks (they may not be available in tests)
  let location: ReturnType<typeof useLocation> | null = null;
  let navigate: ReturnType<typeof useNavigate> | null = null;

  try {
    location = useLocation();
    navigate = useNavigate();
  } catch {
    // Router context not available (e.g., in tests)
  }

  // Read initial message from navigation state and clear it
  useEffect(() => {
    if (!location || !navigate) return;

    const navState = location.state as { initialMessage?: string } | null;
    if (navState?.initialMessage) {
      setInitialMessage(navState.initialMessage);
      // Clear navigation state to prevent re-use on back/forward
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location?.state, location?.pathname, navigate]);

  // Clear initial message after it's been consumed by MemoizedChatInput
  useEffect(() => {
    if (initialMessage) {
      const timeout = setTimeout(() => {
        setInitialMessage(null);
      }, 100); // Small delay to ensure MemoizedChatInput has processed it
      return () => clearTimeout(timeout);
    }
  }, [initialMessage]);

  const agents = sessionDetails?.agents;

  // Smart autoscroll for the main conversation container
  const { containerRef } = useTimelineAutoscroll(events, agentBusy, undefined, {
    nearBottomThreshold: 150,
    scrollDelay: 50,
  });

  // Event handlers using provider methods
  const onSendMessage = useCallback(
    async (message: string) => {
      if (!selectedAgent || !message.trim() || agentBusy) {
        return false; // Prevent sending when agent is busy
      }
      const success = await sendMessageAPI(selectedAgent as ThreadId, message);

      // Trigger forced autoscroll when user sends message
      if (success) {
        triggerAutoscroll(true);
      }

      return success;
    },
    [selectedAgent, sendMessageAPI, triggerAutoscroll, agentBusy]
  );

  const onStopGeneration = useCallback(async () => {
    if (!selectedAgent) return false;
    return await stopAgentAPI(selectedAgent as ThreadId);
  }, [selectedAgent, stopAgentAPI]);
  // Find current agent for display
  const currentAgent = agents?.find((a) => a.threadId === selectedAgent);
  const currentAgentName = currentAgent?.name || 'Agent';

  // Get agent for input (selected or first available)
  const inputAgentId = (selectedAgent as ThreadId) || agents?.[0]?.threadId;
  const inputAgentName = selectedAgent ? currentAgentName : agents?.[0]?.name || 'agent';

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Conversation Display - scrollable area with timeline width control */}
      <div ref={containerRef} className="flex-1 overflow-y-auto" data-testid="conversation-scroll">
        <div
          className={`px-4 sm:px-6 lg:px-8 mx-auto ${getTimelineMaxWidthClass()}`}
          data-testid="conversation-inner"
        >
          <TimelineView
            events={events}
            agents={agents}
            isTyping={agentBusy}
            currentAgent={currentAgent?.threadId}
            selectedAgent={inputAgentId}
            compactionState={compactionState}
          />
        </div>
      </div>

      {/* Chat Input - Fixed at bottom with matching timeline width */}
      <div className="flex-shrink-0 pb-6 pt-2 min-h-[80px]" data-testid="chat-input-container">
        <div
          className={`px-4 sm:px-6 lg:px-8 mx-auto ${getTimelineMaxWidthClass()}`}
          data-testid="chat-input-inner"
        >
          <MemoizedChatInput
            onSubmit={onSendMessage}
            onInterrupt={onStopGeneration}
            disabled={false} // Never disable input - allow typing and Escape key
            sendDisabled={agentBusy} // Disable sending when agent is busy
            isStreaming={agentBusy}
            placeholder={`Message ${inputAgentName}...`}
            agentId={inputAgentId}
            initialValue={initialMessage || undefined}
          />
        </div>
      </div>
    </div>
  );
});
