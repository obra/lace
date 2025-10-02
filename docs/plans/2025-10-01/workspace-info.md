# Workspace Visibility Implementation Plan

## Overview

Add workspace mode visibility to the web UI so users can see whether a session is running in a container or locally, and view detailed workspace information including paths, container details, and git branch information.

## Background

Lace supports two workspace modes:
- **Container mode**: Creates isolated git worktrees in containers with dual mounts (working tree + git database)
- **Local mode**: Runs directly on host without containers, using project directory directly

Currently, the web UI doesn't show which mode a session uses or provide visibility into workspace details. Users need this information to understand where their edits are happening.

## Architecture Context

### Key Types and Interfaces

**WorkspaceInfo** (`packages/core/src/workspace/workspace-container-manager.ts:10-18`):
```typescript
export interface WorkspaceInfo {
  sessionId: string;
  projectDir: string;          // Original project location
  clonePath: string;            // Worktree path (container) or projectDir (local)
  containerId: string;          // "workspace-{sessionId}" or "local-{sessionId}"
  state: string;                // "running", "stopped", etc.
  containerMountPath?: string;  // Where project is mounted in container
  branchName?: string;          // Git branch for this session
}
```

**Session Methods** (`packages/core/src/sessions/session.ts`):
- `getWorkspaceInfo()`: Returns `WorkspaceInfo | undefined` (line 743-745)
- `getEffectiveConfiguration()`: Returns merged project+session config including `workspaceMode` (line 948-978)
- `waitForWorkspace()`: Waits for workspace initialization to complete (line 812-820)

**Workspace Modes**:
- Determined by `workspaceMode` field in session configuration
- Type: `'container' | 'local'` (from `packages/core/src/workspace/workspace-manager.ts:24`)

### Data Flow

1. Session creation → WorkspaceManager creates workspace in background (async)
2. SessionProvider → fetches workspace info via API
3. SessionSection (sidebar) → displays mode badge
4. SessionConfigModal → shows detailed workspace information

## Implementation Tasks

### Task 1: Create API Endpoint for Workspace Information

**Goal**: Expose workspace data to the web UI through a new API endpoint.

**Files to Create/Modify**:
- Create: `packages/web/app/routes/api.sessions.$sessionId.workspace.ts`
- Reference: `packages/web/app/routes/api.sessions.$sessionId.ts` (similar structure)

**Implementation Steps**:

1. Create the route file with loader function:
```typescript
// ABOUTME: API endpoint for session workspace information
// ABOUTME: Returns workspace mode and detailed workspace info

import { json, type LoaderFunctionArgs } from 'react-router';
import { Session } from '@lace/core/sessions/session';
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';

export async function loader({ params }: LoaderFunctionArgs) {
  const { sessionId } = params;

  if (!sessionId) {
    return json({ error: 'Session ID required' }, { status: 400 });
  }

  try {
    const session = await Session.getById(sessionId);
    if (!session) {
      return json({ error: 'Session not found' }, { status: 404 });
    }

    // Wait for workspace initialization if in progress
    await session.waitForWorkspace();

    // Get workspace mode from effective configuration
    const config = session.getEffectiveConfiguration();
    const mode = (config.workspaceMode as 'container' | 'local') || 'local';

    // Get workspace info (may be undefined if not initialized)
    const info = session.getWorkspaceInfo();

    return json({ mode, info: info || null });
  } catch (error) {
    console.error('Failed to fetch workspace info:', error);
    return json(
      { error: 'Failed to fetch workspace information' },
      { status: 500 }
    );
  }
}
```

2. Register the route in `packages/web/app/routes.ts`:
```typescript
// Add to the routes array:
route('api/sessions/:sessionId/workspace', 'routes/api.sessions.$sessionId.workspace.ts'),
```

**Testing**:

Create test file: `packages/web/app/routes/__tests__/api.sessions.$sessionId.workspace.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loader } from '../api.sessions.$sessionId.workspace';
import { Session } from '@lace/core/sessions/session';
import { Project } from '@lace/core/projects/project';
import { getPersistence } from '@lace/core/persistence/database';
import { setupTestEnvironment, cleanupTestEnvironment } from '@/test-utils/test-helpers';

describe('GET /api/sessions/:sessionId/workspace', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
    Session.clearRegistry();
  });

  it('returns 400 if session ID is missing', async () => {
    const response = await loader({ params: {} } as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Session ID required');
  });

  it('returns 404 if session does not exist', async () => {
    const response = await loader({
      params: { sessionId: 'nonexistent' }
    } as any);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
  });

  it('returns workspace info for local mode session', async () => {
    // Create test project
    const project = Project.create({
      name: 'Test Project',
      workingDirectory: '/test/project',
    });

    // Create session with local workspace mode
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {
        workspaceMode: 'local',
      },
    });

    // Wait for workspace initialization
    await session.waitForWorkspace();

    const response = await loader({
      params: { sessionId: session.getId() },
    } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.mode).toBe('local');
    expect(data.info).toBeDefined();
    expect(data.info.sessionId).toBe(session.getId());
    expect(data.info.state).toBe('running');
  });

  it('returns workspace info for container mode session', async () => {
    // Skip on non-macOS platforms (containers only supported on macOS)
    if (process.platform !== 'darwin') {
      return;
    }

    // Create test project
    const project = Project.create({
      name: 'Test Project',
      workingDirectory: '/test/project',
    });

    // Create session with container workspace mode
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {
        workspaceMode: 'container',
      },
    });

    // Wait for workspace initialization
    await session.waitForWorkspace();

    const response = await loader({
      params: { sessionId: session.getId() },
    } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.mode).toBe('container');
    expect(data.info).toBeDefined();
    expect(data.info.containerId).toMatch(/^workspace-/);
    expect(data.info.branchName).toBeDefined();
    expect(data.info.containerMountPath).toBe('/workspace');
  });

  it('handles sessions where workspace is not yet initialized', async () => {
    // Create test project
    const project = Project.create({
      name: 'Test Project',
      workingDirectory: '/test/project',
    });

    // Create session
    const session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
      configuration: {
        workspaceMode: 'local',
      },
    });

    // Don't wait for workspace initialization - test immediate response

    const response = await loader({
      params: { sessionId: session.getId() },
    } as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.mode).toBe('local');
    // Info may be null if not initialized yet
    expect(data.info === null || typeof data.info === 'object').toBe(true);
  });
});
```

**Manual Testing**:
1. Start dev server: `npm run dev`
2. Create a session in the UI
3. Use browser dev tools or curl to test the endpoint:
   ```bash
   curl http://localhost:5173/api/sessions/{sessionId}/workspace
   ```
4. Verify response contains `mode` and `info` fields

**Commit Message**:
```
feat(api): add workspace information endpoint

Add GET /api/sessions/:sessionId/workspace endpoint that returns
workspace mode (container/local) and detailed WorkspaceInfo.

- Waits for workspace initialization before responding
- Returns null info if workspace not yet initialized
- Handles missing sessions with 404
- Includes comprehensive test coverage
```

