// ABOUTME: Sessions list component displaying sessions with agents
// ABOUTME: Handles session selection, editing, and agent management within sessions

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faEdit, faPlus } from '@/lib/fontawesome';
import type { SessionInfo, AgentInfo } from '@/types/core';

interface SessionsListProps {
  sessions: SessionInfo[];
  selectedSession: SessionInfo | null;
  loading: boolean;
  onSessionSelect: (sessionId: string) => void;
  onEditSession: () => void;
  onCreateAgent: () => void;
  onCreateSession: () => void;
  onEditAgent: (agent: AgentInfo) => void;
  onAgentSelect: (agentId: string) => void;
}

export const SessionsList = memo(function SessionsList({
  sessions,
  selectedSession,
  loading,
  onSessionSelect,
  onEditSession,
  onCreateAgent,
  onCreateSession,
  onEditAgent,
  onAgentSelect,
}: SessionsListProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-medium text-base-content flex items-center gap-2">
        <FontAwesomeIcon icon={faRobot} className="w-4 h-4" />
        Sessions ({sessions.length})
      </h3>

      {sessions.length === 0 ? (
        <div className="text-center py-8 text-base-content/60">
          <FontAwesomeIcon icon={faRobot} className="w-12 h-12 text-base-content/20 mb-3" />
          <p>No sessions yet</p>
          <p className="text-sm">Create your first session to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((session) => (
              <div
                key={session.id}
                className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md ${
                  selectedSession?.id === session.id
                    ? 'border-primary bg-primary/5'
                    : 'border-base-300 hover:border-primary/50'
                }`}
                onClick={() => onSessionSelect(session.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-base-content">{session.name}</h4>
                    <div className="flex items-center gap-4 mt-2 text-sm text-base-content/60">
                      <span>Created {new Date(session.createdAt).toLocaleDateString()}</span>
                      <span>{session.agents?.length || 0} agents</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {selectedSession?.id === session.id && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditSession();
                          }}
                          className="btn btn-ghost btn-xs"
                          title="Edit Session"
                        >
                          <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCreateAgent();
                          }}
                          className="btn btn-primary btn-xs"
                          title="Launch Agent"
                        >
                          <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Agents List */}
                {selectedSession?.id === session.id &&
                  selectedSession.agents &&
                  selectedSession.agents.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-base-300">
                      <div className="grid gap-2">
                        {selectedSession.agents.map((agent) => (
                          <div
                            key={agent.threadId}
                            className="flex items-center justify-between p-2 bg-base-50 rounded border border-base-200 cursor-pointer hover:bg-base-100 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAgentSelect(agent.threadId);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <FontAwesomeIcon icon={faRobot} className="w-3 h-3 text-primary" />
                              <span className="text-sm font-medium">{agent.name}</span>
                              <span className="text-xs text-base-content/60">
                                {agent.providerInstanceId} • {agent.modelId}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditAgent(agent);
                                }}
                                className="btn btn-ghost btn-xs opacity-60 hover:opacity-100"
                                title="Edit Agent"
                              >
                                <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                              </button>
                              <span
                                className={`badge badge-xs ${
                                  agent.status === 'idle'
                                    ? 'badge-success'
                                    : agent.status === 'streaming' ||
                                        agent.status === 'thinking' ||
                                        agent.status === 'tool_execution'
                                      ? 'badge-warning'
                                      : 'badge-neutral'
                                }`}
                              >
                                {agent.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            ))}
        </div>
      )}

      {/* New Session Button - moved to bottom */}
      <button
        onClick={onCreateSession}
        className="btn btn-primary btn-sm w-full"
        disabled={loading}
      >
        <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
        New Session
      </button>
    </div>
  );
});
