// ABOUTME: Context provider for shared project selection state across the app
// ABOUTME: Manages which project is selected and provides computed values based on selection

'use client';

import React, { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useProjectManagement } from '@/hooks/useProjectManagement';
import { useHashRouter } from '@/hooks/useHashRouter';
import type { ProjectInfo } from '@/types/core';

// Types for project context
interface ProjectContextType {
  // Project data (from useProjectManagement hook)
  projects: ProjectInfo[];
  loading: boolean;
  error: string | null;

  // Selection state (managed by this provider)
  selectedProject: string | null;
  foundProject: ProjectInfo | null;

  // Computed values based on data + selection
  currentProject: ProjectInfo;
  projectsForSidebar: ProjectInfo[];

  // Selection actions
  selectProject: (projectId: string | null) => void;
  onProjectSelect: (project: { id: string }) => void;

  // Data operations (passed through from hook)
  updateProject: (
    projectId: string,
    updates: {
      isArchived?: boolean;
      name?: string;
      description?: string;
      workingDirectory?: string;
      configuration?: Record<string, unknown>;
    }
  ) => Promise<void>;
  reloadProjects: () => Promise<ProjectInfo[]>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

interface ProjectProviderProps {
  children: ReactNode;
  onProjectChange?: (projectId: string | null) => void;
}

export function ProjectProvider({ children, onProjectChange }: ProjectProviderProps) {
  // Get project data from pure data hook
  const { projects, loading, error, updateProject, reloadProjects } = useProjectManagement();

  // Get selection state from hash router
  const { project: selectedProject, setProject: setSelectedProject } = useHashRouter();

  // Compute derived state based on data + selection
  const foundProject = useMemo(() => {
    return selectedProject ? (projects || []).find((p) => p.id === selectedProject) || null : null;
  }, [selectedProject, projects]);

  // Create fallback current project for UI needs
  const currentProject = useMemo(
    () =>
      foundProject || {
        id: '',
        name: 'No project selected',
        description: 'Select a project to get started',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      },
    [foundProject]
  );

  // Transform projects for sidebar display
  const projectsForSidebar = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        workingDirectory: p.workingDirectory,
        description: p.description,
        isArchived: p.isArchived || false,
        createdAt: new Date(p.createdAt),
        lastUsedAt: new Date(p.lastUsedAt),
        sessionCount: p.sessionCount || 0,
      })),
    [projects]
  );

  // Selection actions
  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
      if (onProjectChange) {
        onProjectChange(projectId);
      }
    },
    [setSelectedProject, onProjectChange]
  );

  const onProjectSelect = useCallback(
    (project: { id: string }) => {
      // Handle empty string as null (for clearing selection)
      const projectId = project.id === '' ? null : project.id;
      selectProject(projectId);
    },
    [selectProject]
  );

  const value: ProjectContextType = {
    // Project data (from hook)
    projects,
    loading,
    error,

    // Selection state (managed here)
    selectedProject,
    foundProject,

    // Computed values
    currentProject,
    projectsForSidebar,

    // Selection actions
    selectProject,
    onProjectSelect,

    // Data operations (passed through)
    updateProject,
    reloadProjects,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

// Hook to use project context
export function useProjectContext(): ProjectContextType {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectProvider');
  }
  return context;
}
