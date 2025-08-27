// ABOUTME: Hook for handling error recovery actions like retry and resolution
// ABOUTME: Manages retry state and communicates with backend for error recovery

import { useState, useCallback, useMemo } from 'react';
import { api } from '@/lib/api-client';
import type { ErrorType } from '@/types/core';

interface RetryState {
  retrying: boolean;
  lastRetryAt?: Date;
  retryCount: number;
}

export function useErrorRecovery() {
  const [retryStates, setRetryStates] = useState<Record<string, RetryState>>({});

  // Memoized typed retry messages
  const retryMessages = useMemo(() => ({
    provider_failure: 'Please retry the last request. The provider connection has been restored.',
    timeout: 'Please retry the last operation. The timeout issue may be resolved.',
    streaming_error: 'Please retry the last request. The streaming connection has been reset.',
    processing_error: 'Please retry the last operation. The processing issue may be resolved.',
    tool_execution: 'Please retry the last tool operation with the same parameters.',
  } as const satisfies Record<ErrorType, string>), []);

  // Helper to mark retry completion and update state
  const markRetryComplete = useCallback((key: string, currentRetryCount: number) => {
    setRetryStates(prev => ({
      ...prev,
      [key]: {
        retrying: false,
        lastRetryAt: new Date(),
        retryCount: currentRetryCount + 1,
      },
    }));
  }, []);

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
      // Send retry message specific to error type  
      const result = await api.post(`/api/agents/${threadId}/message`, {
        message: retryMessages[errorType],
        context: { errorType, isRetry: true },
      });
      
      markRetryComplete(threadId, currentRetryCount);

      return Boolean(result);
    } catch (_error) {
      markRetryComplete(threadId, currentRetryCount);
      return false;
    }
  }, [retryMessages, markRetryComplete]);

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
        message: `Please retry the ${toolName} tool operation`,
        context: { toolCallId, isRetry: true },
      });
      
      markRetryComplete(key, currentRetryCount);

      return Boolean(result);
    } catch (_error) {
      markRetryComplete(key, currentRetryCount);
      return false;
    }
  }, [markRetryComplete]);

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