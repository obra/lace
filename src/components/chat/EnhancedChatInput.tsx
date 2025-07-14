'use client';

import { useState, useRef, useEffect, FormEvent, KeyboardEvent, DragEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faPaperPlane, faPaperclip, faStop } from '~/lib/fontawesome';
import { FileAttachment, AttachedFile } from '~/components/ui/FileAttachment';

interface EnhancedChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isListening?: boolean;
  onStartVoice?: () => void;
  onStopVoice?: () => void;
  onInterrupt?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  attachedFiles?: AttachedFile[];
  onFilesAttached?: (files: AttachedFile[]) => void;
  onFileRemoved?: (fileId: string) => void;
  onFileCleared?: () => void;
}

export function EnhancedChatInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isListening = false,
  onStartVoice,
  onStopVoice,
  onInterrupt,
  isStreaming = false,
  placeholder = 'Message the agent...',
  attachedFiles = [],
  onFilesAttached,
  onFileRemoved,
  onFileCleared,
}: EnhancedChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

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

  // Auto-focus when component becomes enabled after being disabled
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [disabled]);

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
    } else if (e.key === 'Escape' && isStreaming && onInterrupt) {
      e.preventDefault();
      onInterrupt();
    }
  };

  const handleVoiceClick = () => {
    if (isListening && onStopVoice) {
      onStopVoice();
    } else if (onStartVoice) {
      onStartVoice();
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onFilesAttached && e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear drag state if we're leaving the input container
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!disabled && onFilesAttached && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const attachedFiles = files.map((file, index) => ({
        id: `${Date.now()}-${index}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
      }));
      onFilesAttached(attachedFiles);
    }
  };

  const handleFileAttachClick = () => {
    if (disabled) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept =
      'image/*,text/*,.pdf,.doc,.docx,.md,.json,.csv,.xlsx,.ts,.tsx,.js,.jsx,.py,.html,.css,.scss,.sass';
    input.onchange = (e) => {
      const target = e.target;
      if (!target || !(target instanceof HTMLInputElement)) return;
      const files = target.files;
      if (files && files.length > 0 && onFilesAttached) {
        const attachedFiles: AttachedFile[] = Array.from(files).map((file, index) => ({
          id: `${Date.now()}-${index}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
        }));
        onFilesAttached(attachedFiles);
      }
    };
    input.click();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-base-100 border-t border-base-300 p-4 lg:relative lg:bottom-auto">
      {/* Mobile Status Bar */}
      {disabled && (
        <div className="flex items-center justify-center text-xs text-base-content/60 mb-3 lg:hidden">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
            Tool running...
          </span>
        </div>
      )}

      {/* File Attachment Area - Above Input */}
      {onFilesAttached && attachedFiles.length > 0 && (
        <div className="mb-3">
          <FileAttachment
            attachedFiles={attachedFiles}
            onFilesAttached={onFilesAttached}
            onFileRemoved={onFileRemoved || (() => {})}
            onFileCleared={onFileCleared || (() => {})}
            disabled={disabled}
          />
        </div>
      )}

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
          <div
            className="flex-1 relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
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
                className={`w-full bg-base-200 border border-base-300 rounded-2xl px-4 py-3 pr-20 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-base-content placeholder-base-content/60 text-base transition-all duration-200 ${
                  isDragOver ? 'border-primary bg-primary/5' : ''
                }`}
                placeholder={
                  isDragOver
                    ? 'Drop files here...'
                    : isListening
                      ? 'Listening...'
                      : isStreaming
                        ? 'Press ESC to interrupt...'
                        : placeholder
                }
                rows={1}
                style={{ minHeight: '44px', maxHeight: '120px' }}
                disabled={disabled}
              />

              {/* Drag overlay indicator */}
              {isDragOver && (
                <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-2xl flex items-center justify-center pointer-events-none">
                  <span className="text-primary font-medium">Drop files here</span>
                </div>
              )}
            </div>

            {/* Right Side Buttons */}
            <div className="absolute right-2 bottom-2 flex gap-1">
              {/* File Attachment Button */}
              {onFilesAttached && (
                <button
                  type="button"
                  onClick={handleFileAttachClick}
                  disabled={disabled}
                  className="p-2 text-base-content/60 hover:text-teal-600 hover:bg-base-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Attach files"
                >
                  <FontAwesomeIcon icon={faPaperclip} className="w-4 h-4" />
                </button>
              )}

              {/* Send/Stop Button */}
              {isStreaming && onInterrupt ? (
                <button
                  type="button"
                  onClick={onInterrupt}
                  className="p-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
                  title="Stop response (ESC)"
                >
                  <FontAwesomeIcon icon={faStop} className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!value.trim() || disabled}
                  className="p-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <FontAwesomeIcon icon={faPaperPlane} className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
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
