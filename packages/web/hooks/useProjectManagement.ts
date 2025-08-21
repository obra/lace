// ABOUTME: Pure data operations hook for project management
// ABOUTME: Handles project fetching, caching, and CRUD operations - no selection state

import { useState, useEffect, useCallback } from 'react';
import type { ProjectInfo } from '@/types/core';
import { api } from '@/lib/api-client';

interface UseProjectManagementResult {
  projects: ProjectInfo[];
  loading: boolean;
  error: string | null;
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

export function useProjectManagement(): UseProjectManagementResult {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async (): Promise<ProjectInfo[]> => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ProjectInfo[]>('/api/projects');
      setProjects(data);
      setLoading(false);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load projects';
      console.error('Failed to load projects:', error);
      setError(errorMessage);
      setProjects([]);
      setLoading(false);
      return [];
    }
  }, []);

  const updateProject = useCallback(
    async (
      projectId: string,
      updates: {
        isArchived?: boolean;
        name?: string;
        description?: string;
        workingDirectory?: string;
        configuration?: Record<string, unknown>;
      }
    ) => {
      try {
        await api.patch(`/api/projects/${projectId}`, updates);
        // Reload projects to reflect the changes
        await loadProjects();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update project';
        setError(errorMessage);
        console.error('Failed to update project:', error);
      }
    },
    [loadProjects]
  );

  const createProject = useCallback(
    async (projectData: {
      name: string;
      description?: string;
      workingDirectory: string;
      configuration?: Record<string, unknown>;
    }): Promise<ProjectInfo> => {
      try {
        const newProject = await api.post<ProjectInfo>('/api/projects', projectData);
        // Don't automatically reload projects - let caller handle refresh timing
        // This prevents component unmount/remount during project creation workflow
        return newProject;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create project';
        setError(errorMessage);
        console.error('Failed to create project:', error);
        throw error;
      }
    },
    [] // Remove loadProjects dependency
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      try {
        await api.delete(`/api/projects/${projectId}`);
        // Reload projects to remove the deleted project
        await loadProjects();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete project';
        setError(errorMessage);
        console.error('Failed to delete project:', error);
        throw error;
      }
    },
    [loadProjects]
  );

  const loadProjectConfiguration = useCallback(
    async (projectId: string): Promise<Record<string, unknown>> => {
      try {
        const data = await api.get<{ configuration: Record<string, unknown> }>(
          `/api/projects/${projectId}/configuration`
        );
        return data.configuration || {};
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to load project configuration';
        setError(errorMessage);
        console.error('Failed to load project configuration:', error);
        return {};
      }
    },
    []
  );

  // Load projects on mount only - dependency on loadProjects would cause infinite re-render loop
  // since loadProjects is recreated on every render despite useCallback
  useEffect(() => {
    void loadProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    projects,
    loading,
    error,
    updateProject,
    createProject,
    deleteProject,
    loadProjectConfiguration,
    reloadProjects: loadProjects,
  };
}
