// ABOUTME: Session sidebar section component with agent selection and status
// ABOUTME: Handles both mobile and desktop layouts with conditional behaviors

'use client';

import React, { memo, useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faComments, faCog } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { SwitchIcon } from '@/components/ui/SwitchIcon';
import {
  PermissionModeSelector,
  PermissionModeBadge,
} from '@/components/ui/PermissionModeSelector';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useProjectsContext } from '@/components/providers/ProjectsProvider';
import { useURLState } from '@/hooks/useURLState';
import { api } from '@/lib/api-client';
import type { PermissionOverrideMode } from '~/tools/types';

interface SessionSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onConfigureSession?: () => void;
}

export const SessionSection = memo(function SessionSection({
  isMobile = false,
  onCloseMobileNav,
  onConfigureSession,
}: SessionSectionProps) {
  // Get context data
  const { sessionDetails, workspaceMode, workspaceLoading } = useSessionContext();
  const { selectedProject } = useProjectsContext();
  const { navigateToProject } = useURLState();

  // Permission mode state
  const [permissionMode, setPermissionMode] = useState<PermissionOverrideMode>('normal');
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);

  // Fetch current permission mode from session configuration
  useEffect(() => {
    if (!sessionDetails?.id) return;

    const fetchConfiguration = async () => {
      try {
        const response = await api.get<{
          configuration: { runtimeOverrides?: { permissionMode?: PermissionOverrideMode } };
        }>(`/api/sessions/${sessionDetails.id}/configuration`);
        if (response.configuration?.runtimeOverrides?.permissionMode) {
          setPermissionMode(response.configuration.runtimeOverrides.permissionMode);
        }
      } catch (error) {
        console.error('Failed to fetch session configuration:', error);
      }
    };

    void fetchConfiguration();
  }, [sessionDetails?.id]);

  // Handle permission mode change
  const handlePermissionModeChange = async (mode: PermissionOverrideMode) => {
    if (!sessionDetails?.id || isUpdatingMode) return;

    setIsUpdatingMode(true);
    try {
      await api.put(`/api/sessions/${sessionDetails.id}/configuration`, {
        runtimeOverrides: {
          permissionMode: mode,
        },
      });
      setPermissionMode(mode);
    } catch (error) {
      console.error('Failed to update permission mode:', error);
    } finally {
      setIsUpdatingMode(false);
    }
  };

  // Don't render if no session is selected
  if (!sessionDetails) {
    return null;
  }

  const handleViewSessions = () => {
    if (selectedProject) {
      navigateToProject(selectedProject);
      if (isMobile) {
        onCloseMobileNav?.();
      }
    }
  };

  const handleConfigureSession = () => {
    onConfigureSession?.();
  };

  // Header actions for session navigation
  const headerActions = selectedProject ? (
    <SwitchIcon
      onClick={handleViewSessions}
      title="Switch to sessions"
      aria-label="Switch to sessions view"
      size="sm"
      data-testid="session-switch-button"
    />
  ) : null;

  // Workspace mode badge - clickable to open config
  const workspaceBadge =
    workspaceMode && !workspaceLoading ? (
      <button
        onClick={handleConfigureSession}
        className="px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all duration-200 hover:scale-105"
        style={{
          backgroundColor: workspaceMode === 'container' ? '#3b82f6' : '#10b981',
          borderColor: workspaceMode === 'container' ? '#2563eb' : '#059669',
          color: 'white',
        }}
        title={`Workspace: ${workspaceMode} (click to configure)`}
        data-testid="workspace-mode-badge"
      >
        {workspaceMode === 'container' ? 'Container' : 'Local'}
      </button>
    ) : null;

  // Header actions for session navigation
  const sessionHeaderActions = (
    <div className="flex items-center gap-2">
      {workspaceBadge}
      {onConfigureSession && (
        <button
          onClick={handleConfigureSession}
          className="p-1 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
          title="Configure session"
          data-testid="configure-session-button"
        >
          <FontAwesomeIcon
            icon={faCog}
            className="w-3 h-3 text-base-content/50 hover:text-base-content/70 transition-colors"
          />
        </button>
      )}
      {headerActions}
    </div>
  );

  return (
    <div className="ml-4">
      {' '}
      {/* Indent to show it's under workspace */}
      <SidebarSection
        title={sessionDetails.name}
        icon={faComments}
        defaultCollapsed={false}
        collapsible={false}
        headerActions={sessionHeaderActions}
      >
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
        </div>
      </SidebarSection>
    </div>
  );
});
