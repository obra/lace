// ABOUTME: Hook to get initial Agent status and thread information
// ABOUTME: Fetches current Agent state when web interface loads

import { useState, useEffect } from 'react';
import type { AgentStatusResponse } from '~/interfaces/web/app/api/agent/status/route';
import { logger } from '~/interfaces/web/utils/client-logger';

export interface UseAgentStatusResult {
  loading: boolean;
  error: string | null;
  status: AgentStatusResponse | null;
}

export function useAgentStatus(): UseAgentStatusResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatusResponse | null>(null);

  useEffect(() => {
    async function fetchAgentStatus() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/agent/status');

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const agentStatus = (await response.json()) as AgentStatusResponse;
        setStatus(agentStatus);

        logger.debug('Agent status loaded:', agentStatus);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load agent status';
        setError(errorMessage);
        logger.error('Error loading agent status:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchAgentStatus();
  }, []);

  return { loading, error, status };
}