---

### Task 2: Extend SessionProvider with Workspace Data

**Goal**: Add workspace mode and info to SessionProvider context so both sidebar and modal can access it.

**Files to Modify**:
- `packages/web/components/providers/SessionProvider.tsx`
- `packages/web/components/providers/__tests__/SessionProvider.test.tsx`

**Implementation Steps**:

1. Update the context interface (around line 15-20):
```typescript
interface SessionContextValue {
  sessionDetails: SessionDetails | null;
  isLoading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  workspaceMode: 'container' | 'local' | undefined;  // NEW
  workspaceInfo: WorkspaceInfo | null | undefined;    // NEW
}
```

2. Import WorkspaceInfo type at the top:
```typescript
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';
```

3. Add state variables in SessionProvider component (around line 40-45):
```typescript
const [workspaceMode, setWorkspaceMode] = useState<'container' | 'local' | undefined>(undefined);
const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null | undefined>(undefined);
```

4. Create function to fetch workspace data:
```typescript
const fetchWorkspaceData = async (sessionId: string) => {
  try {
    const response = await api.get<{
      mode: 'container' | 'local';
      info: WorkspaceInfo | null;
    }>(`/api/sessions/${sessionId}/workspace`);

    setWorkspaceMode(response.mode);
    setWorkspaceInfo(response.info);
  } catch (error) {
    console.error('Failed to fetch workspace data:', error);
    // Set to undefined on error to indicate failure
    setWorkspaceMode(undefined);
    setWorkspaceInfo(undefined);
  }
};
```

5. Update the useEffect that fetches session details to also fetch workspace data:
```typescript
useEffect(() => {
  if (!sessionId) {
    setSessionDetails(null);
    setWorkspaceMode(undefined);
    setWorkspaceInfo(undefined);
    return;
  }

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch session details
      const response = await api.get<SessionDetails>(
        `/api/sessions/${sessionId}`
      );
      setSessionDetails(response);

      // Fetch workspace data
      await fetchWorkspaceData(sessionId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load session';
      setError(errorMessage);
      setSessionDetails(null);
      setWorkspaceMode(undefined);
      setWorkspaceInfo(undefined);
    } finally {
      setIsLoading(false);
    }
  };

  void fetchData();
}, [sessionId]);
```

6. Update the context value to include new fields:
```typescript
const value: SessionContextValue = {
  sessionDetails,
  isLoading,
  error,
  refreshSession,
  workspaceMode,
  workspaceInfo,
};
```

7. Update refreshSession to also refresh workspace data:
```typescript
const refreshSession = async () => {
  if (!sessionId) return;

  try {
    const response = await api.get<SessionDetails>(
      `/api/sessions/${sessionId}`
    );
    setSessionDetails(response);

    // Refresh workspace data
    await fetchWorkspaceData(sessionId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to refresh session';
    setError(errorMessage);
  }
};
```

**Testing**:

Update test file: `packages/web/components/providers/__tests__/SessionProvider.test.tsx`

Add these tests:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider, useSessionContext } from '../SessionProvider';
import { api } from '@/lib/api-client';
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';

// Mock api client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

// Test component to access context
function TestComponent() {
  const { sessionDetails, workspaceMode, workspaceInfo, isLoading } = useSessionContext();

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div data-testid="session-name">{sessionDetails?.name}</div>
      <div data-testid="workspace-mode">{workspaceMode}</div>
      <div data-testid="workspace-info">{workspaceInfo ? 'present' : 'null'}</div>
    </div>
  );
}

describe('SessionProvider workspace data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and provides workspace mode and info', async () => {
    const mockSessionDetails = {
      id: 'session-1',
      name: 'Test Session',
    };

    const mockWorkspaceData = {
      mode: 'local' as const,
      info: {
        sessionId: 'session-1',
        projectDir: '/test/project',
        clonePath: '/test/project',
        containerId: 'local-session-1',
        state: 'running',
      } as WorkspaceInfo,
    };

    // Mock API responses
    vi.mocked(api.get)
      .mockResolvedValueOnce(mockSessionDetails) // Session details
      .mockResolvedValueOnce(mockWorkspaceData); // Workspace data

    render(
      <SessionProvider sessionId="session-1">
        <TestComponent />
      </SessionProvider>
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
    });

    expect(screen.getByTestId('workspace-mode')).toHaveTextContent('local');
    expect(screen.getByTestId('workspace-info')).toHaveTextContent('present');

    // Verify API calls
    expect(api.get).toHaveBeenCalledWith('/api/sessions/session-1');
    expect(api.get).toHaveBeenCalledWith('/api/sessions/session-1/workspace');
  });

  it('handles container mode workspace', async () => {
    const mockSessionDetails = {
      id: 'session-2',
      name: 'Container Session',
    };

    const mockWorkspaceData = {
      mode: 'container' as const,
      info: {
        sessionId: 'session-2',
        projectDir: '/test/project',
        clonePath: '/test/worktree',
        containerId: 'workspace-session-2',
        state: 'running',
        containerMountPath: '/workspace',
        branchName: 'session-2',
      } as WorkspaceInfo,
    };

    vi.mocked(api.get)
      .mockResolvedValueOnce(mockSessionDetails)
      .mockResolvedValueOnce(mockWorkspaceData);

    render(
      <SessionProvider sessionId="session-2">
        <TestComponent />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-mode')).toHaveTextContent('container');
    });

    expect(screen.getByTestId('workspace-info')).toHaveTextContent('present');
  });

  it('handles missing workspace info gracefully', async () => {
    const mockSessionDetails = {
      id: 'session-3',
      name: 'New Session',
    };

    const mockWorkspaceData = {
      mode: 'local' as const,
      info: null, // Workspace not initialized yet
    };

    vi.mocked(api.get)
      .mockResolvedValueOnce(mockSessionDetails)
      .mockResolvedValueOnce(mockWorkspaceData);

    render(
      <SessionProvider sessionId="session-3">
        <TestComponent />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-mode')).toHaveTextContent('local');
    });

    expect(screen.getByTestId('workspace-info')).toHaveTextContent('null');
  });

  it('handles workspace fetch errors', async () => {
    const mockSessionDetails = {
      id: 'session-4',
      name: 'Error Session',
    };

    vi.mocked(api.get)
      .mockResolvedValueOnce(mockSessionDetails)
      .mockRejectedValueOnce(new Error('Workspace fetch failed'));

    render(
      <SessionProvider sessionId="session-4">
        <TestComponent />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-name')).toHaveTextContent('Error Session');
    });

    // Should show undefined when fetch fails
    expect(screen.getByTestId('workspace-mode')).toHaveTextContent('');
  });

  it('clears workspace data when sessionId changes', async () => {
    const { rerender } = render(
      <SessionProvider sessionId="session-1">
        <TestComponent />
      </SessionProvider>
    );

    // Change to no session
    rerender(
      <SessionProvider sessionId={undefined}>
        <TestComponent />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-mode')).toHaveTextContent('');
    });
  });
});
```

**Manual Testing**:
1. Add temporary debug output in a component that uses SessionProvider
2. Create a session and verify workspace data appears in React DevTools
3. Switch between sessions and verify data updates
4. Check browser console for any errors

**Commit Message**:
```
feat(web): add workspace data to SessionProvider

