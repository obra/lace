// ABOUTME: Memoized chat input with animation and status handling
// ABOUTME: Includes CustomChatInput with speech status and token usage display

'use client';

import React, { useState, useCallback, memo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChatInput } from '@/components/chat/ChatInput';
import { CompactTokenUsage } from '@/components/ui/CompactTokenUsage';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { Alert } from '@/components/ui/Alert';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import type { ThreadId } from '@/types/core';

// Stop requested feedback timing constants
const STOP_FEEDBACK_DURATION = {
  SUCCESS: 3000, // Show "Stop requested" for 3 seconds on successful abort
  FAILURE: 100, // Quick reset on abort failure
} as const;

export const MemoizedChatInput = memo(function MemoizedChatInput({
  onSubmit,
  onInterrupt,
  disabled,
  sendDisabled,
  isStreaming,
  placeholder,
  agentId,
  initialValue,
}: {
  onSubmit: (message: string) => Promise<boolean | void>;
  onInterrupt?: () => Promise<boolean | void>;
  disabled: boolean;
  sendDisabled?: boolean;
  isStreaming?: boolean;
  placeholder: string;
  agentId?: ThreadId;
  initialValue?: string;
}) {
  const [message, setMessage] = useState('');
  const chatInputRef = useRef<{ focus: () => void } | null>(null);
  const refocusTimeoutRef = useRef<number | null>(null);

  // Set initial value if provided
  useEffect(() => {
    if (initialValue) {
      setMessage(initialValue);
    }
  }, [initialValue]);

  const handleSubmit = useCallback(async () => {
    const success = await onSubmit(message);
    if (success) {
      setMessage('');
      // Refocus the input after successful send
      if (refocusTimeoutRef.current) {
        clearTimeout(refocusTimeoutRef.current);
      }
      refocusTimeoutRef.current = window.setTimeout(() => {
        chatInputRef.current?.focus();
      }, 50); // Small delay to ensure DOM updates are complete
    }
  }, [message, onSubmit]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refocusTimeoutRef.current) {
        clearTimeout(refocusTimeoutRef.current);
        refocusTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex-shrink-0 bg-base-100/50 backdrop-blur-sm border-t border-base-300/30 p-2"
    >
      <CustomChatInput
        ref={chatInputRef}
        value={message}
        onChange={setMessage}
        onSubmit={handleSubmit}
        onInterrupt={onInterrupt}
        disabled={disabled}
        sendDisabled={sendDisabled}
        isStreaming={isStreaming}
        placeholder={placeholder}
        agentId={agentId}
      />
    </motion.div>
  );
});

