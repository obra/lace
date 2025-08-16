// ABOUTME: Pure data operations hook for project management
// ABOUTME: Handles project fetching, caching, and CRUD operations - no selection state

import { useState, useEffect, useCallback } from 'react';
import type { ProjectInfo } from '@/types/core';
import { parseResponse } from '@/lib/serialization';

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
          body: JSON.stringify(updates),
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

  // Load projects on mount
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return {
    projects,
    loading,
    error,
    updateProject,
    reloadProjects: loadProjects,
  };
}
