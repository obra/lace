// ABOUTME: React hook for hash-based routing state management
// ABOUTME: Provides URL persistence for project/session/agent selection with browser navigation support

import { useEffect, useState } from 'react';
import { AppState, getCurrentState, updateHash, onHashChange } from '@/lib/hash-router';
import { ThreadId } from '@/lib/server/core-types';

export function useHashRouter() {
  const [state, setState] = useState<AppState>({});
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize state from URL on mount
  useEffect(() => {
    const initialState = getCurrentState();
    setState(initialState);
    setIsHydrated(true);
  }, []);

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const cleanup = onHashChange((newState) => {
      setState(newState);
    });

    return cleanup;
  }, []);

  // Update URL when state changes
  const updateState = (newState: Partial<AppState>, replace = true) => {
    const fullState = { ...state, ...newState };
    setState(fullState);

    if (isHydrated) {
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
      updateState({ session: session as string }, replace);
    }
  };

  const setAgent = (agent: ThreadId | string | null | undefined, replace = true) => {
    if (agent === null || agent === undefined) {
      updateState({ agent: undefined }, replace);
    } else {
      updateState({ agent: agent as string }, replace);
    }
  };

  // Clear all state
  const clearAll = (replace = true) => {
    updateState({ project: undefined, session: undefined, agent: undefined }, replace);
  };

  return {
    // Current state (properly typed for Lace)
    project: state.project || null,
    session: (state.session as ThreadId) || null,
    agent: (state.agent as ThreadId) || null,

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
}