Extend SessionProvider to fetch and provide workspace mode and
workspace info to all consuming components.

- Add workspaceMode and workspaceInfo to context
- Fetch workspace data when session loads
- Update on session refresh
- Clear on session change
- Comprehensive test coverage for all scenarios
```

---

### Task 3: Add Workspace Badge to SessionSection Sidebar

**Goal**: Display workspace mode badge in the sidebar that opens the SessionConfigModal.

**Files to Modify**:
- `packages/web/components/sidebar/SessionSection.tsx`
- `packages/web/components/sidebar/__tests__/SessionSection.test.tsx`

**Implementation Steps**:

1. Import necessary items at the top of SessionSection.tsx:
```typescript
import { faBox, faFolder } from '@/lib/fontawesome'; // Add these icons
```

2. Get workspace data from context (add after line 35 where other context is accessed):
```typescript
const { workspaceMode, workspaceInfo } = useSessionContext();
```

3. Create workspace badge component (add after permission mode handler, around line 78):
```typescript
// Workspace badge component
const WorkspaceBadge = () => {
  if (!workspaceMode) return null;

  const isContainer = workspaceMode === 'container';
  const badgeClass = isContainer ? 'badge-primary' : 'badge-ghost';
  const icon = isContainer ? faBox : faFolder;
  const label = isContainer ? 'Container' : 'Local';

  return (
    <button
      onClick={handleConfigureSession}
      className={`badge ${badgeClass} gap-1 cursor-pointer hover:opacity-80 transition-opacity`}
      title={`Click to view ${label.toLowerCase()} workspace details`}
      data-testid="workspace-badge"
    >
      <FontAwesomeIcon icon={icon} className="w-3 h-3" />
      <span>{label}</span>
    </button>
  );
};
```

4. Add the badge to the UI (inside the SidebarSection children, after permission mode selector around line 155):
```typescript
<div className="p-3 space-y-3">
  {/* Permission Mode Selector */}
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <label className="text-xs font-medium text-base-content/70 uppercase tracking-wide">
        Permissions
      </label>
      <PermissionModeBadge mode={permissionMode} />
    </div>
    <PermissionModeSelector
      value={permissionMode}
      onChange={handlePermissionModeChange}
      disabled={isUpdatingMode}
      size="sm"
    />
  </div>

  {/* Workspace Badge - NEW */}
  {workspaceMode && (
    <div className="space-y-2">
      <label className="text-xs font-medium text-base-content/70 uppercase tracking-wide">
        Workspace
      </label>
      <div className="flex">
        <WorkspaceBadge />
      </div>
    </div>
  )}
</div>
```

**Testing**:

Update test file: `packages/web/components/sidebar/__tests__/SessionSection.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionSection } from '../SessionSection';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useProjectsContext } from '@/components/providers/ProjectsProvider';
import { useURLState } from '@/hooks/useURLState';

// Mock all the hooks
vi.mock('@/components/providers/SessionProvider');
vi.mock('@/components/providers/ProjectsProvider');
vi.mock('@/hooks/useURLState');

describe('SessionSection workspace badge', () => {
  const mockSessionDetails = {
    id: 'session-1',
    name: 'Test Session',
  };

  const mockSelectedProject = {
    id: 'project-1',
    name: 'Test Project',
  };

  beforeEach(() => {
    vi.mocked(useProjectsContext).mockReturnValue({
      selectedProject: mockSelectedProject,
    } as any);

    vi.mocked(useURLState).mockReturnValue({
      navigateToProject: vi.fn(),
    } as any);
  });

  it('displays container workspace badge', () => {
    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: 'container',
      workspaceInfo: {
        sessionId: 'session-1',
        projectDir: '/test',
        clonePath: '/test/worktree',
        containerId: 'workspace-session-1',
        state: 'running',
      },
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(<SessionSection />);

    const badge = screen.getByTestId('workspace-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Container');
    expect(badge).toHaveClass('badge-primary');
  });

  it('displays local workspace badge', () => {
    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: 'local',
      workspaceInfo: {
        sessionId: 'session-1',
        projectDir: '/test',
        clonePath: '/test',
        containerId: 'local-session-1',
        state: 'running',
      },
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(<SessionSection />);

    const badge = screen.getByTestId('workspace-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Local');
    expect(badge).toHaveClass('badge-ghost');
  });

  it('does not display badge when workspace mode is undefined', () => {
    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: undefined,
      workspaceInfo: null,
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(<SessionSection />);

    expect(screen.queryByTestId('workspace-badge')).not.toBeInTheDocument();
  });

  it('calls onConfigureSession when badge is clicked', () => {
    const onConfigureSession = vi.fn();

    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: 'container',
      workspaceInfo: null,
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(<SessionSection onConfigureSession={onConfigureSession} />);

    const badge = screen.getByTestId('workspace-badge');
    fireEvent.click(badge);

    expect(onConfigureSession).toHaveBeenCalledTimes(1);
  });

  it('shows appropriate title on hover', () => {
    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: 'container',
      workspaceInfo: null,
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(<SessionSection />);

    const badge = screen.getByTestId('workspace-badge');
    expect(badge).toHaveAttribute('title', 'Click to view container workspace details');
  });
});
```

**Manual Testing**:
1. Start dev server and open the app
2. Create a session with local mode (default)
3. Verify "Local" badge appears in sidebar with ghost styling
4. Click badge and verify SessionConfigModal opens
5. Create or switch to a container mode session (if on macOS)
6. Verify "Container" badge appears with primary styling

**Commit Message**:
```
feat(web): add workspace mode badge to sidebar

Add clickable badge to SessionSection showing workspace mode
(Container/Local). Badge opens SessionConfigModal for details.

- Container mode: primary badge with box icon
- Local mode: ghost badge with folder icon
- Hidden when workspace mode unavailable
- Opens config modal on click
- Full test coverage
```

---

### Task 4: Create WorkspaceDetailsPanel Component

**Goal**: Create a reusable component that displays comprehensive workspace information.

**Files to Create**:
- `packages/web/components/config/WorkspaceDetailsPanel.tsx`
- `packages/web/components/config/__tests__/WorkspaceDetailsPanel.test.tsx`

**Implementation Steps**:

1. Create the component file with type-safe props:

```typescript
// ABOUTME: Displays comprehensive workspace information for a session
// ABOUTME: Shows unified view with conditional fields based on workspace mode

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBox, faFolder, faCircle } from '@/lib/fontawesome';
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';

