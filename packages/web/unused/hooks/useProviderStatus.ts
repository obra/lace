// ABOUTME: Custom hook for managing provider connection status
// ABOUTME: Handles testing, status updates, and real-time status monitoring

'use client';

import { useState, useCallback } from 'react';
import { parseResponse } from '@/lib/serialization';

interface ProviderStatus {
  status: 'connected' | 'error' | 'untested' | 'testing';
  lastTested?: string;
  error?: string;
}

export function useProviderStatus(instanceId: string) {
  const [status, setStatus] = useState<ProviderStatus>({ status: 'untested' });

  const testConnection = useCallback(async () => {
    setStatus((prev) => ({ ...prev, status: 'testing' }));

    try {
      const response = await fetch(`/api/provider/instances/${instanceId}/test`, {
        method: 'POST',
      });

      const responseData = await parseResponse<{
        success: boolean;
        status: 'connected' | 'error';
        message?: string;
        testedAt: string;
      }>(response);

      if (response.ok && responseData.success) {
        setStatus({
          status: responseData.status,
          lastTested: responseData.testedAt,
        });
      } else {
        setStatus({
          status: 'error',
          lastTested: responseData.testedAt,
          error: responseData.message || 'Connection failed',
        });
      }
    } catch (error) {
      setStatus({
        status: 'error',
        lastTested: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Connection failed',
      });
    }
  }, [instanceId]);

  return { status, testConnection };
}
