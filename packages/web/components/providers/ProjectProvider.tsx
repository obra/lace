// ABOUTME: Context provider for project-related state management and operations
// ABOUTME: Centralizes project selection, CRUD operations, and data transformations

'use client';

import React, { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useProjectManagement } from '@/hooks/useProjectManagement';
import { useHashRouter } from '@/hooks/useHashRouter';
import type { ProjectInfo } from '@/types/core';

// Types for project context
interface ProjectContextType {
  // Project data
  projects: ProjectInfo[];
  loading: boolean;
  selectedProject: string | null;
  currentProject: ProjectInfo;
  projectsForSidebar: ProjectInfo[];

  // Project selection
  selectProject: (projectId: string | null) => void;
  onProjectSelect: (project: { id: string }) => void;

  // Project CRUD operations
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

  // Project validation and utilities
  foundProject: ProjectInfo | null;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

interface ProjectProviderProps {
  children: ReactNode;
  onProjectChange?: (projectId: string | null) => void;
}

export function ProjectProvider({ children, onProjectChange }: ProjectProviderProps) {
  // Use existing project management hook
  const { projects, loading, updateProject, reloadProjects } = useProjectManagement();

  // Use hash router for project selection state
  const { project: selectedProject, setProject: setSelectedProject } = useHashRouter();

  // Find the currently selected project
  const foundProject = selectedProject
    ? (projects || []).find((p) => p.id === selectedProject) || null
    : null;

  // Create a fallback current project for UI consistency
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

  // Project selection handler
  const selectProject = useCallback(
    (projectId: string | null) => {
      setSelectedProject(projectId);
      if (onProjectChange) {
        onProjectChange(projectId);
      }
    },
    [setSelectedProject, onProjectChange]
  );

  // Handle project selection from components (matches current LaceApp interface)
  const onProjectSelect = useCallback(
    (project: { id: string }) => {
      // Handle empty string as null (for clearing selection)
      const projectId = project.id === '' ? null : project.id;
      selectProject(projectId);
    },
    [selectProject]
  );

  const value: ProjectContextType = {
    // Project data
    projects,
    loading,
    selectedProject,
    currentProject,
    projectsForSidebar,

    // Project selection
    selectProject,
    onProjectSelect,

    // Project CRUD operations
    updateProject,
    reloadProjects,

    // Project validation and utilities
    foundProject,
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