interface WorkspaceDetailsPanelProps {
  mode: 'container' | 'local';
  info: WorkspaceInfo | null | undefined;
  isLoading?: boolean;
}

export function WorkspaceDetailsPanel({
  mode,
  info,
  isLoading = false
}: WorkspaceDetailsPanelProps) {
  if (isLoading) {
    return (
      <div className="p-6 text-center">
        <div className="loading loading-spinner loading-lg"></div>
        <p className="mt-4 text-base-content/60">Loading workspace information...</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="p-6 text-center">
        <p className="text-base-content/60">Workspace not yet initialized</p>
      </div>
    );
  }

  const isContainer = mode === 'container';

  // State indicator
  const getStateColor = (state: string) => {
    switch (state) {
      case 'running':
        return 'text-success';
      case 'stopped':
        return 'text-warning';
      default:
        return 'text-base-content/50';
    }
  };

  return (
    <div className="space-y-6 p-6" data-testid="workspace-details-panel">
      {/* Header Section */}
      <div className="flex items-center gap-3 pb-4 border-b border-base-300">
        <div className={`p-3 rounded-lg ${isContainer ? 'bg-primary/10' : 'bg-base-200'}`}>
          <FontAwesomeIcon
            icon={isContainer ? faBox : faFolder}
            className={`w-6 h-6 ${isContainer ? 'text-primary' : 'text-base-content/70'}`}
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold">
            {isContainer ? 'Container Workspace' : 'Local Workspace'}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <FontAwesomeIcon
              icon={faCircle}
              className={`w-2 h-2 ${getStateColor(info.state)}`}
            />
            <span className="text-sm text-base-content/60 capitalize">{info.state}</span>
          </div>
        </div>
      </div>

      {/* Primary Information */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
          Primary Information
        </h4>

        <DetailRow label="Working Directory" value={info.clonePath} />
        <DetailRow label="Session ID" value={info.sessionId} mono />
      </div>

      {/* Container-Specific Information */}
      {isContainer && (
        <>
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
              Container Details
            </h4>

            <DetailRow label="Container ID" value={info.containerId} mono />
            {info.containerMountPath && (
              <DetailRow label="Container Mount Path" value={info.containerMountPath} mono />
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
              Git Configuration
            </h4>

            {info.branchName && (
              <DetailRow label="Branch" value={info.branchName} mono />
            )}
            <DetailRow label="Worktree Path" value={info.clonePath} mono />
            <DetailRow label="Original Project" value={info.projectDir} mono />
          </div>
        </>
      )}

      {/* Local Mode Information */}
      {!isContainer && (
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
            Local Details
          </h4>

          <DetailRow label="Project Directory" value={info.projectDir} mono />
          <div className="alert alert-info">
            <div className="flex flex-col gap-1">
              <div className="font-medium">Direct Project Access</div>
              <div className="text-sm opacity-80">
                This session runs directly in your project directory without isolation.
                Changes affect the working tree immediately.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailRow({ label, value, mono = false }: DetailRowProps) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 items-start">
      <dt className="text-sm font-medium text-base-content/70">{label}</dt>
      <dd className={`text-sm text-base-content break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
```

**Testing**:

Create comprehensive tests:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceDetailsPanel } from '../WorkspaceDetailsPanel';
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';

describe('WorkspaceDetailsPanel', () => {
  const baseContainerInfo: WorkspaceInfo = {
    sessionId: 'session-123',
    projectDir: '/home/user/project',
    clonePath: '/home/user/.lace/worktrees/session-123',
    containerId: 'workspace-session-123',
    state: 'running',
    containerMountPath: '/workspace',
    branchName: 'session-123',
  };

  const baseLocalInfo: WorkspaceInfo = {
    sessionId: 'session-456',
    projectDir: '/home/user/local-project',
    clonePath: '/home/user/local-project',
    containerId: 'local-session-456',
    state: 'running',
  };

  describe('loading state', () => {
    it('displays loading spinner when isLoading is true', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={null}
          isLoading={true}
        />
      );

      expect(screen.getByText(/loading workspace information/i)).toBeInTheDocument();
      expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('displays message when info is null', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={null}
        />
      );

      expect(screen.getByText(/workspace not yet initialized/i)).toBeInTheDocument();
    });

    it('displays message when info is undefined', () => {
      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={undefined}
        />
      );

      expect(screen.getByText(/workspace not yet initialized/i)).toBeInTheDocument();
    });
  });

  describe('container mode', () => {
    it('displays container workspace header', () => {
      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={baseContainerInfo}
        />
      );

      expect(screen.getByText('Container Workspace')).toBeInTheDocument();
    });

    it('displays primary information', () => {
      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={baseContainerInfo}
        />
      );

      expect(screen.getByText('Working Directory')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.clonePath)).toBeInTheDocument();
      expect(screen.getByText('Session ID')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.sessionId)).toBeInTheDocument();
    });

    it('displays container-specific details', () => {
      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={baseContainerInfo}
        />
      );

      expect(screen.getByText('Container Details')).toBeInTheDocument();
      expect(screen.getByText('Container ID')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.containerId)).toBeInTheDocument();
      expect(screen.getByText('Container Mount Path')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.containerMountPath!)).toBeInTheDocument();
    });

    it('displays git configuration', () => {
      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={baseContainerInfo}
        />
      );

      expect(screen.getByText('Git Configuration')).toBeInTheDocument();
      expect(screen.getByText('Branch')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.branchName!)).toBeInTheDocument();
      expect(screen.getByText('Worktree Path')).toBeInTheDocument();
      expect(screen.getByText('Original Project')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.projectDir)).toBeInTheDocument();
    });

    it('displays running state with success color', () => {
      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={baseContainerInfo}
        />
      );

      const stateText = screen.getByText('running');
      expect(stateText).toBeInTheDocument();
      const stateIcon = stateText.parentElement?.querySelector('.text-success');
      expect(stateIcon).toBeInTheDocument();
    });

    it('displays stopped state with warning color', () => {
      const stoppedInfo = { ...baseContainerInfo, state: 'stopped' };

      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={stoppedInfo}
        />
      );

      const stateText = screen.getByText('stopped');
      expect(stateText).toBeInTheDocument();
      const stateIcon = stateText.parentElement?.querySelector('.text-warning');
      expect(stateIcon).toBeInTheDocument();
    });

    it('handles missing optional fields gracefully', () => {
      const minimalInfo: WorkspaceInfo = {
        sessionId: 'session-789',
        projectDir: '/project',
        clonePath: '/worktree',
        containerId: 'container-789',
        state: 'running',
      };

      render(
        <WorkspaceDetailsPanel
          mode="container"
          info={minimalInfo}
        />
      );

      // Should not crash, primary info should be present
      expect(screen.getByText(minimalInfo.sessionId)).toBeInTheDocument();
      // Optional fields should not cause errors
      expect(screen.queryByText('Container Mount Path')).not.toBeInTheDocument();
      expect(screen.queryByText('Branch')).not.toBeInTheDocument();
    });
  });

  describe('local mode', () => {
    it('displays local workspace header', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={baseLocalInfo}
        />
      );

      expect(screen.getByText('Local Workspace')).toBeInTheDocument();
    });

    it('displays primary information', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={baseLocalInfo}
        />
      );

      expect(screen.getByText('Working Directory')).toBeInTheDocument();
      expect(screen.getByText(baseLocalInfo.clonePath)).toBeInTheDocument();
    });

    it('displays local details section', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={baseLocalInfo}
        />
      );

      expect(screen.getByText('Local Details')).toBeInTheDocument();
      expect(screen.getByText('Project Directory')).toBeInTheDocument();
      expect(screen.getByText(baseLocalInfo.projectDir)).toBeInTheDocument();
    });

    it('displays direct access information alert', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={baseLocalInfo}
        />
      );

      expect(screen.getByText('Direct Project Access')).toBeInTheDocument();
      expect(screen.getByText(/runs directly in your project directory/i)).toBeInTheDocument();
    });

    it('does not display container-specific sections', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={baseLocalInfo}
        />
      );

      expect(screen.queryByText('Container Details')).not.toBeInTheDocument();
      expect(screen.queryByText('Git Configuration')).not.toBeInTheDocument();
    });
  });

  describe('data-testid', () => {
    it('has testid on main container when info is present', () => {
      render(
        <WorkspaceDetailsPanel
          mode="local"
          info={baseLocalInfo}
        />
      );

      expect(screen.getByTestId('workspace-details-panel')).toBeInTheDocument();
    });
  });
});
```

**Manual Testing**:
1. Create a Storybook story or temporary test page
2. Render with container mode info and verify all fields display
3. Render with local mode info and verify simplified display
4. Test with null/undefined info and verify graceful handling
5. Test with partial data (missing optional fields)

**Commit Message**:
```
feat(web): add WorkspaceDetailsPanel component

