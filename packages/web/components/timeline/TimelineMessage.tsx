// ABOUTME: Timeline message component that renders ProcessedEvent
// ABOUTME: Works with unified AppEvent system

'use client';

import React from 'react';
import type { AgentInfo, CompactionData, ToolCall, ToolResult } from '@lace/web/types/core';
import { getProcessedEventAgentId, type ProcessedEvent } from '@lace/web/hooks/useProcessedEvents';
import { MessageHeader, MessageText } from '@lace/web/components/ui';
import { ToolCallDisplay } from '@lace/web/components/ui/ToolCallDisplay';
import { Alert } from '@lace/web/components/ui/Alert';
import { SystemPromptEntry } from '@lace/web/components/timeline/SystemPromptEntry';
import { UserSystemPromptEntry } from '@lace/web/components/timeline/UserSystemPromptEntry';
import { CompactionEntry } from '@lace/web/components/timeline/CompactionEntry';
import { AgentErrorEntry } from '@lace/web/components/timeline/AgentErrorEntry';
import { formatTime } from '@lace/web/lib/format';

// Type-safe data accessors for ProcessedEvent
// Since ProcessedEvent includes InternalTimelineEvent with unknown data,
// we need explicit type assertions after narrowing by event.type
function getEventDataAsString(event: ProcessedEvent): string {
  if ('data' in event && typeof event.data === 'string') {
    return event.data;
  }
  return '';
}

function getEventDataContent(event: ProcessedEvent): string {
  if ('data' in event && event.data && typeof event.data === 'object') {
    const data = event.data as { content?: unknown };
    return typeof data.content === 'string' ? data.content : '';
  }
  return '';
}

interface ToolAggregatedData {
  call: ToolCall;
  result?: ToolResult;
  toolName: string;
  toolId?: string;
  arguments?: unknown;
}

function getToolAggregatedData(event: ProcessedEvent): ToolAggregatedData | null {
  if (event.type === 'TOOL_AGGREGATED' && 'data' in event && event.data) {
    return event.data as ToolAggregatedData;
  }
  return null;
}

function getCompactionData(event: ProcessedEvent): CompactionData | null {
  if (event.type === 'COMPACTION' && 'data' in event && event.data) {
    return event.data as CompactionData;
  }
  return null;
}

interface ToolCallEventData {
  name: string;
  arguments?: unknown;
}

function getToolCallEventData(event: ProcessedEvent): ToolCallEventData {
  if ('data' in event && event.data && typeof event.data === 'object') {
    const data = event.data as ToolCallEventData;
    return { name: data.name || 'unknown', arguments: data.arguments };
  }
  return { name: 'unknown' };
}

interface ToolResultEventData {
  content?: Array<{ text?: string }>;
}

function getToolResultText(event: ProcessedEvent): string {
  if ('data' in event) {
    if (typeof event.data === 'string') return event.data;
    if (event.data && typeof event.data === 'object') {
      const data = event.data as ToolResultEventData;
      if (Array.isArray(data.content)) {
        return data.content.map((block) => block?.text ?? '').join('');
      }
    }
  }
  return 'No result';
}

interface CompactionStartData {
  auto?: boolean;
}

function getCompactionStartData(event: ProcessedEvent): CompactionStartData {
  if ('data' in event && event.data && typeof event.data === 'object') {
    return event.data as CompactionStartData;
  }
  return {};
}

interface CompactionCompleteData {
  success?: boolean;
}

function getCompactionCompleteData(event: ProcessedEvent): CompactionCompleteData {
  if ('data' in event && event.data && typeof event.data === 'object') {
    return event.data as CompactionCompleteData;
  }
  return {};
}

interface SystemNotificationData {
  severity?: string;
  message?: string;
}

function getSystemNotificationData(event: ProcessedEvent): SystemNotificationData {
  if ('data' in event && event.data && typeof event.data === 'object') {
    return event.data as SystemNotificationData;
  }
  return {};
}

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

