// ABOUTME: Session management hook for multi-agent architecture
// ABOUTME: Handles session creation, agent spawning, and session-level operations

import { useState, useCallback, useEffect } from 'react';
import { AgentMetadata, SessionInfo } from '../types/agent';
import { logger } from '../utils/client-logger';

export interface UseSessionOptions {
  sessionId?: string;
  autoLoad?: boolean;
}

export function useSession(options: UseSessionOptions = {}) {
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastFailedOperation, setLastFailedOperation] = useState<string | null>(null);

  // Load session data
  const loadSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/sessions?sessionId=${sessionId}`);
      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status} ${response.statusText}`);
      }
      
      const sessionData = await response.json();
      setCurrentSession(sessionData);
      return sessionData;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load session';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load all sessions
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error(`Failed to load sessions: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      setSessions(data.sessions || []);
      return data.sessions;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load sessions';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Create new session
  const createSession = useCallback(async (name?: string, metadata?: Record<string, unknown>) => {
    const operationKey = `createSession-${name || 'unnamed'}`;
    
    // Prevent retry loops
    if (lastFailedOperation === operationKey && retryCount >= 3) {
      const errorMessage = 'Too many failed attempts to create session. Please refresh the page.';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          metadata,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        const fullError = errorData.details 
          ? `${errorMessage}\n\nDetails: ${errorData.details}`
          : errorMessage;
        
        logger.error('Session creation failed:', {
          status: response.status,
          error: errorData,
          timestamp: errorData.timestamp
        });
        
        throw new Error(fullError);
      }
      
      const sessionData = await response.json();
      setCurrentSession(sessionData);
      setSessions((prev) => [sessionData, ...prev]);
      
      // Reset retry tracking on success
      setRetryCount(0);
      setLastFailedOperation(null);
      
      return sessionData;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
      setError(errorMessage);
      
      // Track failed operations to prevent loops
      if (lastFailedOperation === operationKey) {
        setRetryCount(prev => prev + 1);
      } else {
        setLastFailedOperation(operationKey);
        setRetryCount(1);
      }
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [lastFailedOperation, retryCount]);

  // Create agent in current session
  const createAgent = useCallback(async (config: {
    name?: string;
    provider?: string;
    model?: string;
    role?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (!currentSession) {
      throw new Error('No active session to create agent in');
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: currentSession.id,
          ...config,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create agent: ${response.status} ${response.statusText}`);
      }
      
      const agentData = await response.json();
      
      // Update current session with new agent
      setCurrentSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          agents: [...prev.agents, agentData],
          lastActivity: new Date().toISOString(),
        };
      });
      
      return agentData;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create agent';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentSession]);

  // List agents in session
  const getAgents = useCallback(async (sessionId?: string) => {
    const targetSessionId = sessionId || currentSession?.id;
    if (!targetSessionId) {
      throw new Error('No session ID provided');
    }
    
    try {
      const response = await fetch(`/api/agents?sessionId=${targetSessionId}`);
      if (!response.ok) {
        throw new Error(`Failed to get agents: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.agents || [];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get agents';
      setError(errorMessage);
      throw err;
    }
  }, [currentSession]);

  // Switch to different session
  const switchSession = useCallback(async (sessionId: string) => {
    return loadSession(sessionId);
  }, [loadSession]);

  // Auto-load session on mount if specified
  useEffect(() => {
    if (options.autoLoad && options.sessionId) {
      loadSession(options.sessionId).catch((err) => {
        logger.error('Failed to auto-load session:', err);
      });
    }
  }, [options.autoLoad, options.sessionId, loadSession]);

  return {
    // State
    currentSession,
    sessions,
    isLoading,
    error,
    retryCount,
    lastFailedOperation,
    
    // Actions
    loadSession,
    loadSessions,
    createSession,
    createAgent,
    getAgents,
    switchSession,
  };
}