Create reusable component for displaying comprehensive workspace
information with conditional rendering based on mode.

- Unified display for container and local modes
- Clear information hierarchy (primary/container/git sections)
- Graceful handling of missing/partial data
- Loading and empty states
- Visual state indicators (running/stopped)
- Comprehensive test coverage
```

---

### Task 5: Integrate WorkspaceDetailsPanel into SessionConfigModal

**Goal**: Add a "Workspace" tab to the SessionConfigModal that displays the WorkspaceDetailsPanel.

**Files to Modify**:
- `packages/web/components/config/SessionConfigPanel.tsx`

**Implementation Steps**:

1. Import necessary items at the top:
```typescript
import { WorkspaceDetailsPanel } from './WorkspaceDetailsPanel';
import { useSessionContext } from '@/components/providers/SessionProvider';
```

2. Get workspace data from context (add where other data is accessed):
```typescript
const { workspaceMode, workspaceInfo } = useSessionContext();
```

3. Add workspace tab to the tab list (find where tabs are defined, likely around the role="tablist" section):
```typescript
<div role="tablist" className="tabs tabs-boxed">
  {/* Existing tabs... */}
  <button
    role="tab"
    className={`tab ${activeTab === 'workspace' ? 'tab-active' : ''}`}
    onClick={() => setActiveTab('workspace')}
    data-testid="workspace-tab"
  >
    Workspace
  </button>
</div>
```

4. Add workspace tab content panel (where other tab content panels are rendered):
```typescript
{activeTab === 'workspace' && (
  <div data-testid="workspace-tab-content">
    {workspaceMode ? (
      <WorkspaceDetailsPanel
        mode={workspaceMode}
        info={workspaceInfo}
        isLoading={false}
      />
    ) : (
      <div className="p-6 text-center">
        <p className="text-base-content/60">
          Workspace information unavailable
        </p>
      </div>
    )}
  </div>
)}
```

5. If the modal accepts an `initialTab` prop to open directly to a specific tab, add support for 'workspace':
```typescript
interface SessionConfigPanelProps {
  sessionId: string;
  onClose: () => void;
  initialTab?: 'general' | 'permissions' | 'workspace'; // Add 'workspace'
}
```

**Testing**:

Since SessionConfigPanel likely has existing tests, update them:

```typescript
// Add to existing test file
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionConfigPanel } from '../SessionConfigPanel';
import { useSessionContext } from '@/components/providers/SessionProvider';

vi.mock('@/components/providers/SessionProvider');

describe('SessionConfigPanel workspace tab', () => {
  const mockSessionDetails = {
    id: 'session-1',
    name: 'Test Session',
  };

  const mockWorkspaceInfo = {
    sessionId: 'session-1',
    projectDir: '/test/project',
    clonePath: '/test/project',
    containerId: 'local-session-1',
    state: 'running',
  };

  beforeEach(() => {
    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: 'local',
      workspaceInfo: mockWorkspaceInfo,
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });
  });

  it('displays workspace tab', () => {
    render(
      <SessionConfigPanel
        sessionId="session-1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('workspace-tab')).toBeInTheDocument();
  });

  it('shows workspace details when tab is clicked', () => {
    render(
      <SessionConfigPanel
        sessionId="session-1"
        onClose={vi.fn()}
      />
    );

    const workspaceTab = screen.getByTestId('workspace-tab');
    fireEvent.click(workspaceTab);

    expect(screen.getByTestId('workspace-tab-content')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-details-panel')).toBeInTheDocument();
  });

  it('opens to workspace tab when initialTab prop is set', () => {
    render(
      <SessionConfigPanel
        sessionId="session-1"
        onClose={vi.fn()}
        initialTab="workspace"
      />
    );

    // Tab should be active
    const workspaceTab = screen.getByTestId('workspace-tab');
    expect(workspaceTab).toHaveClass('tab-active');

    // Content should be visible
    expect(screen.getByTestId('workspace-details-panel')).toBeInTheDocument();
  });

  it('displays message when workspace mode is unavailable', () => {
    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: undefined,
      workspaceInfo: null,
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(
      <SessionConfigPanel
        sessionId="session-1"
        onClose={vi.fn()}
        initialTab="workspace"
      />
    );

    expect(screen.getByText(/workspace information unavailable/i)).toBeInTheDocument();
  });

  it('passes correct props to WorkspaceDetailsPanel', () => {
    render(
      <SessionConfigPanel
        sessionId="session-1"
        onClose={vi.fn()}
        initialTab="workspace"
      />
    );

    const panel = screen.getByTestId('workspace-details-panel');
    expect(panel).toBeInTheDocument();

    // Verify data is displayed (checking for a key piece of info)
    expect(screen.getByText('Local Workspace')).toBeInTheDocument();
    expect(screen.getByText(mockWorkspaceInfo.clonePath)).toBeInTheDocument();
  });
});
```

**Manual Testing**:
1. Open SessionConfigModal from any session
2. Click on the new "Workspace" tab
3. Verify workspace details display correctly
4. Test with both container and local mode sessions
5. Click workspace badge in sidebar and verify modal opens
6. If initialTab support was added, verify badge click opens directly to workspace tab

**Commit Message**:
```
feat(web): add workspace tab to SessionConfigModal

