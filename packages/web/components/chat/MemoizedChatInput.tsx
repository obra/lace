// ABOUTME: Memoized chat input with animation and status handling
// ABOUTME: Includes CustomChatInput with speech status and token usage display

'use client';

import React, { useState, useCallback, memo, useRef } from 'react';
import { motion } from 'motion/react';
import { ChatInput } from '@/components/chat/ChatInput';
import { CompactTokenUsage } from '@/components/ui/CompactTokenUsage';
import type { ThreadId } from '@/types/core';

export const MemoizedChatInput = memo(function MemoizedChatInput({
  onSubmit,
  onInterrupt,
  disabled,
  sendDisabled,
  isStreaming,
  placeholder,
  agentId,
}: {
  onSubmit: (message: string) => Promise<boolean | void>;
  onInterrupt?: () => Promise<boolean | void>;
  disabled: boolean;
  sendDisabled?: boolean;
  isStreaming?: boolean;
  placeholder: string;
  agentId?: ThreadId;
}) {
  const [message, setMessage] = useState('');
  const chatInputRef = useRef<{ focus: () => void } | null>(null);

  const handleSubmit = useCallback(async () => {
    const success = await onSubmit(message);
    if (success) {
      setMessage('');
      // Refocus the input after successful send
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 50); // Small delay to ensure DOM updates are complete
    }
  }, [message, onSubmit]);

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
    const chatInputRef = useRef<{ focus: () => void } | null>(null);

    // Expose focus method via ref
    React.useImperativeHandle(ref, () => ({
      focus: () => chatInputRef.current?.focus(),
    }));

    return (
      <div className="space-y-2">
        {/* Chat Input */}
        <ChatInput
          ref={chatInputRef}
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onInterrupt={onInterrupt}
          disabled={disabled}
          sendDisabled={sendDisabled}
          isStreaming={isStreaming}
          placeholder={placeholder}
        />

        {/* Bottom Status Area */}
        <div className="flex justify-between items-center text-xs text-base-content/40 min-h-[16px]">
          {/* Left side - Status messages */}
          <div className="flex-1" aria-live="polite" aria-atomic="true">
            {speechError ? (
              <div className="flex items-center gap-2 text-error">
                <div className="w-2 h-2 bg-error rounded-full"></div>
                <span>Speech error</span>
              </div>
            ) : isListening ? (
              <div className="flex items-center gap-2 text-success">
                <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                <span>Listening...</span>
              </div>
            ) : isStreaming ? (
              <div className="flex items-center gap-2 text-warning">
                <div className="w-2 h-2 bg-warning rounded-full animate-pulse"></div>
                <span>Agent is responding...</span>
              </div>
            ) : disabled ? (
              <div className="flex items-center gap-2 text-success">
                <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
                <span>Tool running...</span>
              </div>
            ) : null}
          </div>

          {/* Right side - Token usage */}
          <div>{agentId && <CompactTokenUsage agentId={agentId} />}</div>
        </div>
      </div>
    );
  })
);
