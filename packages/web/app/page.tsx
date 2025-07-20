'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  Session,
  ThreadId,
  SessionEvent,
  ToolApprovalRequestData,
  ApprovalDecision,
  Agent,
  SessionsResponse,
  SessionResponse,
  ProjectInfo,
} from '@/types/api';
import { isApiError } from '@/types/api';
import { ConversationDisplay } from '@/components/ConversationDisplay';
import { ToolApprovalModal } from '@/components/ToolApprovalModal';
import { AgentSpawner } from '@/components/AgentSpawner';
import { TaskDashboard } from '@/components/TaskDashboard';
import { ProjectManager } from '@/components/ProjectManager';
import { getAllEventTypes } from '@/types/events';

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<ThreadId | null>(null);
  const [selectedSessionDetails, setSelectedSessionDetails] = useState<Session | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [message, setMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<ThreadId | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequestData | null>(null);
  const [activeTab, setActiveTab] = useState<'conversation' | 'tasks'>('conversation');

  const loadSessions = useCallback(async () => {
    if (!selectedProject) {
      setSessions([]);
      return;
    }

    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load sessions:', data.error);
        return;
      }

      const sessionsData = data as SessionsResponse;
      setSessions(sessionsData.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, [selectedProject]);

  // Load sessions when project is selected
  useEffect(() => {
    void loadSessions();
  }, [selectedProject, loadSessions]);

  const loadSessionDetails = useCallback(async (sessionId: ThreadId) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load session details:', data.error);
        return;
      }

      const sessionResponse = data as SessionResponse;
      setSelectedSessionDetails(sessionResponse.session);
    } catch (error) {
      console.error('Failed to load session details:', error);
    }
  }, []);

  // Connect to SSE when session selected
  useEffect(() => {
    if (!selectedSession) {
      setSelectedSessionDetails(null);
      return;
    }

    // Clear events when switching sessions
    setEvents([]);
    setSelectedAgent(null);

    // Load full session details and conversation history
    void loadSessionDetails(selectedSession);
    void loadConversationHistory(selectedSession);

    const eventSource = new EventSource(`/api/sessions/${selectedSession}/events/stream`);

    // Store event listeners for cleanup
    const eventListeners = new Map<string, (event: MessageEvent) => void>();

    // Listen to all event types
    const eventTypes = getAllEventTypes();

    eventTypes.forEach((eventType) => {
      const listener = (event: MessageEvent) => {
        try {
          const data: unknown = JSON.parse(String(event.data));

          // Type guard for event structure
          if (typeof data === 'object' && data !== null && 'type' in data) {
            const eventData = data as { type: string; data: unknown };

            // Handle approval requests separately
            if (eventData.type === 'TOOL_APPROVAL_REQUEST') {
              setApprovalRequest(eventData.data as ToolApprovalRequestData);
            } else {
              setEvents((prev) => [...prev, data as SessionEvent]);
            }
          }
        } catch (error) {
          console.error('Failed to parse event:', error);
        }
      };

      eventListeners.set(eventType, listener);
      eventSource.addEventListener(eventType, listener);
    });

    const connectionListener = (_event: Event) => {
      const connectionEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedSession as ThreadId,
        timestamp: new Date().toISOString(),
        data: { message: 'Connected to session stream' },
      };
      setEvents((prev) => [...prev, connectionEvent]);
    };

    eventSource.addEventListener('connection', connectionListener);

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      const errorEvent: SessionEvent = {
        type: 'LOCAL_SYSTEM_MESSAGE',
        threadId: selectedSession as ThreadId,
        timestamp: new Date().toISOString(),
        data: { message: 'Connection lost' },
      };
      setEvents((prev) => [...prev, errorEvent]);
    };

    return () => {
      // Remove all event listeners before closing
      eventListeners.forEach((listener, eventType) => {
        eventSource.removeEventListener(eventType, listener);
      });
      eventSource.removeEventListener('connection', connectionListener);
      eventSource.close();
    };
  }, [selectedSession, loadSessionDetails]);

  async function loadConversationHistory(sessionId: ThreadId) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/history`);
      const data: unknown = await res.json();

      if (isApiError(data)) {
        console.error('Failed to load conversation history:', data.error);
        return;
      }

      const historyData = data as { events: SessionEvent[] };
      setEvents(historyData.events || []);
    } catch (error) {
      console.error('Failed to load conversation history:', error);
    }
  }

  async function createSession() {
    if (!sessionName.trim() || !selectedProject) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName }),
      });

      if (res.ok) {
        const data: unknown = await res.json();

        if (isApiError(data)) {
          console.error('Failed to create session:', data.error);
          return;
        }

        const sessionData = data as SessionResponse;
        setSelectedSession(sessionData.session.id as ThreadId);
        setSessionName('');
        await loadSessions();
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
    setLoading(false);
  }

  const handleAgentSpawn = async (agent: Agent) => {
    await loadSessions();
    // Reload session details to include the new agent
    if (selectedSession) {
      await loadSessionDetails(selectedSession);
    }
    // Select the new agent
    setSelectedAgent(agent.threadId as ThreadId);
  };

  const handleProjectCreated = (project: ProjectInfo) => {
    // Project created successfully - could show a notification
    console.warn('Project created:', project);
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProject(projectId);
    // When switching projects, clear session and agent selection
    setSelectedSession(null);
    setSelectedSessionDetails(null);
    setSelectedAgent(null);
    setEvents([]);
  };

  async function handleApprovalDecision(decision: ApprovalDecision) {
    if (!approvalRequest) return;

    try {
      const res = await fetch(`/api/approvals/${approvalRequest.requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: approvalRequest.requestId,
          decision,
          reason: `User ${decision.replace('_', ' ')}`,
        }),
      });

      if (!res.ok) {
        console.error('Failed to submit approval decision');
      }

      setApprovalRequest(null);
    } catch (error) {
      console.error('Failed to submit approval decision:', error);
    }
  }

  function handleApprovalTimeout() {
    setApprovalRequest(null);
  }

  async function sendMessage() {
    if (!selectedAgent || !message.trim()) return;

    setSendingMessage(true);
    try {
      const res = await fetch(`/api/threads/${selectedAgent}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (res.ok) {
        setMessage('');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
    setSendingMessage(false);
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex">
      <div className="h-screen flex w-full">
        {/* Sidebar */}
        <div className="w-80 bg-gray-800 h-full overflow-y-auto border-r border-gray-700">
          <div className="p-4">
            <h1 className="text-2xl font-bold mb-6">Lace</h1>

            {/* Project Management */}
            <ProjectManager
              selectedProjectId={selectedProject}
              onProjectSelect={handleProjectSelect}
              onProjectCreated={handleProjectCreated}
            />

            {/* Session Creation - Only show if a project is selected */}
            {selectedProject && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-3">New Session</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    placeholder="Session name..."
                    className="flex-1 px-3 py-2 bg-gray-700 rounded text-white text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && createSession()}
                    data-testid="session-name-input"
                  />
                  <button
                    onClick={createSession}
                    disabled={loading || !sessionName.trim()}
                    className="px-3 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                    data-testid="create-session-button"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}

            {/* Sessions List - Only show if a project is selected */}
            {selectedProject && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-3">Sessions</h2>
                {sessions.length === 0 ? (
                  <p className="text-gray-400 text-sm">No sessions yet</p>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div
                        key={String(session.id)}
                        onClick={() => setSelectedSession(session.id as ThreadId)}
                        className={`p-3 rounded cursor-pointer text-sm ${
                          selectedSession === session.id
                            ? 'bg-blue-600'
                            : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                      >
                        <div className="font-semibold">{session.name}</div>
                        <div className="text-xs text-gray-300">
                          {session.agents?.length || 0} agents •{' '}
                          {new Date(session.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{session.id}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Agent Management - Only show if a session is selected */}
            {selectedSession && selectedProject && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Agents</h2>
                <AgentSpawner sessionId={selectedSession as ThreadId} onAgentSpawn={handleAgentSpawn} />

                {/* Agent List */}
                <div className="mt-4 space-y-2" data-testid="agent-list">
                  {selectedSessionDetails?.agents?.map((agent) => (
                      <div
                        key={String(agent.threadId)}
                        onClick={() => setSelectedAgent(agent.threadId as ThreadId)}
                        className={`p-3 rounded cursor-pointer text-sm ${
                          selectedAgent === agent.threadId
                            ? 'bg-green-600'
                            : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                        data-testid="agent-item"
                      >
                        <div className="font-semibold">{agent.name}</div>
                        <div className="text-xs text-gray-300">
                          {agent.provider} • {agent.model}
                        </div>
                        <div className="text-xs text-gray-400">Status: {agent.status}</div>
                        <div className="text-xs text-gray-400 font-mono">{agent.threadId}</div>
                        {agent.createdAt && (
                          <div className="text-xs text-gray-500">
                            {new Date(agent.createdAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-full">
          {selectedProject ? (
            selectedSession ? (
            <>
              {/* Tab Navigation */}
              <div className="bg-gray-800 border-b border-gray-700">
                <nav className="flex space-x-8 px-6">
                  <button
                    onClick={() => setActiveTab('conversation')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeTab === 'conversation'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    Conversation
                  </button>
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeTab === 'tasks'
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    Tasks
                  </button>
                </nav>
              </div>

              {/* Tab Content */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {activeTab === 'conversation' ? (
                  <>
                    {selectedAgent ? (
                      <>
                        {/* Conversation Display */}
                        <div className="flex-1 overflow-hidden">
                          <ConversationDisplay
                            events={events}
                            agents={selectedSessionDetails?.agents || []}
                            selectedAgent={selectedAgent as ThreadId}
                            className="h-full p-4"
                            isLoading={loading}
                          />
                        </div>

                        {/* Message Input at Bottom */}
                        <div className="border-t border-gray-700 p-4 bg-gray-800">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={message}
                              onChange={(e) => setMessage(e.target.value)}
                              placeholder="Type your message..."
                              className="flex-1 px-4 py-2 bg-gray-700 rounded text-white"
                              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                              disabled={sendingMessage}
                              data-testid="message-input"
                            />
                            <button
                              onClick={sendMessage}
                              disabled={sendingMessage || !message.trim()}
                              className="px-6 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                              data-testid="send-message-button"
                            >
                              Send
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        Select an agent to start chatting
                      </div>
                    )}
                  </>
                ) : (
                  // Tasks Tab
                  <div className="flex-1 overflow-y-auto bg-gray-900">
                    <div className="max-w-7xl mx-auto p-6">
                      <TaskDashboard sessionId={String(selectedSession)} />
                    </div>
                  </div>
                )}
              </div>
            </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                Select a session to get started
              </div>
            )
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              Select a project to get started
            </div>
          )}
        </div>
      </div>

      {/* Tool Approval Modal */}
      {approvalRequest && (
        <ToolApprovalModal
          request={approvalRequest}
          onDecision={handleApprovalDecision}
          onTimeout={handleApprovalTimeout}
        />
      )}
    </div>
  );
}
