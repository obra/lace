// ABOUTME: Condensed chat input component for modal usage
// ABOUTME: Simplified version of ChatInput without voice, files, or extra features

'use client';

import React, { useRef, useEffect, useImperativeHandle } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@/lib/fontawesome';

interface CondensedChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  minRows?: number;
  sendButtonText?: string;
  allowEmptySubmit?: boolean;
}

export const CondensedChatInput = React.forwardRef<{ focus: () => void }, CondensedChatInputProps>(
  function CondensedChatInput(
    {
      value,
      onChange,
      onSend,
      placeholder = 'Type a message...',
      disabled = false,
      className = '',
      minRows = 1,
      sendButtonText,
      allowEmptySubmit = false,
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Expose focus method to parent components
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          textareaRef.current?.focus();
        },
      }),
      []
    );

    // Auto-resize textarea when value changes
    useEffect(() => {
      if (textareaRef.current) {
        const textarea = textareaRef.current;
        textarea.style.height = 'auto';
        const minHeight = minRows * 24; // Approximate line height
        const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, 200)); // Allow more height
        textarea.style.height = newHeight + 'px';
      }
    }, [value, minRows]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Don't interfere with IME composition
      if (e.nativeEvent.isComposing) return;

      // Only submit on Enter without modifier keys
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (allowEmptySubmit || value.trim()) {
          onSend();
        }
      }
    };

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    };

    const handleSendClick = () => {
      if (allowEmptySubmit || value.trim()) {
        onSend();
      }
    };

    const isDisabled = disabled || (!allowEmptySubmit && !value.trim());

    return (
      <div className={`relative ${className}`}>
        <div className="flex items-center w-full bg-base-100 border border-base-300 rounded-lg px-3 py-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200">
          {/* Textarea Input */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 bg-transparent outline-none placeholder:text-base-content/60 text-base-content resize-none overflow-y-auto text-sm"
            style={{
              minHeight: `${minRows * 24}px`,
              maxHeight: '200px',
              lineHeight: '1.4',
            }}
            rows={minRows}
            onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              const minHeight = minRows * 24;
              const newHeight = Math.max(minHeight, Math.min(target.scrollHeight, 200));
              target.style.height = newHeight + 'px';
            }}
          />

          {/* Send Button */}
          <div className="ml-3">
            <button
              type="button"
              onClick={handleSendClick}
              disabled={isDisabled}
              data-testid="condensed-send-button"
              className={`${
                sendButtonText
                  ? 'px-4 py-2 rounded-lg bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 font-medium'
                  : 'w-7 h-7 flex items-center justify-center rounded-full bg-primary text-primary-content hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200'
              }`}
              title={sendButtonText || (value.trim() ? 'Send message' : 'Type a message to send')}
            >
              <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" />
              {sendButtonText && <span>{sendButtonText}</span>}
            </button>
          </div>
        </div>
      </div>
    );
  }
);
