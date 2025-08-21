// ABOUTME: Main chat interface component with conversation display and input
// ABOUTME: Contains TimelineView for messages and MemoizedChatInput for sending messages

'use client';

import React, { memo, useCallback } from 'react';
import { TimelineView } from '@/components/timeline/TimelineView';
import { MemoizedChatInput } from '@/components/chat/MemoizedChatInput';
import {
  useSessionEvents,
  useAgentAPI,
  useEventStreamContext,
  useCompactionState,
} from '@/components/providers/EventStreamProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import type { ThreadId, AgentInfo, LaceEvent } from '@/types/core';

export const Chat = memo(function Chat(): React.JSX.Element {
  // Get data from providers
  const { events } = useSessionEvents();
  const { streamingContent } = useEventStreamContext();
  const compactionState = useCompactionState();
  const { sessionDetails, selectedAgent, agentBusy } = useAgentContext();
  const { sendMessage: sendMessageAPI, stopAgent: stopAgentAPI } = useAgentAPI();

  const agents = sessionDetails?.agents;

  // Event handlers using provider methods
  const onSendMessage = useCallback(
    async (message: string) => {
      if (!selectedAgent || !message.trim()) {
        return false;
      }
      return await sendMessageAPI(selectedAgent as ThreadId, message);
    },
    [selectedAgent, sendMessageAPI]
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
      {/* Conversation Display - scrollable area with max width */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4">
          <TimelineView
            events={events}
            agents={agents}
            isTyping={agentBusy}
            currentAgent={currentAgent?.threadId}
            selectedAgent={inputAgentId}
            streamingContent={streamingContent}
            compactionState={compactionState}
          />
        </div>
      </div>

      {/* Chat Input - Fixed at bottom with max width */}
      <div className="flex-shrink-0 pb-6 pt-2 min-h-[80px]">
        <div className="max-w-3xl mx-auto px-4">
          <MemoizedChatInput
            onSubmit={onSendMessage}
            onInterrupt={onStopGeneration}
            disabled={agentBusy}
            isStreaming={agentBusy}
            placeholder={`Message ${inputAgentName}...`}
            agentId={inputAgentId}
          />
        </div>
      </div>
    </div>
  );
});
