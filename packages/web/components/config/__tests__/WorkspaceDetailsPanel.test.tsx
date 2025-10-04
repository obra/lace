// ABOUTME: Tests for WorkspaceDetailsPanel component
// ABOUTME: Validates workspace data display for both container and local modes

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkspaceDetailsPanel } from '@lace/web/components/config/WorkspaceDetailsPanel';
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
      render(<WorkspaceDetailsPanel mode="local" info={null} isLoading={true} />);

      expect(screen.getByText(/loading workspace information/i)).toBeInTheDocument();
      expect(document.querySelector('.loading-spinner')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('displays message when info is null', () => {
      render(<WorkspaceDetailsPanel mode="local" info={null} />);

      expect(screen.getByText(/workspace not yet initialized/i)).toBeInTheDocument();
    });

    it('displays message when info is undefined', () => {
      render(<WorkspaceDetailsPanel mode="container" info={undefined} />);

      expect(screen.getByText(/workspace not yet initialized/i)).toBeInTheDocument();
    });
  });

  describe('container mode', () => {
    it('displays container workspace header', () => {
      render(<WorkspaceDetailsPanel mode="container" info={baseContainerInfo} />);

      expect(screen.getByText('Container Workspace')).toBeInTheDocument();
    });

    it('displays primary information', () => {
      render(<WorkspaceDetailsPanel mode="container" info={baseContainerInfo} />);

      expect(screen.getByText('Working Directory')).toBeInTheDocument();
      expect(screen.getAllByText(baseContainerInfo.clonePath).length).toBeGreaterThan(0);
      expect(screen.getByText('Session ID')).toBeInTheDocument();
      // sessionId appears in multiple places (Session ID field and Container ID value)
      expect(
        screen.getAllByText(baseContainerInfo.sessionId, { exact: false }).length
      ).toBeGreaterThan(0);
    });

    it('displays container-specific details', () => {
      render(<WorkspaceDetailsPanel mode="container" info={baseContainerInfo} />);

      expect(screen.getByText('Container Details')).toBeInTheDocument();
      expect(screen.getByText('Container ID')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.containerId)).toBeInTheDocument();
      expect(screen.getByText('Container Mount Path')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.containerMountPath!)).toBeInTheDocument();
    });

    it('displays git configuration', () => {
      render(<WorkspaceDetailsPanel mode="container" info={baseContainerInfo} />);

      expect(screen.getByText('Git Configuration')).toBeInTheDocument();
      expect(screen.getByText('Branch')).toBeInTheDocument();
      // branchName appears in multiple places (Branch field and may be in other fields)
      expect(
        screen.getAllByText(baseContainerInfo.branchName!, { exact: false }).length
      ).toBeGreaterThan(0);
      expect(screen.getByText('Worktree Path')).toBeInTheDocument();
      expect(screen.getAllByText(baseContainerInfo.clonePath).length).toBeGreaterThan(0);
      expect(screen.getByText('Original Project')).toBeInTheDocument();
      expect(screen.getByText(baseContainerInfo.projectDir)).toBeInTheDocument();
    });

    it('displays running state with success color', () => {
      render(<WorkspaceDetailsPanel mode="container" info={baseContainerInfo} />);

      const stateText = screen.getByText('running');
      expect(stateText).toBeInTheDocument();
      const stateIcon = stateText.parentElement?.querySelector('.text-success');
      expect(stateIcon).toBeInTheDocument();
    });

    it('displays stopped state with warning color', () => {
      const stoppedInfo = { ...baseContainerInfo, state: 'stopped' };

      render(<WorkspaceDetailsPanel mode="container" info={stoppedInfo} />);

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

      render(<WorkspaceDetailsPanel mode="container" info={minimalInfo} />);

      // Should not crash, primary info should be present
      expect(screen.getByText(minimalInfo.sessionId)).toBeInTheDocument();
      // Optional fields should not cause errors
      expect(screen.queryByText('Container Mount Path')).not.toBeInTheDocument();
      expect(screen.queryByText('Branch')).not.toBeInTheDocument();
    });
  });

  describe('local mode', () => {
    it('displays local workspace header', () => {
      render(<WorkspaceDetailsPanel mode="local" info={baseLocalInfo} />);

      expect(screen.getByText('Local Workspace')).toBeInTheDocument();
    });

    it('displays primary information', () => {
      render(<WorkspaceDetailsPanel mode="local" info={baseLocalInfo} />);

      expect(screen.getByText('Working Directory')).toBeInTheDocument();
      expect(screen.getAllByText(baseLocalInfo.clonePath).length).toBeGreaterThan(0);
    });

    it('displays local details section', () => {
      render(<WorkspaceDetailsPanel mode="local" info={baseLocalInfo} />);

      expect(screen.getByText('Local Details')).toBeInTheDocument();
      expect(screen.getByText('Project Directory')).toBeInTheDocument();
      // projectDir appears in multiple places (Working Directory and Project Directory are same for local mode)
      expect(screen.getAllByText(baseLocalInfo.projectDir).length).toBeGreaterThan(0);
    });

    it('displays direct access information alert', () => {
      render(<WorkspaceDetailsPanel mode="local" info={baseLocalInfo} />);

      expect(screen.getByText('Direct Project Access')).toBeInTheDocument();
      expect(screen.getByText(/runs directly in your project directory/i)).toBeInTheDocument();
    });

    it('does not display container-specific sections', () => {
      render(<WorkspaceDetailsPanel mode="local" info={baseLocalInfo} />);

      expect(screen.queryByText('Container Details')).not.toBeInTheDocument();
      expect(screen.queryByText('Git Configuration')).not.toBeInTheDocument();
    });
  });

  describe('data-testid', () => {
    it('has testid on main container when info is present', () => {
      render(<WorkspaceDetailsPanel mode="local" info={baseLocalInfo} />);

      expect(screen.getByTestId('workspace-details-panel')).toBeInTheDocument();
    });
  });
});
