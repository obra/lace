// ABOUTME: Hash-based routing utilities for client-side navigation state
// ABOUTME: Manages project/session/agent selection persistence via URL hash fragments

export interface AppState {
  project?: string;
  session?: string;
  agent?: string;
}

/**
 * Parse hash fragment into app state
 * Supports: #/project/abc123/session/def456/agent/ghi789
 */
export function parseHash(hash: string): AppState {
  // Remove leading # and /
  const path = hash.replace(/^#?\/?/, '');

  if (!path) {
    return {};
  }

  const segments = path.split('/');
  const state: AppState = {};

  // Parse hierarchical path: project/abc123/session/def456/agent/ghi789
  for (let i = 0; i < segments.length; i += 2) {
    const key = segments[i];
    const value = segments[i + 1];

    if (key && value) {
      if (key === 'project') {
        state.project = value;
      } else if (key === 'session') {
        state.session = value;
      } else if (key === 'agent') {
        state.agent = value;
      }
    }
  }

  return state;
}

/**
 * Build hash fragment from app state
 * Returns: #/project/abc123/session/def456/agent/ghi789
 * Maintains hierarchical order - can't have agent without session, or session without project
 */
export function buildHash(state: AppState): string {
  const segments: string[] = [];

  // Project is the root - always include if present
  if (state.project) {
    segments.push('project', state.project);

    // Session requires project
    if (state.session) {
      segments.push('session', state.session);

      // Agent requires both project and session
      if (state.agent) {
        segments.push('agent', state.agent);
      }
    }
  }

  if (segments.length === 0) {
    return '';
  }

  return '#/' + segments.join('/');
}

/**
 * Get current app state from window.location.hash
 */
export function getCurrentState(): AppState {
  if (typeof window === 'undefined') {
    return {};
  }

  return parseHash(window.location.hash);
}

/**
 * Update URL hash without triggering navigation
 */
export function updateHash(state: AppState, replace = true): void {
  if (typeof window === 'undefined') {
    return;
  }

  const hash = buildHash(state);
  const url = window.location.pathname + window.location.search + hash;

  if (replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
}

/**
 * Listen for hash changes (browser back/forward)
 */
export function onHashChange(callback: (state: AppState) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleHashChange = () => {
    callback(getCurrentState());
  };

  window.addEventListener('hashchange', handleHashChange);

  return () => {
    window.removeEventListener('hashchange', handleHashChange);
  };
}
