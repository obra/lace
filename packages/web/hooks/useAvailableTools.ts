// ABOUTME: Hook for fetching user-configurable tools from the backend
// ABOUTME: Replaces hardcoded AVAILABLE_TOOLS with API-driven tool discovery

import { useState, useEffect } from 'react';
import { useProjectContext } from '@/components/providers/ProjectProvider';

export function useAvailableTools() {
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { projects, loadProjectConfiguration } = useProjectContext();

  useEffect(() => {
    let isCancelled = false;

    const loadTools = async () => {
      try {
        setError(null);
        // Get available tools from any existing project's configuration
        if (projects.length > 0) {
          const config = await loadProjectConfiguration(projects[0].id);

          if (!isCancelled) {
            // Defensive type validation
            if (config && typeof config === 'object' && 'availableTools' in config) {
              const configObj = config as Record<string, unknown>;
              const availableTools = configObj.availableTools;
              if (
                Array.isArray(availableTools) &&
                availableTools.every((tool): tool is string => typeof tool === 'string')
              ) {
                setAvailableTools(availableTools);
              } else {
                console.warn('Invalid availableTools format:', availableTools);
                setAvailableTools([]);
              }
            } else {
              console.warn('Configuration missing availableTools:', config);
              setAvailableTools([]);
            }
          }
        } else {
          if (!isCancelled) {
            // Fallback: empty array for new installations (will be populated when first project is created)
            setAvailableTools([]);
          }
        }
      } catch (err) {
        if (!isCancelled) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to load available tools';
          console.error('Failed to load available tools:', err);
          setError(errorMessage);
          setAvailableTools([]);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void loadTools();

    return () => {
      isCancelled = true;
    };
  }, [projects, loadProjectConfiguration]);

  return { availableTools, loading, error };
}