Integrate WorkspaceDetailsPanel into SessionConfigModal as a new
"Workspace" tab for comprehensive workspace information.

- Add workspace tab to modal navigation
- Display WorkspaceDetailsPanel with session workspace data
- Support initialTab prop to open directly to workspace
- Handle unavailable workspace data gracefully
- Test coverage for tab integration
```

---

### Task 6: Connect Workspace Badge Click to Modal Tab

**Goal**: Make the workspace badge in the sidebar open the SessionConfigModal directly to the Workspace tab.

**Files to Modify**:
- `packages/web/components/sidebar/SessionSection.tsx` (minor update)
- `packages/web/components/config/SessionConfigPanel.tsx` (if not already done in Task 5)

**Implementation Steps**:

1. Update the workspace badge click handler in SessionSection.tsx:

```typescript
// Update the WorkspaceBadge component onClick handler
const WorkspaceBadge = () => {
  if (!workspaceMode) return null;

  const isContainer = workspaceMode === 'container';
  const badgeClass = isContainer ? 'badge-primary' : 'badge-ghost';
  const icon = isContainer ? faBox : faFolder;
  const label = isContainer ? 'Container' : 'Local';

  const handleClick = () => {
    // Open config modal to workspace tab
    // This assumes onConfigureSession can accept an optional tab parameter
    onConfigureSession?.('workspace'); // Pass the tab name
  };

  return (
    <button
      onClick={handleClick}
      className={`badge ${badgeClass} gap-1 cursor-pointer hover:opacity-80 transition-opacity`}
      title={`Click to view ${label.toLowerCase()} workspace details`}
      data-testid="workspace-badge"
    >
      <FontAwesomeIcon icon={icon} className="w-3 h-3" />
      <span>{label}</span>
    </button>
  );
};
```

2. Update the SessionSectionProps interface to accept optional tab parameter:
```typescript
interface SessionSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onConfigureSession?: (initialTab?: string) => void; // Update signature
}
```

3. In the parent component that renders SessionSection (likely in a route file), update to handle the initialTab parameter:

```typescript
// Example from parent component
const [configModalOpen, setConfigModalOpen] = useState(false);
const [configModalInitialTab, setConfigModalInitialTab] = useState<string | undefined>();

const handleConfigureSession = (initialTab?: string) => {
  setConfigModalInitialTab(initialTab);
  setConfigModalOpen(true);
};

// When rendering the modal:
{configModalOpen && (
  <SessionConfigModal
    sessionId={sessionId}
    initialTab={configModalInitialTab as 'general' | 'permissions' | 'workspace'}
    onClose={() => {
      setConfigModalOpen(false);
      setConfigModalInitialTab(undefined);
    }}
  />
)}
```

**Testing**:

Update SessionSection tests:

```typescript
describe('SessionSection workspace badge navigation', () => {
  it('calls onConfigureSession with workspace tab parameter', () => {
    const onConfigureSession = vi.fn();

    vi.mocked(useSessionContext).mockReturnValue({
      sessionDetails: mockSessionDetails,
      workspaceMode: 'container',
      workspaceInfo: mockWorkspaceInfo,
      isLoading: false,
      error: null,
      refreshSession: vi.fn(),
    });

    render(<SessionSection onConfigureSession={onConfigureSession} />);

    const badge = screen.getByTestId('workspace-badge');
    fireEvent.click(badge);

    expect(onConfigureSession).toHaveBeenCalledWith('workspace');
  });
});
```

Add integration test to verify the full flow:

```typescript
// In an integration test file or e2e test
describe('Workspace badge to modal navigation', () => {
  it('opens config modal to workspace tab when badge is clicked', async () => {
    // Setup: render the full page with sidebar and modal
    render(<SessionPage />);

    // Find and click the workspace badge
    const workspaceBadge = screen.getByTestId('workspace-badge');
    fireEvent.click(workspaceBadge);

    // Modal should open
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Workspace tab should be active
    const workspaceTab = screen.getByTestId('workspace-tab');
    expect(workspaceTab).toHaveClass('tab-active');

    // Workspace content should be visible
    expect(screen.getByTestId('workspace-details-panel')).toBeInTheDocument();
  });
});
```

**Manual Testing**:
1. Open a session in the web UI
2. Locate the workspace badge in the sidebar
3. Click the badge
4. Verify that:
   - SessionConfigModal opens
   - Workspace tab is automatically selected
   - Workspace details are displayed
5. Close modal and click configure session button
6. Verify modal opens to default (general) tab
7. Switch between tabs manually to ensure navigation works

**Commit Message**:
```
feat(web): connect workspace badge to config modal tab

Wire up workspace badge click to open SessionConfigModal directly
to the Workspace tab for immediate access to details.

- Update onConfigureSession to accept optional initialTab parameter
- Pass 'workspace' when badge is clicked
- Update prop types and parent component handling
- Add test coverage for navigation flow
```

---

### Task 7: Add Font Awesome Icons

**Goal**: Ensure the new icons (faBox, faFolder) are available in the icon library.

**Files to Modify**:
- `packages/web/lib/fontawesome.ts` (or wherever icons are registered)

**Implementation Steps**:

1. Check current icon registration file (likely `packages/web/lib/fontawesome.ts` or similar):

```typescript
// Add these imports if not already present
import {
  faBox,           // For container mode
  faFolder,        // For local mode
  faCircle,        // For state indicators
  // ... other icons
} from '@fortawesome/free-solid-svg-icons';
```

2. Export them if using a custom export pattern:
```typescript
export {
  faBox,
  faFolder,
  faCircle,
  // ... other icons
};
```

3. If using library registration pattern, ensure they're added:
```typescript
import { library } from '@fortawesome/fontawesome-svg-core';

library.add(
  faBox,
  faFolder,
  faCircle,
  // ... other icons
);
```

**Testing**:

No unit tests needed for icon registration, but verify:

1. Component imports work:
```typescript
import { faBox, faFolder } from '@/lib/fontawesome';
```

2. Icons render without console errors

**Manual Testing**:
1. Run the dev server
2. Open browser console
3. Navigate to a session page
4. Verify no FontAwesome errors about missing icons
5. Verify workspace badge displays the correct icon

**Commit Message**:
```
feat(web): add workspace-related FontAwesome icons

Register faBox, faFolder, and faCircle icons for workspace UI
components.

- faBox: container mode indicator
- faFolder: local mode indicator
- faCircle: state indicator dots
```

---

### Task 8: End-to-End Testing

**Goal**: Verify the complete feature works from session creation through workspace info display.

**Files to Create**:
- `packages/web/e2e/workspace-visibility.e2e.ts`

**Implementation Steps**:

Create comprehensive E2E test:

```typescript
import { test, expect } from '@playwright/test';
import {
  setupTestProject,
  setupTestSession,
  cleanupTestData
} from './helpers/test-setup';

