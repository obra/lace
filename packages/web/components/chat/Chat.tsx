// ABOUTME: Main chat interface component with conversation display and input
// ABOUTME: Contains TimelineView for messages and MemoizedChatInput for sending messages

'use client';

import React, { memo } from 'react';
import { TimelineView } from '@/components/timeline/TimelineView';
import { MemoizedChatInput } from '@/components/chat/MemoizedChatInput';
import type { ThreadId, AgentInfo, LaceEvent } from '@/types/core';

interface ChatProps {
  events: LaceEvent[];
  agents: AgentInfo[] | undefined;
  selectedAgent: ThreadId | null;
  agentBusy: boolean;
  onSendMessage: (message: string) => Promise<boolean | void>;
  onStopGeneration?: () => Promise<boolean | void>;
}

export const Chat = memo(function Chat({
  events,
  agents,
  selectedAgent,
  agentBusy,
  onSendMessage,
  onStopGeneration,
}: ChatProps) {
  // Find current agent for display
  const currentAgent = agents?.find((a) => a.threadId === selectedAgent);
  const currentAgentName = currentAgent?.name || 'Agent';

  // Get agent for input (selected or first available)
  const inputAgentId = selectedAgent || agents?.[0]?.threadId;
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
            currentAgent={currentAgentName}
            selectedAgent={inputAgentId}
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
