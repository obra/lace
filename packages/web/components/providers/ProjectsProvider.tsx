// ABOUTME: Context provider for all projects and project selection state
// ABOUTME: Manages project collection and which project is selected

'use client';

import React, { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useProjectManagement } from '@lace/web/hooks/useProjectManagement';
import type { ProjectInfo } from '@lace/web/types/core';

// Types for projects context
export interface ProjectsContextType {
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
  createProject: (projectData: {
    name: string;
    description?: string;
    workingDirectory: string;
    configuration?: Record<string, unknown>;
  }) => Promise<ProjectInfo>;
  deleteProject: (projectId: string) => Promise<void>;
  loadProjectConfiguration: (projectId: string) => Promise<Record<string, unknown>>;
  reloadProjects: () => Promise<ProjectInfo[]>;
}

const ProjectsContext = createContext<ProjectsContextType | null>(null);

interface ProjectsProviderProps {
  children: ReactNode;
  onProjectChange?: (projectId: string | null) => void;
  selectedProject: string | null;
  onProjectSelect: (projectId: string | null) => void;
}

export function ProjectsProvider({
  children,
  onProjectChange,
  selectedProject,
  onProjectSelect,
}: ProjectsProviderProps) {
  // Get project data from pure data hook
  const {
    projects,
    loading,
    error,
    updateProject,
    createProject,
    deleteProject,
    loadProjectConfiguration,
    reloadProjects,
  } = useProjectManagement();

  // Compute derived state based on data + selection
  const foundProject = useMemo(() => {
    return selectedProject ? (projects || []).find((p) => p.id === selectedProject) || null : null;
  }, [selectedProject, projects]);

  // Create fallback current project for UI needs
  const currentProject = useMemo(() => {
    // If we have a selectedProject but projects are still loading, show loading state
    if (selectedProject && loading) {
      return {
        id: selectedProject,
        name: 'Loading project...',
        description: 'Please wait while we load your project data',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      };
    }

    return (
      foundProject || {
        id: '',
        name: 'No project selected',
        description: 'Select a project to get started',
        workingDirectory: '/',
        isArchived: false,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        sessionCount: 0,
      }
    );
  }, [foundProject, selectedProject, loading]);

  // Transform projects for sidebar display
  const projectsForSidebar = useMemo(
    () =>
      (projects || []).map((p) => ({
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
      onProjectSelect(projectId);
      if (onProjectChange) {
        onProjectChange(projectId);
      }
    },
    [onProjectSelect, onProjectChange]
  );

  const handleProjectSelect = useCallback(
    (project: { id: string }) => {
      // Handle empty string as null (for clearing selection)
      const projectId = project.id === '' ? null : project.id;
      selectProject(projectId);
    },
    [selectProject]
  );

  const value: ProjectsContextType = useMemo(
    () => ({
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
      onProjectSelect: handleProjectSelect,

      // Data operations (passed through)
      updateProject,
      createProject,
      deleteProject,
      loadProjectConfiguration,
      reloadProjects,
    }),
    [
      projects,
      loading,
      error,
      selectedProject,
      foundProject,
      currentProject,
      projectsForSidebar,
      selectProject,
      handleProjectSelect,
      updateProject,
      createProject,
      deleteProject,
      loadProjectConfiguration,
      reloadProjects,
    ]
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

// Optional hook - returns null if not within provider
export function useOptionalProjectsContext(): ProjectsContextType | null {
  return useContext(ProjectsContext);
}

// Hook to use projects context
export function useProjectsContext(): ProjectsContextType {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error('useProjectsContext must be used within a ProjectsProvider');
  }
  return context;
}