test.describe('Workspace Visibility', () => {
  test.beforeEach(async ({ page }) => {
    // Setup test environment
    await page.goto('/');
  });

  test.afterEach(async () => {
    await cleanupTestData();
  });

  test('displays local workspace badge and details', async ({ page }) => {
    // Create test project and session
    const projectId = await setupTestProject(page, {
      name: 'E2E Test Project',
      workingDirectory: '/tmp/test-project',
    });

    const sessionId = await setupTestSession(page, {
      projectId,
      name: 'Local Test Session',
      workspaceMode: 'local',
    });

    // Navigate to session
    await page.goto(`/project/${projectId}/session/${sessionId}`);

    // Wait for workspace badge to appear
    const badge = page.getByTestId('workspace-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Local');

    // Click badge to open modal
    await badge.click();

    // Modal should open to workspace tab
    await expect(page.getByRole('dialog')).toBeVisible();
    const workspaceTab = page.getByTestId('workspace-tab');
    await expect(workspaceTab).toHaveClass(/tab-active/);

    // Verify workspace details are displayed
    const detailsPanel = page.getByTestId('workspace-details-panel');
    await expect(detailsPanel).toBeVisible();
    await expect(detailsPanel).toContainText('Local Workspace');
    await expect(detailsPanel).toContainText(sessionId);
    await expect(detailsPanel).toContainText('running');
  });

  test('displays container workspace badge and details', async ({ page }) => {
    // Skip on non-macOS (containers only on macOS)
    test.skip(process.platform !== 'darwin', 'Containers only supported on macOS');

    // Create test project and session with container mode
    const projectId = await setupTestProject(page, {
      name: 'Container Test Project',
      workingDirectory: '/tmp/container-test',
    });

    const sessionId = await setupTestSession(page, {
      projectId,
      name: 'Container Test Session',
      workspaceMode: 'container',
    });

    // Navigate to session
    await page.goto(`/project/${projectId}/session/${sessionId}`);

    // Wait for workspace badge
    const badge = page.getByTestId('workspace-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('Container');

    // Badge should have primary styling
    await expect(badge).toHaveClass(/badge-primary/);

    // Click to open details
    await badge.click();

    // Verify modal opens to workspace tab
    await expect(page.getByRole('dialog')).toBeVisible();
    const detailsPanel = page.getByTestId('workspace-details-panel');
    await expect(detailsPanel).toBeVisible();

    // Verify container-specific details
    await expect(detailsPanel).toContainText('Container Workspace');
    await expect(detailsPanel).toContainText('Container ID');
    await expect(detailsPanel).toContainText('workspace-' + sessionId);
    await expect(detailsPanel).toContainText('Branch');
    await expect(detailsPanel).toContainText('Worktree Path');
    await expect(detailsPanel).toContainText('Container Mount Path');
    await expect(detailsPanel).toContainText('/workspace');
  });

  test('workspace tab can be accessed directly from modal', async ({ page }) => {
    // Setup
    const projectId = await setupTestProject(page, {
      name: 'Modal Nav Test',
    });
    const sessionId = await setupTestSession(page, { projectId });

    await page.goto(`/project/${projectId}/session/${sessionId}`);

    // Open config modal via settings button (not badge)
    await page.getByTestId('configure-session-button').click();

    // Modal should open to default tab
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click workspace tab
    const workspaceTab = page.getByTestId('workspace-tab');
    await workspaceTab.click();

    // Workspace details should appear
    await expect(page.getByTestId('workspace-details-panel')).toBeVisible();
  });

  test('handles workspace not initialized gracefully', async ({ page }) => {
    // Create session but don't wait for workspace init
    const projectId = await setupTestProject(page, {
      name: 'Uninitialized Test',
    });
    const sessionId = await setupTestSession(page, {
      projectId,
      skipWorkspaceWait: true, // Don't wait for workspace
    });

    await page.goto(`/project/${projectId}/session/${sessionId}`);

    // Badge might not appear yet, or shows loading state
    // Try to open modal
    await page.getByTestId('configure-session-button').click();
    await page.getByTestId('workspace-tab').click();

    // Should show "not initialized" message or loading state
    const panel = page.getByTestId('workspace-tab-content');
    await expect(panel).toContainText(/not yet initialized|loading/i);
  });

  test('workspace data updates when switching sessions', async ({ page }) => {
    // Create two sessions with different modes
    const projectId = await setupTestProject(page, {
      name: 'Session Switch Test',
    });

    const localSessionId = await setupTestSession(page, {
      projectId,
      name: 'Local Session',
      workspaceMode: 'local',
    });

    const containerSessionId = await setupTestSession(page, {
      projectId,
      name: 'Container Session',
      workspaceMode: 'container',
    });

    // Navigate to local session
    await page.goto(`/project/${projectId}/session/${localSessionId}`);

    let badge = page.getByTestId('workspace-badge');
    await expect(badge).toContainText('Local');

    // Switch to container session
    await page.goto(`/project/${projectId}/session/${containerSessionId}`);

    badge = page.getByTestId('workspace-badge');
    await expect(badge).toContainText('Container');

    // Open modal and verify details updated
    await badge.click();
    const panel = page.getByTestId('workspace-details-panel');
    await expect(panel).toContainText('Container Workspace');
    await expect(panel).toContainText(containerSessionId);
  });
});
```

**Manual E2E Testing Checklist**:

Create a testing checklist document: `docs/plans/2025-10-01/workspace-visibility-testing-checklist.md`

```markdown
# Workspace Visibility Manual Testing Checklist

## Setup
- [ ] Dev server running (`npm run dev`)
- [ ] Browser dev tools open (check console for errors)
- [ ] Test project created

## Local Mode Session
- [ ] Create new session with default (local) workspace mode
- [ ] Workspace badge appears in sidebar
- [ ] Badge shows "Local" text with ghost styling
- [ ] Badge has folder icon
- [ ] Badge shows "running" state indicator

## Badge Click Behavior
- [ ] Click workspace badge
- [ ] SessionConfigModal opens
- [ ] Workspace tab is automatically selected
- [ ] Workspace details panel displays
- [ ] "Local Workspace" header visible
- [ ] Session ID displayed correctly
- [ ] Working directory path shown
- [ ] "Direct Project Access" alert visible

## Modal Navigation
- [ ] Close modal
- [ ] Click configure session button (gear icon)
- [ ] Modal opens to default tab (general)
- [ ] Click workspace tab manually
- [ ] Workspace details appear
- [ ] Switch back to general tab
- [ ] Switch to workspace tab again (verify tab switching works)

## Container Mode Session (macOS only)
- [ ] Create new session with container workspace mode
- [ ] Badge shows "Container" with primary styling
- [ ] Badge has box icon
- [ ] Click badge to open modal
- [ ] "Container Workspace" header visible
- [ ] Container ID displayed (starts with "workspace-")
- [ ] Container mount path shows "/workspace"
- [ ] Branch name displayed
- [ ] Worktree path shown
- [ ] Original project directory shown
- [ ] All container-specific sections visible

## Session Switching
- [ ] Create both local and container sessions in same project
- [ ] Switch from local to container session
- [ ] Verify badge updates (Local → Container)
- [ ] Open workspace details
- [ ] Verify details match current session
- [ ] Switch back to local session
- [ ] Verify badge updates (Container → Local)
- [ ] Verify details update

## Error Handling
- [ ] Check browser console for errors during all operations
- [ ] Verify no missing icon warnings
- [ ] Test with slow network (dev tools network throttling)
- [ ] Verify loading states appear appropriately

## Accessibility
- [ ] Tab through sidebar with keyboard
- [ ] Workspace badge is keyboard focusable
- [ ] Enter key activates badge
- [ ] Modal can be closed with Escape
- [ ] Screen reader announces badge purpose (check title attribute)

## Visual Regression
- [ ] Workspace section doesn't break sidebar layout
- [ ] Badge sizing appropriate
- [ ] Modal workspace tab fits with existing tabs
- [ ] Details panel spacing and alignment correct
- [ ] Text is readable in both light and dark themes
- [ ] Icons render at correct sizes

## Notes
- Document any issues found
- Screenshot any visual problems
- Note browser/OS for any platform-specific issues
```

**Commit Message**:
```
test(e2e): add comprehensive workspace visibility tests

Add end-to-end tests covering complete workspace visibility flow
from session creation to detail display.

- Local mode workspace display
- Container mode workspace display (macOS)
- Badge navigation to modal
- Tab switching within modal
- Session switching updates
- Graceful handling of uninitialized workspaces
- Include manual testing checklist
```

---

## Testing Strategy Summary

### Unit Tests
- API endpoint with all edge cases (Task 1)
- SessionProvider workspace data integration (Task 2)
- SessionSection badge rendering (Task 3)
- WorkspaceDetailsPanel display logic (Task 4)
- SessionConfigModal tab integration (Task 5)

### Integration Tests
- Badge click → modal navigation (Task 6)
- Provider → components data flow (Task 2-3)
- Modal tab switching (Task 5)

### E2E Tests
- Complete user flow (Task 8)
- Cross-session consistency (Task 8)
- Platform-specific behavior (Task 8)

### Manual Testing
- Visual verification checklist (Task 8)
- Accessibility checks (Task 8)
- Error handling (all tasks)

## Development Workflow

### For Each Task:

1. **Read task description completely**
2. **Write tests first (TDD)**
   - Start with failing tests
   - Run tests: `npm test` (watch mode)
3. **Implement minimal code to pass tests**
4. **Run all tests**: `npm run test`
5. **Run linter**: `npm run lint`
6. **Manual testing** as described in task
7. **Commit with provided message**
8. **Move to next task**

### Before Final PR:

1. Run full test suite: `npm run test`
2. Run E2E tests: `npm run test:e2e`
3. Run linter: `npm run lint:fix`
4. Manual testing checklist
5. Check no console errors
6. Review all commits
7. Verify feature works on both macOS (container) and other platforms (local only)

## Common Issues and Solutions

### Issue: Workspace info is undefined
**Solution**: Workspace initialization is async. Use `session.waitForWorkspace()` or handle undefined gracefully in UI.

### Issue: Tests fail on non-macOS platforms
**Solution**: Container mode only works on macOS. Use `test.skip(process.platform !== 'darwin')` for container tests.

### Issue: Type errors with WorkspaceInfo
**Solution**: Import from correct location: `@lace/core/workspace/workspace-container-manager`

### Issue: SessionProvider context not updating
**Solution**: Verify `fetchWorkspaceData` is called in useEffect and after session changes.

### Issue: Modal doesn't open to correct tab
**Solution**: Check `initialTab` prop is passed correctly and SessionConfigModal supports 'workspace' tab value.

## Architecture Decisions

### Why SessionProvider for workspace data?
- Avoids duplicate API calls
- Single source of truth
- Automatic updates on session changes
- Consistent with existing session data flow

### Why unified display instead of two components?
- Reduces code duplication
- Easier to maintain
- Better user experience (consistent layout)
- Conditional rendering is simple

### Why read-only panel?
- YAGNI: No user requirements for actions
- Safer (no accidental workspace destruction)
- Can add actions later if needed
- Keeps implementation simple

### Why badge instead of just text?
- Visual prominence
- Clickable affordance
- Consistent with DaisyUI patterns
- Easy to scan

## Dependencies

### New Dependencies
None required (all using existing packages)

### Existing Dependencies Used
- React Router v7 (routing)
- DaisyUI (styling)
- FontAwesome (icons)
- Vitest (testing)
- Playwright (E2E)
- SuperJSON (API serialization - already in place)

## Performance Considerations

### API Calls
- Workspace data fetched once per session load
- Cached in SessionProvider
- No polling (workspace state is stable)

### Rendering
- WorkspaceDetailsPanel only renders when tab is active
- Conditional rendering minimizes DOM nodes
- No expensive computations

### Data Size
- WorkspaceInfo is small (~200 bytes)
- No pagination needed
- No large data transfers

## Documentation Updates

After implementation, update:

1. **README.md** (if needed): Mention workspace visibility feature
2. **CHANGELOG.md**: Add feature to unreleased section
3. **User docs** (if exists): How to view workspace information
4. **Developer docs**: WorkspaceInfo interface, API endpoints

## Success Criteria

Feature is complete when:

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E tests pass on both macOS and Linux
- [ ] Manual testing checklist complete
- [ ] No console errors or warnings
- [ ] Linter passes
- [ ] Container and local modes both work
- [ ] Badge appears in sidebar
- [ ] Modal opens to correct tab
- [ ] All workspace details display correctly
- [ ] Works across session switches
- [ ] Handles missing data gracefully
- [ ] Code review approved

## Estimated Time

- Task 1: 2 hours (API + tests)
- Task 2: 2 hours (Provider + tests)
- Task 3: 1.5 hours (Badge + tests)
- Task 4: 3 hours (Panel + comprehensive tests)
- Task 5: 1 hour (Modal integration)
- Task 6: 1 hour (Navigation wiring)
- Task 7: 0.5 hours (Icons)
- Task 8: 2 hours (E2E tests)

**Total: ~13 hours**

## Questions to Ask During Implementation

1. Does SessionConfigModal already support `initialTab` prop? (Task 5)
2. Where exactly are tabs defined in SessionConfigPanel? (Task 5)
3. What's the icon registration pattern in fontawesome.ts? (Task 7)
4. Are there existing E2E test helpers for creating projects/sessions? (Task 8)
5. What's the current pattern for prop threading between sidebar and modal? (Task 6)
