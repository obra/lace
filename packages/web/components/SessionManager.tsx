// ABOUTME: Session selection and management component
// ABOUTME: Lists active sessions, creates new sessions, switches between sessions

import React, { useState } from 'react';
import { Session, CreateSessionRequest, ThreadId } from '@/types/api';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import { isThreadId } from '@/lib/server/lace-imports';

// Type guard to ensure session has proper ThreadId
function isValidSession(session: Session): session is Session & { id: ThreadId } {
  return typeof session.id === 'string' && isThreadId(session.id);
}

interface SessionManagerProps {
  sessions: Session[];
  currentSessionId: ThreadId | null;
  onSessionSelect: (sessionId: ThreadId) => void;
  onSessionCreate: (session: Session) => void;
}

export function SessionManager({
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionCreate,
}: SessionManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const { createSession, loading, error } = useSessionAPI();

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();

    const request: CreateSessionRequest = {};
    const trimmedName = sessionName.trim();
    if (trimmedName) {
      request.name = trimmedName;
    }

    const session = await createSession(request);
    if (session) {
      onSessionCreate(session);
      setSessionName('');
      setShowCreateForm(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-3 py-1 bg-terminal-green text-black rounded hover:bg-terminal-green/80 transition-colors"
        >
          {showCreateForm ? 'Cancel' : 'New Session'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateSession} className="mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Session name (optional)"
              className="flex-1 px-3 py-1 bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-terminal-green"
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1 bg-terminal-blue text-black rounded hover:bg-terminal-blue/80 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
          {error && <p className="text-terminal-red text-sm mt-1">{error}</p>}
        </form>
      )}

      <div className="space-y-1">
        {sessions.length === 0 ? (
          <p className="text-gray-500 text-sm">No active sessions</p>
        ) : (
          sessions.filter(isValidSession).map((session) => {
            const sessionId = session.id as ThreadId;
            return (
              <button
                key={sessionId}
                onClick={() => onSessionSelect(sessionId)}
                className={`w-full text-left px-3 py-2 rounded transition-colors ${
                  currentSessionId === sessionId
                    ? 'bg-gray-700 text-terminal-fg'
                    : 'hover:bg-gray-800 text-gray-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{session.name}</span>
                  <span className="text-xs text-gray-500">
                    {session.agents.length} agent{session.agents.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {new Date(session.createdAt).toLocaleString()}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
