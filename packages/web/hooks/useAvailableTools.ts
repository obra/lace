// ABOUTME: Hook for fetching user-configurable tools from the backend
// ABOUTME: Replaces hardcoded AVAILABLE_TOOLS with API-driven tool discovery

import { useState, useEffect } from 'react';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import type { ConfigurationResponse } from '@/types/api';

export function useAvailableTools() {
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { projects, loadProjectConfiguration } = useProjectContext();

  useEffect(() => {
    const loadTools = async () => {
      try {
        // Get available tools from any existing project's configuration
        if (projects.length > 0) {
          const config = await loadProjectConfiguration(projects[0].id);
          const configResponse = config as ConfigurationResponse['configuration'];
          setAvailableTools(configResponse.availableTools ?? []);
        } else {
          // Fallback: empty array for new installations (will be populated when first project is created)
          setAvailableTools([]);
        }
      } catch (error) {
        console.error('Failed to load available tools:', error);
        setAvailableTools([]);
      } finally {
        setLoading(false);
      }
    };

    void loadTools();
  }, [projects, loadProjectConfiguration]);

  return { availableTools, loading };
}
