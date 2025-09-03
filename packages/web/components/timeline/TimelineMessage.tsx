// ABOUTME: Timeline message component that renders LaceEvent directly
// ABOUTME: Replaces TimelineMessage to work with unified event system

'use client';

import React from 'react';
import type { LaceEvent, AgentInfo } from '@/types/core';
import type { ProcessedEvent } from '@/hooks/useProcessedEvents';
import { MessageHeader, MessageText } from '@/components/ui';
import { ToolCallDisplay } from '@/components/ui/ToolCallDisplay';
import { Alert } from '@/components/ui/Alert';
import { SystemPromptEntry } from '@/components/timeline/SystemPromptEntry';
import { UserSystemPromptEntry } from '@/components/timeline/UserSystemPromptEntry';
import { CompactionEntry } from '@/components/timeline/CompactionEntry';
import { formatTime } from '@/lib/format';

interface TimelineMessageProps {
  event: ProcessedEvent;
  agents?: AgentInfo[];
  isGrouped?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
}

function getAgentName(threadId: string, agents?: AgentInfo[]): string {
  const agent = agents?.find((a) => a.threadId === threadId);
  return agent?.name || 'Assistant';
}

export function TimelineMessage({
  event,
  agents,
  isGrouped = false,
  isFirstInGroup = true,
  isLastInGroup = true,
}: TimelineMessageProps) {
  const timestamp = event.timestamp || new Date();
  const agentName = getAgentName(event.threadId, agents);

  switch (event.type) {
    case 'USER_MESSAGE':
      return (
        <div className={`${isGrouped && !isFirstInGroup ? 'mt-0.5' : isGrouped ? 'mt-2' : 'mt-3'}`}>
          {/* Only show header for first message in group */}
          {isFirstInGroup && (
            <div className="flex gap-3 items-start">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-md bg-[rgb(var(--user-primary))] text-white flex items-center justify-center">
                  <span className="text-xs font-semibold">Me</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="bg-neutral-700/20 rounded-lg px-3 py-2">
                  <MessageText content={event.data} className="!leading-normal" />
                </div>
              </div>
            </div>
          )}
          {!isFirstInGroup && (
            <div
              className={`ml-11 bg-neutral-700/20 rounded-lg px-3 py-2 ${isLastInGroup ? 'mb-1' : ''}`}
            >
              <MessageText content={event.data} className="!leading-normal" />
            </div>
          )}
        </div>
      );

    case 'AGENT_MESSAGE':
      return (
        <div className={`${isGrouped && !isFirstInGroup ? 'mt-0.5' : isGrouped ? 'mt-2' : 'mt-3'}`}>
          {/* Only show header for first message in group */}
          {isFirstInGroup && (
            <MessageHeader name={agentName} timestamp={timestamp} role="assistant" />
          )}
          <div className={`ml-11 ${isLastInGroup ? 'mb-1' : ''}`}>
            <MessageText content={event.data.content} className="!leading-normal" />
          </div>
        </div>
      );

    case 'AGENT_STREAMING':
      return (
        <div className={`${isGrouped && !isFirstInGroup ? 'mt-0.5' : isGrouped ? 'mt-2' : 'mt-3'}`}>
          {/* Only show header for first message in group */}
          {isFirstInGroup && (
            <MessageHeader name={agentName} timestamp={timestamp} role="assistant" />
          )}
          <div className={`ml-11 ${isLastInGroup ? 'mb-1' : ''}`}>
            <MessageText content={event.data.content} className="!leading-normal" />
          </div>
        </div>
      );

    case 'TOOL_AGGREGATED':
      // Use enhanced display for aggregated tools
      return (
        <ToolCallDisplay
          tool={event.data.toolName}
          content={`Tool: ${event.data.toolName}`}
          result={event.data.result}
          timestamp={timestamp}
          metadata={{
            toolId: event.data.toolId,
            arguments: event.data.arguments,
          }}
        />
      );

    case 'TOOL_CALL':
      // Standalone tool call (not aggregated)
      return (
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-md bg-info/20 text-info flex items-center justify-center text-sm">
              <div className="w-3 h-3 bg-info rounded"></div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <MessageHeader name="Tool" timestamp={timestamp} />
            <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
              <div className="text-base-content/80 mb-2 font-mono">$ {event.data.name}</div>
              <div className="text-base-content/60 text-xs whitespace-pre-wrap font-mono">
                {JSON.stringify(event.data.arguments, null, 2)}
              </div>
            </div>
          </div>
        </div>
      );

    case 'TOOL_RESULT':
      // Standalone tool result (not aggregated)
      return (
        <div className="flex gap-3">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-md bg-green-100 text-green-700 flex items-center justify-center text-sm">
              ✓
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <MessageHeader name="Tool Result" timestamp={timestamp} />
            <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
              <div className="text-base-content/60 text-xs whitespace-pre-wrap font-mono">
                {typeof event.data === 'string'
                  ? event.data
                  : event.data.content?.map((block) => block.text).join('') || 'No result'}
              </div>
            </div>
          </div>
        </div>
      );

    case 'LOCAL_SYSTEM_MESSAGE':
      return (
        <div className="flex justify-center">
          <div className="bg-base-200 border border-base-300 rounded-full px-4 py-2 text-sm text-base-content/70">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-info rounded-full"></div>
              <span>{event.data}</span>
            </div>
          </div>
        </div>
      );

    case 'SYSTEM_PROMPT':
      return (
        <SystemPromptEntry content={event.data} timestamp={timestamp} isRecentMessage={false} />
      );

    case 'USER_SYSTEM_PROMPT':
      return (
        <UserSystemPromptEntry content={event.data} timestamp={timestamp} isRecentMessage={false} />
      );

    case 'COMPACTION':
      return <CompactionEntry data={event.data} timestamp={timestamp} />;

    case 'COMPACTION_START':
      return (
        <div className="flex justify-center">
          <Alert
            variant="info"
            title={`Compacting conversation${event.data.auto ? ' (auto)' : ''}...`}
          >
            <span className="loading loading-spinner loading-xs"></span>
          </Alert>
        </div>
      );

    case 'COMPACTION_COMPLETE':
      if (!event.data.success) {
        return (
          <div className="flex justify-center">
            <Alert variant="error" title="Compaction failed" />
          </div>
        );
      }
      return (
        <div className="flex justify-center">
          <Alert variant="success" title="Compaction complete" />
        </div>
      );

    // Task events
    case 'TASK_CREATED':
      return (
        <div className="flex justify-center">
          <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 text-sm text-primary">
            <div className="flex items-center gap-2">
              <span>📝</span>
              <span>Task created: {event.data.task?.title || event.data.taskId}</span>
            </div>
          </div>
        </div>
      );

    case 'TASK_UPDATED':
      return (
        <div className="flex justify-center">
          <Alert
            variant="info"
            title={`Task updated: ${event.data.task?.title || event.data.taskId}`}
          />
        </div>
      );

    case 'TASK_DELETED':
      return (
        <div className="flex justify-center">
          <Alert
            variant="warning"
            title={`Task deleted: ${event.data.task?.title || event.data.taskId}`}
          />
        </div>
      );

    // System notification
    case 'SYSTEM_NOTIFICATION': {
      const severity = event.data?.severity || 'info';
      const variant = severity as 'info' | 'warning' | 'error';

      return (
        <div className="flex justify-center">
          <Alert variant={variant} title={event.data?.message || 'System notification'} />
        </div>
      );
    }

    // These are handled elsewhere or not displayed
    case 'AGENT_TOKEN':
    case 'AGENT_STATE_CHANGE':
    case 'TOOL_APPROVAL_REQUEST':
    case 'TOOL_APPROVAL_RESPONSE':
    case 'AGENT_SPAWNED':
    case 'AGENT_SUMMARY_UPDATED':
    case 'PROJECT_CREATED':
    case 'PROJECT_UPDATED':
    case 'PROJECT_DELETED':
    case 'TASK_NOTE_ADDED':
      return null;

    default:
      // Unknown event type - show debug info in development
      if (process.env.NODE_ENV === 'development') {
        return (
          <div className="flex justify-center">
            <div className="bg-base-200 border border-base-300 rounded-lg px-4 py-2 text-sm text-base-content/50">
              <div className="font-mono text-xs">
                Unknown event: {(event as { type: string }).type}
              </div>
            </div>
          </div>
        );
      }
      return null;
  }
}
