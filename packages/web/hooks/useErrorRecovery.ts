// ABOUTME: Hook for handling error recovery actions like retry and resolution
// ABOUTME: Manages retry state and communicates with backend for error recovery

import { useState, useCallback } from 'react';
import { api } from '@/lib/api-client';
import type { ErrorType } from '@/types/core';

interface RetryState {
  retrying: boolean;
  lastRetryAt?: Date;
  retryCount: number;
}

export function useErrorRecovery() {
  const [retryStates, setRetryStates] = useState<Record<string, RetryState>>({});

  const retryAgentOperation = useCallback(async (
    threadId: string,
    errorType: ErrorType
  ): Promise<boolean> => {
    // Use atomic state update to prevent race conditions
    let shouldProceed = false;
    let currentRetryCount = 0;
    setRetryStates(prev => {
      const currentState = prev[threadId] || { retrying: false, retryCount: 0 };
      
      if (currentState.retrying) {
        return prev; // Already retrying, no state change
      }

      shouldProceed = true;
      currentRetryCount = currentState.retryCount;
      return {
        ...prev,
        [threadId]: {
          ...currentState,
          retrying: true,
          lastRetryAt: new Date(),
        },
      };
    });

    if (!shouldProceed) {
      return false; // Already retrying
    }

    try {
      // Send retry message to agent
      const result = await api.post(`/api/agents/${threadId}/message`, {
        content: 'Please retry the last operation that failed',
        context: { errorType, isRetry: true },
      });
      
      setRetryStates(prev => ({
        ...prev,
        [threadId]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentRetryCount + 1,
        },
      }));

      return Boolean(result);
    } catch (_error) {
      setRetryStates(prev => ({
        ...prev,
        [threadId]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentRetryCount + 1,
        },
      }));
      return false;
    }
  }, [retryStates]);

  const retryToolOperation = useCallback(async (
    threadId: string,
    toolCallId: string,
    toolName: string
  ): Promise<boolean> => {
    const key = `${threadId}-${toolCallId}`;
    
    // Use atomic state update to prevent race conditions
    let shouldProceed = false;
    let currentRetryCount = 0;
    setRetryStates(prev => {
      const currentState = prev[key] || { retrying: false, retryCount: 0 };
      
      if (currentState.retrying) {
        return prev; // Already retrying, no state change
      }

      shouldProceed = true;
      currentRetryCount = currentState.retryCount;
      return {
        ...prev,
        [key]: {
          ...currentState,
          retrying: true,
          lastRetryAt: new Date(),
        },
      };
    });

    if (!shouldProceed) {
      return false; // Already retrying
    }

    try {
      // Send retry message for tool operation
      const result = await api.post(`/api/agents/${threadId}/message`, {
        content: `Please retry the ${toolName} tool operation`,
        context: { toolCallId, isRetry: true },
      });
      
      setRetryStates(prev => ({
        ...prev,
        [key]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentRetryCount + 1,
        },
      }));

      return Boolean(result);
    } catch (_error) {
      setRetryStates(prev => ({
        ...prev,
        [key]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentRetryCount + 1,
        },
      }));
      return false;
    }
  }, [retryStates]);

  const markErrorResolved = useCallback((errorId: string) => {
    // Remove retry state for resolved errors
    setRetryStates(prev => {
      const newStates = { ...prev };
      delete newStates[errorId];
      return newStates;
    });
  }, []);

  const getRetryState = useCallback((errorId: string): RetryState => {
    return retryStates[errorId] || { retrying: false, retryCount: 0 };
  }, [retryStates]);

  const canRetry = useCallback((errorId: string, errorType: ErrorType): boolean => {
    const state = getRetryState(errorId);
    
    // Don't allow retry if already retrying
    if (state.retrying) {
      return false;
    }

    // Limit retry attempts based on error type
    const maxRetries = {
      provider_failure: 3,
      timeout: 3,
      streaming_error: 2,
      processing_error: 1,
      tool_execution: 2,
    };

    return state.retryCount < maxRetries[errorType];
  }, [getRetryState]);

  return {
    retryAgentOperation,
    retryToolOperation,
    markErrorResolved,
    getRetryState,
    canRetry,
    retryStates,
  };
}