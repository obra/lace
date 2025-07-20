// ABOUTME: React hook for project management API calls
// ABOUTME: Provides methods for CRUD operations on projects

import { useState, useCallback } from 'react';
import {
  ProjectInfo,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectsResponse,
  ProjectResponse,
  DeleteProjectResponse,
  isApiError,
  isApiSuccess,
} from '@/types/api';

interface APIState {
  loading: boolean;
  error: string | null;
}

export function useProjectAPI() {
  const [state, setState] = useState<APIState>({
    loading: false,
    error: null,
  });

  const setLoading = (loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  };

  const setError = (error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  };

  const listProjects = useCallback(async (): Promise<ProjectInfo[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/projects');

      if (!response.ok) {
        const error: unknown = await response.json();
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to list projects');
        }
        throw new Error('Failed to list projects');
      }

      const data: unknown = await response.json();
      if (isApiSuccess<ProjectsResponse>(data) && 'projects' in data) {
        return data['projects'] as ProjectInfo[];
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getProject = useCallback(async (projectId: string): Promise<ProjectInfo | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`);

      if (!response.ok) {
        const error: unknown = await response.json();
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to get project');
        }
        throw new Error('Failed to get project');
      }

      const data: unknown = await response.json();
      if (isApiSuccess<ProjectResponse>(data) && 'project' in data) {
        return data['project'] as ProjectInfo;
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(
    async (request: CreateProjectRequest): Promise<ProjectInfo | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error: unknown = await response.json();
          if (isApiError(error)) {
            throw new Error(error.error || 'Failed to create project');
          }
          throw new Error('Failed to create project');
        }

        const data: unknown = await response.json();
        if (isApiSuccess<ProjectResponse>(data) && 'project' in data) {
          return data['project'] as ProjectInfo;
        }
        throw new Error('Invalid response format');
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const updateProject = useCallback(
    async (projectId: string, request: UpdateProjectRequest): Promise<ProjectInfo | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error: unknown = await response.json();
          if (isApiError(error)) {
            throw new Error(error.error || 'Failed to update project');
          }
          throw new Error('Failed to update project');
        }

        const data: unknown = await response.json();
        if (isApiSuccess<ProjectResponse>(data) && 'project' in data) {
          return data['project'] as ProjectInfo;
        }
        throw new Error('Invalid response format');
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error: unknown = await response.json();
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to delete project');
        }
        throw new Error('Failed to delete project');
      }

      const data: unknown = await response.json();
      if (isApiSuccess<DeleteProjectResponse>(data) && 'success' in data) {
        return data['success'] as boolean;
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading: state.loading,
    error: state.error,
    listProjects,
    getProject,
    createProject,
    updateProject,
    deleteProject,
  };
}
