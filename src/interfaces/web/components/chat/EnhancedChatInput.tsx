// ABOUTME: Enhanced chat input component with voice recognition and auto-resizing textarea
// ABOUTME: Mobile-optimized design with contextual controls and status indicators

'use client';

import React, { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faPaperPlane, faPaperclip } from '~/lib/fontawesome';

interface EnhancedChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isListening?: boolean;
  onStartVoice?: () => void;
  onStopVoice?: () => void;
  placeholder?: string;
}

export function EnhancedChatInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isListening = false,
  onStartVoice,
  onStopVoice,
  placeholder = 'Message the agent...',
}: EnhancedChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [value]);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      if (!value.trim() || disabled) return;
      onSubmit();
    }
  };

  const handleVoiceClick = () => {
    if (isListening && onStopVoice) {
      onStopVoice();
    } else if (onStartVoice) {
      onStartVoice();
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-base-100 border-t border-base-300 p-4 lg:relative lg:bottom-auto">
      {/* Mobile Status Bar */}
      <div className="flex items-center justify-between text-xs text-base-content/60 mb-3 lg:hidden">
        <span>Connected</span>
        {disabled && (
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
            Tool running...
          </span>
        )}
        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <form onSubmit={handleSubmit} className="relative">
        <div className="flex gap-3 items-end">
          {/* Voice Input (Mobile Only) */}
          {isMobile && onStartVoice && (
            <button
              type="button"
              onClick={handleVoiceClick}
              className={`p-3 rounded-full transition-colors lg:hidden ${
                isListening
                  ? 'text-teal-600 bg-teal-100 animate-pulse'
                  : 'text-base-content/60 hover:text-teal-600 hover:bg-base-200'
              }`}
            >
              <FontAwesomeIcon icon={faMicrophone} className="w-5 h-5" />
            </button>
          )}

          {/* Message Input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-base-200 border border-base-300 rounded-2xl px-4 py-3 pr-12 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-base-content placeholder-base-content/60 text-base"
              placeholder={isListening ? 'Listening...' : placeholder}
              rows={1}
              style={{ minHeight: '44px', maxHeight: '120px' }}
              disabled={disabled}
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={!value.trim() || disabled}
              className="absolute right-2 bottom-2 p-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <FontAwesomeIcon icon={faPaperPlane} className="w-5 h-5" />
            </button>
          </div>

          {/* Attachment Button (Mobile) */}
          {isMobile && (
            <button
              type="button"
              className="p-3 text-base-content/60 hover:text-teal-600 hover:bg-base-200 rounded-full transition-colors lg:hidden"
            >
              <FontAwesomeIcon icon={faPaperclip} className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Voice Status Indicator (Mobile) */}
        {isListening && isMobile && (
          <div className="flex items-center justify-center gap-2 mt-2 text-teal-600 text-sm lg:hidden">
            <div className="flex gap-1">
              <div
                className="w-1 bg-teal-600 rounded-full animate-pulse"
                style={{ height: '12px' }}
              ></div>
              <div
                className="w-1 bg-teal-600 rounded-full animate-pulse"
                style={{ height: '16px', animationDelay: '0.1s' }}
              ></div>
              <div
                className="w-1 bg-teal-600 rounded-full animate-pulse"
                style={{ height: '20px', animationDelay: '0.2s' }}
              ></div>
              <div
                className="w-1 bg-teal-600 rounded-full animate-pulse"
                style={{ height: '16px', animationDelay: '0.3s' }}
              ></div>
              <div
                className="w-1 bg-teal-600 rounded-full animate-pulse"
                style={{ height: '12px', animationDelay: '0.4s' }}
              ></div>
            </div>
            <span>Tap to stop</span>
          </div>
        )}
      </form>

      {/* Safe area padding for mobile */}
      <div className="h-safe-bottom lg:hidden"></div>
    </div>
  );
}