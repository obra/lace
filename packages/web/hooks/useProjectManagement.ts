// ABOUTME: Pure data operations hook for project management
// ABOUTME: Handles project fetching, caching, and CRUD operations - no selection state

import { useState, useEffect, useCallback } from 'react';
import type { ProjectInfo } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { stringify } from '@/lib/serialization';

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
      const res = await fetch('/api/projects');
      const data = await parseResponse<ProjectInfo[]>(res);
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
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(updates),
        });

        if (res.ok) {
          // Reload projects to reflect the changes
          await loadProjects();
        } else {
          const errorMessage = `Failed to update project: ${res.status}`;
          setError(errorMessage);
          console.error(errorMessage);
        }
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
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(projectData),
        });

        if (res.ok) {
          const newProject = await parseResponse<ProjectInfo>(res);
          // Reload projects to include the new project
          await loadProjects();
          return newProject;
        } else {
          const errorData = await parseResponse<{ error: string }>(res);
          const errorMessage = `Failed to create project: ${errorData.error}`;
          setError(errorMessage);
          console.error(errorMessage);
          throw new Error(errorMessage);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create project';
        setError(errorMessage);
        console.error('Failed to create project:', error);
        throw error;
      }
    },
    [loadProjects]
  );

  const loadProjectConfiguration = useCallback(
    async (projectId: string): Promise<Record<string, unknown>> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/configuration`);

        if (res.ok) {
          const data = await parseResponse<{ configuration: Record<string, unknown> }>(res);
          return data.configuration || {};
        } else {
          const errorMessage = `Failed to load project configuration: ${res.status}`;
          setError(errorMessage);
          console.error(errorMessage);
          return {};
        }
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

  // Load projects on mount
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return {
    projects,
    loading,
    error,
    updateProject,
    createProject,
    loadProjectConfiguration,
    reloadProjects: loadProjects,
  };
}
