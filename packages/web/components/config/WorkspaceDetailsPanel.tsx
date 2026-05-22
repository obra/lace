// ABOUTME: Displays comprehensive workspace information for a session
// ABOUTME: Shows unified view with conditional fields based on workspace mode

'use client';

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBox, faFolder, faCircle } from '@lace/web/lib/fontawesome';
import type { WorkspaceInfo, WorkspaceMode } from '@lace/web/types/core';

interface WorkspaceDetailsPanelProps {
  mode: WorkspaceMode;
  info: WorkspaceInfo | null | undefined;
  isLoading?: boolean;
}

export function WorkspaceDetailsPanel({
  mode,
  info,
  isLoading = false,
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
  const isBoundedHost = mode === 'boundedHost';

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

  // Visual config based on mode
  const getModeConfig = () => {
    if (isContainer) {
      return {
        title: 'Container Workspace',
        icon: faBox,
        bgClass: 'bg-primary/10',
        iconClass: 'text-primary',
      };
    }
    return {
      title: 'Bounded Host Workspace',
      icon: faFolder,
      bgClass: 'bg-warning/10',
      iconClass: 'text-warning',
    };
  };

  const modeConfig = getModeConfig();

  return (
    <div className="space-y-6 p-6" data-testid="workspace-details-panel">
      {/* Header Section */}
      <div className="flex items-center gap-3 pb-4 border-b border-base-300">
        <div className={`p-3 rounded-lg ${modeConfig.bgClass}`}>
          <FontAwesomeIcon icon={modeConfig.icon} className={`w-6 h-6 ${modeConfig.iconClass}`} />
        </div>
        <div>
          <h3 className="text-lg font-semibold">{modeConfig.title}</h3>
          <div className="flex items-center gap-2 mt-1">
            <FontAwesomeIcon icon={faCircle} className={`w-2 h-2 ${getStateColor(info.state)}`} />
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
              Host Source
            </h4>

            {info.branchName && <DetailRow label="Branch" value={info.branchName} mono />}
            <DetailRow label="Host Directory" value={info.clonePath} mono />
            <DetailRow label="Project Directory" value={info.projectDir} mono />
          </div>
        </>
      )}

      {/* Bounded Host Information */}
      {isBoundedHost && (
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
            Host Containment
          </h4>

          <DetailRow label="Host Root" value={info.projectDir} mono />
          <div className="alert alert-warning">
            <div className="flex flex-col gap-1">
              <div className="font-medium">Bounded Host Containment</div>
              <div className="text-sm opacity-80">
                Tools are constrained to this host root. File access and commands resolve inside
                this directory unless an explicit policy allows otherwise.
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
      <dd className={`text-sm text-base-content break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