// Custom chat input with status below - includes speech status monitoring
const CustomChatInput = memo(
  React.forwardRef<
    { focus: () => void },
    {
      value: string;
      onChange: (value: string) => void;
      onSubmit: () => void | Promise<void>;
      onInterrupt?: () => void | Promise<boolean | void>;
      disabled: boolean;
      sendDisabled?: boolean;
      isStreaming?: boolean;
      placeholder: string;
      agentId?: ThreadId;
    }
  >(function CustomChatInput(
    {
      value,
      onChange,
      onSubmit,
      onInterrupt,
      disabled,
      sendDisabled,
      isStreaming,
      placeholder,
      agentId,
    },
    ref
  ) {
    const [isListening, setIsListening] = useState(false);
    const [speechError, setSpeechError] = useState<string | null>(null);
    const [modelError, setModelError] = useState<string | null>(null);
    const [stopRequested, setStopRequested] = useState(false);
    const chatInputRef = useRef<{ focus: () => void } | null>(null);
    const stopRequestedTimeoutRef = useRef<number | null>(null);

    // Expose focus method via ref
    React.useImperativeHandle(ref, () => ({
      focus: () => chatInputRef.current?.focus(),
    }));

    const { currentAgent, updateAgent } = useAgentContext();
    const { availableProviders } = useProviderInstances();

    // Wrapper for onInterrupt to show "Stop requested" feedback
    const handleInterrupt = useCallback(async () => {
      if (!onInterrupt) return;

      setStopRequested(true);

      // Clear any existing timeout before setting a new one
      if (stopRequestedTimeoutRef.current) {
        clearTimeout(stopRequestedTimeoutRef.current);
        stopRequestedTimeoutRef.current = null;
      }

      let result: boolean | void;
      try {
        result = await onInterrupt();
      } catch (error) {
        console.error('Failed to interrupt agent:', error);
        result = false; // Treat errors as failed abort
      } finally {
        // Reset stop requested after a delay, regardless of success/failure
        const delay =
          result === false ? STOP_FEEDBACK_DURATION.FAILURE : STOP_FEEDBACK_DURATION.SUCCESS;
        stopRequestedTimeoutRef.current = window.setTimeout(() => {
          setStopRequested(false);
          stopRequestedTimeoutRef.current = null;
        }, delay);
      }

      return result;
    }, [onInterrupt]);

    // Reset stopRequested when agent is no longer streaming
    React.useEffect(() => {
      if (!isStreaming && stopRequested) {
        setStopRequested(false);
      }
    }, [isStreaming, stopRequested]);

    // Cleanup timeout on unmount
    React.useEffect(() => {
      return () => {
        if (stopRequestedTimeoutRef.current) {
          clearTimeout(stopRequestedTimeoutRef.current);
          stopRequestedTimeoutRef.current = null;
        }
      };
    }, []);

    const handleModelChange = useCallback(
      async (providerInstanceId: string, modelId: string) => {
        if (currentAgent) {
          try {
            setModelError(null); // Clear any previous error
            await updateAgent(currentAgent.threadId, {
              name: currentAgent.name,
              providerInstanceId,
              modelId,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to update model';
            setModelError(errorMessage);
            console.error('Failed to update agent model:', error);
          }
        }
      },
      [currentAgent, updateAgent]
    );

    return (
      <div className="space-y-2">
        {/* Chat Input */}
        <ChatInput
          ref={chatInputRef}
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onInterrupt={handleInterrupt}
          disabled={disabled}
          sendDisabled={sendDisabled}
          isStreaming={isStreaming}
          placeholder={placeholder}
        />

        {/* Bottom Status Area */}
        <div className="flex justify-between items-center text-xs text-base-content/40 min-h-[16px]">
          {/* Left side - Status messages + Model Selector */}
          <div className="flex items-center gap-4 flex-1" aria-live="polite" aria-atomic="true">
            {/* Status messages */}
            <div className="flex items-center gap-2">
              {speechError ? (
                <>
                  <div className="w-2 h-2 bg-error rounded-full"></div>
                  <span>Speech error</span>
                </>
              ) : isListening ? (
                <>
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                  <span>Listening...</span>
                </>
              ) : stopRequested ? (
                <>
                  <div className="w-2 h-2 bg-warning rounded-full animate-pulse"></div>
                  <span>Stop requested</span>
                </>
              ) : isStreaming ? (
                <>
                  <div className="w-2 h-2 bg-warning rounded-full animate-pulse"></div>
                  <span>Agent is responding...</span>
                </>
              ) : disabled ? (
                <>
                  <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                  <span>Tool running...</span>
                </>
              ) : null}
            </div>

            {/* Model Selector */}
            {currentAgent && (
              <div className="flex flex-col gap-1">
                <ModelSelector
                  providers={availableProviders}
                  selectedProviderInstanceId={currentAgent.providerInstanceId}
                  selectedModelId={currentAgent.modelId}
                  onChange={handleModelChange}
                  disabled={isStreaming}
                  className="select select-ghost select-xs"
                  placeholder="Select model..."
                />
                {modelError && (
                  <Alert
                    variant="error"
                    title={modelError}
                    layout="horizontal"
                    className="text-xs py-1 px-2"
                  />
                )}
              </div>
            )}
          </div>

          {/* Right side - Token usage */}
          <div>{agentId && <CompactTokenUsage agentId={agentId} />}</div>
        </div>
      </div>
    );
  })
);
