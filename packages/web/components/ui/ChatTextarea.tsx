import React from 'react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  KeyboardEvent,
  DragEvent,
} from 'react';

interface ChatTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  isMobile?: boolean;
  isDragOver?: boolean;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  className?: string;
  autoFocus?: boolean;
  'data-testid'?: string;
}

export interface ChatTextareaRef {
  focus: () => void;
  adjustHeight: () => void;
}

const ChatTextarea = forwardRef<ChatTextareaRef, ChatTextareaProps>(
  (
    {
      value,
      onChange,
      onSubmit,
      onKeyDown,
      placeholder = 'Type a message...',
      disabled = false,
      isMobile = false,
      isDragOver = false,
      onDragOver,
      onDragLeave,
      onDrop,
      className = '',
      autoFocus = false,
      'data-testid': testId,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustTextareaHeight = () => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      }
    };

    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus();
      },
      adjustHeight: adjustTextareaHeight,
    }));

    useEffect(() => {
      adjustTextareaHeight();
    }, [value]);

    useEffect(() => {
      if (autoFocus && !disabled && textareaRef.current) {
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }
    }, [disabled, autoFocus]);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.shiftKey && onSubmit) {
        e.preventDefault();
        if (!value.trim() || disabled) return;
        onSubmit();
      }
      onKeyDown?.(e);
    };

    return (
      <div
        className={`relative ${className}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          className={`relative ${
            isDragOver ? 'ring-2 ring-primary ring-opacity-50 rounded-2xl' : ''
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`w-full bg-base-200 border border-base-300 rounded-2xl px-4 py-3 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-base-content placeholder-base-content/60 text-base transition-all duration-200 ${
              isDragOver ? 'border-primary bg-primary/5' : ''
            }`}
            placeholder={placeholder}
            rows={1}
            style={{ minHeight: '44px', maxHeight: '120px' }}
            disabled={disabled}
            data-testid={testId}
          />

          {isDragOver && (
            <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-2xl flex items-center justify-center pointer-events-none">
              <span className="text-primary font-medium">Drop files here</span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatTextarea.displayName = 'ChatTextarea';

export default ChatTextarea;
