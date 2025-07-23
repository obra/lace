// ABOUTME: React hook for hash-based routing state management
// ABOUTME: Provides URL persistence for project/session/agent selection with browser navigation support

import { useEffect, useState, useMemo } from 'react';
import { AppState, getCurrentState, updateHash, onHashChange } from '@/lib/hash-router';
import { ThreadId } from '@/lib/server/core-types';
import { isValidThreadId } from '@/lib/validation/thread-id-validation';

export function useHashRouter() {
  const [state, setState] = useState<AppState>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const [isUpdatingHash, setIsUpdatingHash] = useState(false);

  // Initialize state from URL on mount
  useEffect(() => {
    const initialState = getCurrentState();
    setState(initialState);
    setIsHydrated(true);
  }, []);

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const cleanup = onHashChange((newState) => {
      // Only update state if we're not the ones updating the hash
      if (!isUpdatingHash) {
        setState(newState);
      }
    });

    return cleanup;
  }, [isUpdatingHash]);

  // Reset isUpdatingHash flag with proper cleanup
  useEffect(() => {
    if (isUpdatingHash) {
      const timer = setTimeout(() => setIsUpdatingHash(false), 0);
      return () => clearTimeout(timer);
    }
  }, [isUpdatingHash]);

  // Update URL when state changes
  const updateState = (newState: Partial<AppState>, replace = true) => {
    const fullState = { ...state, ...newState };
    setState(fullState);

    if (isHydrated) {
      setIsUpdatingHash(true);
      updateHash(fullState, replace);
    }
  };

  // Individual setters for convenience
  const setProject = (project: string | null, replace = true) => {
    if (project === null) {
      // Clear project clears everything downstream
      updateState({ project: undefined, session: undefined, agent: undefined }, replace);
    } else {
      updateState({ project }, replace);
    }
  };

  const setSession = (session: ThreadId | string | null, replace = true) => {
    if (session === null) {
      // Clear session clears agent too
      updateState({ session: undefined, agent: undefined }, replace);
    } else {
      // Validate that session is a valid ThreadId
      if (isValidThreadId(session)) {
        updateState({ session }, replace);
      } else {
        console.warn(`Invalid session ID format: ${session}`);
        updateState({ session: undefined, agent: undefined }, replace);
      }
    }
  };

  const setAgent = (agent: ThreadId | string | null | undefined, replace = true) => {
    if (agent === null || agent === undefined) {
      updateState({ agent: undefined }, replace);
    } else {
      // Validate that agent is a valid ThreadId
      if (isValidThreadId(agent)) {
        updateState({ agent }, replace);
      } else {
        console.warn(`Invalid agent ID format: ${agent}`);
        updateState({ agent: undefined }, replace);
      }
    }
  };

  // Clear all state
  const clearAll = (replace = true) => {
    updateState({ project: undefined, session: undefined, agent: undefined }, replace);
  };

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(() => {
    // Safely cast state values to ThreadId only if they're valid
    const safeSession =
      state.session && isValidThreadId(state.session) ? (state.session as ThreadId) : null;
    const safeAgent =
      state.agent && isValidThreadId(state.agent) ? (state.agent as ThreadId) : null;

    return {
      // Current state (properly typed for Lace)
      project: state.project || null,
      session: safeSession,
      agent: safeAgent,

      // Setters
      setProject,
      setSession,
      setAgent,
      clearAll,

      // Raw state management
      state,
      updateState,

      // Hydration status
      isHydrated,
    };
  }, [state, setProject, setSession, setAgent, clearAll, updateState, isHydrated]);
}
