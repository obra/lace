// ABOUTME: Enhanced chat input component with integrated speech recognition and file upload capabilities.

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChatTextarea, SendButton, FileAttachButton } from '@/components/ui';
import { NativeSpeechInput, useSpeechRecognition } from '@/components/ui/NativeSpeechInput';
import type { ChatTextareaRef } from './ChatTextarea';
import { FileAttachment, AttachedFile } from '@/components/ui/FileAttachment';

interface EnhancedChatInputWithSpeechProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  onInterrupt?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  attachedFiles?: AttachedFile[];
  onFilesAttached?: (files: AttachedFile[]) => void;
  onFileRemoved?: (fileId: string) => void;
  onFileCleared?: () => void;
  showVoiceButton?: boolean;
  showFileAttachment?: boolean;
  speechLanguage?: string;
  autoSubmitOnSpeech?: boolean;
}

export default function EnhancedChatInputWithSpeech({
  value,
  onChange,
  onSubmit,
  disabled = false,
  onInterrupt,
  isStreaming = false,
  placeholder = 'Message the agent...',
  attachedFiles = [],
  onFilesAttached,
  onFileRemoved,
  onFileCleared,
  showVoiceButton = true,
  showFileAttachment = true,
  speechLanguage = 'en-US',
  autoSubmitOnSpeech = false,
}: EnhancedChatInputWithSpeechProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<ChatTextareaRef>(null);

  // Speech recognition hook
  const {
    transcript: speechTranscript,
    isListening,
    error: speechError,
    status: speechStatus,
    handleTranscript,
    handleError,
    handleStatusChange,
    clearTranscript,
    clearError,
  } = useSpeechRecognition();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Handle speech transcript updates
  useEffect(() => {
    if (speechTranscript.trim()) {
      const newValue = value ? `${value} ${speechTranscript}`.trim() : speechTranscript;
      onChange(newValue);

      // Auto-submit if enabled and we have content
      if (autoSubmitOnSpeech && newValue.trim()) {
        // Small delay to ensure the UI updates
        setTimeout(() => {
          onSubmit();
        }, 100);
      }

      // Clear the speech transcript after using it
      clearTranscript();
    }
  }, [speechTranscript, value, onChange, onSubmit, autoSubmitOnSpeech, clearTranscript]);

  // Clear speech errors after a delay
  useEffect(() => {
    if (speechError) {
      const timer = setTimeout(() => {
        clearError();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [speechError, clearError]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      if (isStreaming && onInterrupt) {
        e.preventDefault();
        onInterrupt();
      } else if (isListening) {
        e.preventDefault();
        // Stop speech recognition on Escape
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && onFilesAttached && e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
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

  const handleFilesSelected = (files: FileList) => {
    if (!onFilesAttached) return;

    const attachedFiles: AttachedFile[] = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
    }));
    onFilesAttached(attachedFiles);
  };

  const getDynamicPlaceholder = () => {
    if (isDragOver) return 'Drop files here...';
    if (isListening) return 'Listening for speech...';
    if (isStreaming) return 'Press ESC to interrupt...';
    if (speechError) return 'Speech error - try again';
    return placeholder;
  };

  const getStatusIndicator = () => {
    if (speechError) {
      return (
        <div className="flex items-center gap-2 text-red-600 text-xs">
          <div className="w-2 h-2 bg-red-500 rounded-full"></div>
          <span>Speech error</span>
        </div>
      );
    }

    if (isListening) {
      return (
        <div className="flex items-center gap-2 text-teal-600 text-xs">
          <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
          <span>Listening...</span>
        </div>
      );
    }

    if (speechStatus === 'processing') {
      return (
        <div className="flex items-center gap-2 text-blue-600 text-xs">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          <span>Processing...</span>
        </div>
      );
    }

    if (disabled) {
      return (
        <div className="flex items-center gap-2 text-base-content/60 text-xs">
          <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
          <span>Tool running...</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="relative">
      {/* Mobile Status Bar */}
      <div className="flex items-center justify-center mb-3 lg:hidden min-h-[20px]">
        {getStatusIndicator()}
      </div>

      {/* Speech Error Display */}
      {speechError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">Voice Input:</span>
            <span>{speechError}</span>
          </div>
        </div>
      )}

      {/* File Attachment Area */}
      {showFileAttachment && onFilesAttached && attachedFiles.length > 0 && (
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isListening) {
            onSubmit();
          }
        }}
        className="relative"
      >
        <div className="flex gap-4 items-end">
          {/* Voice Input (Mobile Only) */}
          {isMobile && showVoiceButton && (
            <div className="lg:hidden">
              <NativeSpeechInput
                onTranscript={handleTranscript}
                onError={handleError}
                onStatusChange={handleStatusChange}
                size="md"
                variant="ghost"
                language={speechLanguage}
                continuous={true}
                interimResults={true}
              />
            </div>
          )}

          {/* Message Input Area */}
          <div className="flex-1 relative">
            <ChatTextarea
              ref={textareaRef}
              value={value}
              onChange={onChange}
              onSubmit={() => {
                if (!isListening) {
                  onSubmit();
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={getDynamicPlaceholder()}
              disabled={disabled || isListening}
              isMobile={isMobile}
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`${
                showVoiceButton && !isMobile && showFileAttachment
                  ? 'pr-36'
                  : showVoiceButton && !isMobile
                    ? 'pr-28'
                    : showFileAttachment
                      ? 'pr-20'
                      : 'pr-12'
              } ${isListening ? 'border-teal-300 bg-teal-50/30' : ''}`}
              autoFocus={!disabled && !isListening}
              data-testid="enhanced-message-input"
            />

            {/* Desktop Status Indicator */}
            {!isMobile && (
              <div className="absolute left-3 top-3 flex items-center">
                {speechStatus === 'listening' && (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {[8, 12, 16, 12, 8].map((height, index) => (
                        <div
                          key={index}
                          className="w-0.5 bg-teal-500 rounded-full animate-pulse"
                          style={{
                            height: `${height}px`,
                            animationDelay: `${index * 0.1}s`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Right Side Controls */}
            <div className="absolute right-3 bottom-3 flex gap-2">
              {/* Voice Button (Desktop) */}
              {!isMobile && showVoiceButton && (
                <NativeSpeechInput
                  onTranscript={handleTranscript}
                  onError={handleError}
                  onStatusChange={handleStatusChange}
                  size="md"
                  variant="ghost"
                  language={speechLanguage}
                  continuous={true}
                  interimResults={true}
                />
              )}

              {/* File Attachment Button */}
              {showFileAttachment && onFilesAttached && (
                <FileAttachButton
                  onFilesSelected={handleFilesSelected}
                  disabled={disabled || isListening}
                  size="md"
                  variant="ghost"
                />
              )}

              {/* Send/Stop Button */}
              <SendButton
                onSubmit={() => {
                  if (!isListening) {
                    onSubmit();
                  }
                }}
                onStop={onInterrupt}
                disabled={disabled || isListening}
                isStreaming={isStreaming}
                hasContent={Boolean(value.trim())}
                size="md"
              />
            </div>
          </div>
        </div>
      </form>

      {/* Desktop Speech Status */}
      {!isMobile && speechStatus === 'listening' && (
        <div className="flex items-center justify-center gap-2 mt-2 text-teal-600 text-sm">
          <span>🎤 Listening - speak now</span>
        </div>
      )}
    </div>
  );
}
