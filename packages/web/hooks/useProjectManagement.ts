// ABOUTME: Custom hook for project management operations
// ABOUTME: Handles project loading, selection, and CRUD operations

import { useState, useEffect, useCallback } from 'react';
import type { ProjectInfo } from '@/types/core';
import { parseResponse } from '@/lib/serialization';

interface UseProjectManagementResult {
  projects: ProjectInfo[];
  loading: boolean;
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

  const loadProjects = useCallback(async (): Promise<ProjectInfo[]> => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects');
      const data = await parseResponse<ProjectInfo[]>(res);
      setProjects(data);
      setLoading(false);
      return data;
    } catch (error) {
      console.error('Failed to load projects:', error);
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
          console.error('Failed to update project');
        }
      } catch (error) {
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
    updateProject,
    reloadProjects: loadProjects,
  };
}