// Helper to check if event has visibleToModel property
function getEventVisibility(event: ProcessedEvent): boolean {
  if ('visibleToModel' in event) {
    return (event as { visibleToModel?: boolean }).visibleToModel !== false;
  }
  return true; // Default to visible
}

export function TimelineMessage({
  event,
  agents,
  isGrouped = false,
  isFirstInGroup = true,
  isLastInGroup = true,
}: TimelineMessageProps) {
  const timestamp = event.timestamp || new Date();
  const agentId = getProcessedEventAgentId(event) || '';
  const agentName = getAgentName(agentId, agents);

  // Check if event is visible to model (undefined/true = visible, false = not visible)
  const isVisibleToModel = getEventVisibility(event);

  // Base classes for visibility styling
  const visibilityClasses = isVisibleToModel ? '' : 'opacity-40';

  switch (event.type) {
    case 'USER_MESSAGE':
      return (
        <div className={`${isGrouped && !isFirstInGroup ? 'mt-0.5' : isGrouped ? 'mt-2' : 'mt-3'}`}>
          {/* Only show header for first message in group */}
          {isFirstInGroup && (
            <div
              className={`flex gap-3 items-start transition-opacity duration-200 ${visibilityClasses}`}
            >
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-md bg-[rgb(var(--user-primary))] text-white flex items-center justify-center">
                  <span className="text-xs font-semibold">Me</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="bg-neutral-700/20 rounded-lg px-3 py-2">
                  <MessageText content={getEventDataAsString(event)} className="!leading-normal" />
                </div>
              </div>
            </div>
          )}
          {!isFirstInGroup && (
            <div
              className={`ml-11 bg-neutral-700/20 rounded-lg px-3 py-2 ${isLastInGroup ? 'mb-1' : ''} transition-opacity duration-200 ${visibilityClasses}`}
            >
              <MessageText content={getEventDataAsString(event)} className="!leading-normal" />
            </div>
          )}
          {!isVisibleToModel && (
            <div className="ml-11 -mt-2">
              <span className="badge badge-ghost badge-xs opacity-60">Compacted</span>
            </div>
          )}
        </div>
      );

    case 'AGENT_MESSAGE':
      return (
        <div className={`${isGrouped && !isFirstInGroup ? 'mt-0.5' : isGrouped ? 'mt-2' : 'mt-3'}`}>
          {/* Only show header for first message in group */}
          {isFirstInGroup && (
            <div className={`transition-opacity duration-200 ${visibilityClasses}`}>
              <MessageHeader name={agentName} timestamp={timestamp} role="assistant" />
            </div>
          )}
          <div
            className={`ml-11 ${isLastInGroup ? 'mb-1' : ''} transition-opacity duration-200 ${visibilityClasses}`}
          >
            <MessageText content={getEventDataContent(event)} className="!leading-normal" />
          </div>
          {!isVisibleToModel && (
            <div className="ml-11 -mt-2">
              <span className="badge badge-ghost badge-xs opacity-60">Compacted</span>
            </div>
          )}
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
            <MessageText content={getEventDataContent(event)} className="!leading-normal" />
          </div>
        </div>
      );

    case 'TOOL_AGGREGATED': {
      // Use enhanced display for aggregated tools
      const toolData = getToolAggregatedData(event);
      if (!toolData) return null;
      return (
        <div className={`my-2 transition-opacity duration-200 ${visibilityClasses}`}>
          <ToolCallDisplay
            tool={toolData.toolName}
            content={`Tool: ${toolData.toolName}`}
            result={toolData.result}
            timestamp={timestamp}
            metadata={{
              toolId: toolData.toolId,
              arguments: toolData.arguments,
            }}
          />
          {!isVisibleToModel && (
            <div className="ml-11 -mt-2">
              <span className="badge badge-ghost badge-xs opacity-60">Compacted</span>
            </div>
          )}
        </div>
      );
    }

    case 'TOOL_CALL': {
      // Standalone tool call (not aggregated)
      const tcData = getToolCallEventData(event);
      return (
        <div className={`flex gap-3 transition-opacity duration-200 ${visibilityClasses}`}>
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-md bg-info/20 text-info flex items-center justify-center text-sm">
              <div className="w-3 h-3 bg-info rounded"></div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <MessageHeader name="Tool" timestamp={timestamp} />
            <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
              <div className="text-base-content/80 mb-2 font-mono">$ {tcData.name}</div>
              <div className="text-base-content/60 text-xs whitespace-pre-wrap font-mono">
                {JSON.stringify(tcData.arguments, null, 2)}
              </div>
            </div>
            {!isVisibleToModel && (
              <div className="ml-11 -mt-2">
                <span className="badge badge-ghost badge-xs opacity-60">Compacted</span>
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'TOOL_RESULT':
      // Standalone tool result (not aggregated)
      return (
        <div className={`flex gap-3 transition-opacity duration-200 ${visibilityClasses}`}>
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-md bg-green-100 text-green-700 flex items-center justify-center text-sm">
              ✓
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <MessageHeader name="Tool Result" timestamp={timestamp} />
            <div className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300">
              <div className="text-base-content/60 text-xs whitespace-pre-wrap font-mono">
                {getToolResultText(event)}
              </div>
            </div>
            {!isVisibleToModel && (
              <div className="ml-11 -mt-2">
                <span className="badge badge-ghost badge-xs opacity-60">Compacted</span>
              </div>
            )}
          </div>
        </div>
      );

    case 'LOCAL_SYSTEM_MESSAGE':
      return (
        <div className="flex justify-center">
          <div className="bg-base-200 border border-base-300 rounded-full px-4 py-2 text-sm text-base-content/70">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-info rounded-full"></div>
              <span>{getEventDataAsString(event) || getEventDataContent(event)}</span>
            </div>
          </div>
        </div>
      );

    case 'SYSTEM_PROMPT':
      return (
        <SystemPromptEntry
          content={getEventDataAsString(event)}
          timestamp={timestamp}
          isRecentMessage={false}
        />
      );

    case 'USER_SYSTEM_PROMPT':
      return (
        <UserSystemPromptEntry
          content={getEventDataAsString(event)}
          timestamp={timestamp}
          isRecentMessage={false}
        />
      );

    case 'COMPACTION': {
      const compData = getCompactionData(event);
      if (!compData) return null;
      return (
        <div className={`transition-opacity duration-200 ${visibilityClasses}`}>
          <CompactionEntry data={compData} timestamp={timestamp} />
          {!isVisibleToModel && (
            <div className="ml-11 -mt-2">
              <span className="badge badge-ghost badge-xs opacity-60">Compacted</span>
            </div>
          )}
        </div>
      );
    }

    case 'COMPACTION_START': {
      const csData = getCompactionStartData(event);
      return (
        <div className="flex justify-center">
          <Alert variant="info" title={`Compacting conversation${csData.auto ? ' (auto)' : ''}...`}>
            <span className="loading loading-spinner loading-xs"></span>
          </Alert>
        </div>
      );
    }

    case 'COMPACTION_COMPLETE': {
      const ccData = getCompactionCompleteData(event);
      if (!ccData.success) {
        return (
          <div className="flex justify-center">
            <Alert variant="error" title="Compaction failed" style="soft" />
          </div>
        );
      }
      return (
        <div className="flex justify-center">
          <Alert variant="success" title="Compaction complete" />
        </div>
      );
    }

    // System notification
    case 'SYSTEM_NOTIFICATION': {
      const snData = getSystemNotificationData(event);
      const severity = snData.severity || 'info';
      const variant = severity as 'info' | 'warning' | 'error';

      return (
        <div className="flex justify-center">
          <Alert variant={variant} title={snData.message || 'System notification'} />
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
      return null;

    case 'AGENT_ERROR':
      return <AgentErrorEntry event={event} />;

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
