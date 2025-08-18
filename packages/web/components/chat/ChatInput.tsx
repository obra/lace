'use client';

import React, { useState, useRef, useEffect } from 'react';
import { NativeSpeechInput, useSpeechRecognition } from '@/components/ui/NativeSpeechInput';
import { FileAttachment, AttachedFile } from '@/components/ui/FileAttachment';
import { Alert } from '@/components/ui/Alert';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faStop, faPlus } from '@/lib/fontawesome';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  disabled?: boolean;
  onInterrupt?: () => void | Promise<boolean | void>;
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

export function ChatInput({
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
}: ChatInputProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [forceStopSpeech, setForceStopSpeech] = useState(false);
  const [shouldSendAfterStop, setShouldSendAfterStop] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Speech recognition hook
  const {
    transcript: speechTranscript,
    isListening,
    error: speechError,
    status: speechStatus,
    handleTranscript,
    handleError,
    handleStatusChange,
    handleAudioLevel,
    clearTranscript,
    clearError,
  } = useSpeechRecognition();

  // Handle speech transcript updates - show live updates
  useEffect(() => {
    if (speechTranscript.trim()) {
      // For live updates, replace any existing content with the live transcript
      onChange(speechTranscript);

      // Only auto-submit on final results (when status changes to idle)
      // We'll handle this in the status change handler instead
    }
  }, [speechTranscript, onChange]);

  // Handle speech status changes
  useEffect(() => {
    if (speechStatus === 'idle' && speechTranscript.trim()) {
      // Speech recognition finished - auto-submit if enabled
      if (autoSubmitOnSpeech) {
        setTimeout(() => {
          onSubmit();
        }, 100);
      }
      clearTranscript();
    }
  }, [speechStatus, speechTranscript, autoSubmitOnSpeech, onSubmit, clearTranscript]);

  // Handle sending message after forced stop
  useEffect(() => {
    if (shouldSendAfterStop && !isListening && value.trim()) {
      setShouldSendAfterStop(false);
      onSubmit();
    }
  }, [shouldSendAfterStop, isListening, value, onSubmit]);

  // Auto-resize textarea when value changes (including from speech recognition)
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      const newHeight = Math.max(44, Math.min(textarea.scrollHeight, 88));
      textarea.style.height = newHeight + 'px';
    }
  }, [value]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isListening) {
        // Stop dictation and flag to send message after stop
        setShouldSendAfterStop(true);
        setForceStopSpeech(true);
        setTimeout(() => setForceStopSpeech(false), 100);
      } else if (value.trim()) {
        onSubmit();
      }
    } else if (e.key === 'Escape') {
      if (isStreaming && onInterrupt) {
        e.preventDefault();
        onInterrupt();
      } else if (isListening) {
        // Stop dictation on Escape (don't send)
        setShouldSendAfterStop(false); // Make sure we don't send
        setForceStopSpeech(true);
        setTimeout(() => setForceStopSpeech(false), 100);
      }
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
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
        <div className="flex items-center gap-2 text-error text-xs">
          <div className="w-2 h-2 bg-error rounded-full"></div>
          <span>Speech error</span>
        </div>
      );
    }

    if (isListening) {
      return (
        <div className="flex items-center gap-2 text-success text-xs">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span>Listening...</span>
        </div>
      );
    }

    if (speechStatus === 'processing') {
      return (
        <div className="flex items-center gap-2 text-info text-xs">
          <div className="w-2 h-2 bg-info rounded-full animate-pulse"></div>
          <span>Processing...</span>
        </div>
      );
    }

    if (disabled) {
      return (
        <div className="flex items-center gap-2 text-base-content/60 text-xs">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span>Tool running...</span>
        </div>
      );
    }

    return null;
  };

  const handleSendClick = () => {
    if (isStreaming && onInterrupt) {
      onInterrupt();
    } else if (!isListening) {
      onSubmit();
    }
  };

  // Button should be enabled when streaming (for stop) or when has content (for send)
  const isDisabled = !isStreaming && (disabled || isListening || !value.trim());

  return (
    <div className="relative">
      {/* Mobile Status Bar - Hidden, status moved to bottom */}
      <div className="hidden">{getStatusIndicator()}</div>

      {/* Speech Error Display */}
      {speechError && (
        <Alert variant="error" title="Voice Input" description={speechError} className="mb-3" />
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
        {/* Clean Input Container - Matching Sample Design */}
        <div
          className={`
            flex items-center w-full bg-base-100 rounded-md px-3 py-2 text-base-content 
            focus-within:ring-2 focus-within:ring-success transition-all duration-200
            ${isListening ? 'ring-1 ring-success/50' : ''}
            ${isDragOver ? 'ring-2 ring-primary' : ''}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Left Plus Icon (File Attachment) */}
          {showFileAttachment && onFilesAttached && (
            <button
              type="button"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.accept =
                  'image/*,text/*,.pdf,.doc,.docx,.md,.json,.csv,.xlsx,.ts,.tsx,.js,.jsx,.py,.html,.css,.scss,.sass';
                input.onchange = (e) => {
                  const files = (e.target as HTMLInputElement).files;
                  if (files) handleFilesSelected(files);
                };
                input.click();
              }}
              disabled={disabled || isListening}
              className="text-base-content/60 hover:text-base-content/80 mr-3 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-5 h-5" />
            </button>
          )}

          {/* Simple Textarea Input */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={getDynamicPlaceholder()}
            disabled={disabled || isListening}
            className="flex-1 bg-transparent outline-none placeholder:text-base-content/60 text-base-content resize-none overflow-y-auto"
            style={{
              minHeight: '44px', // Larger minimum height (~2 lines)
              maxHeight: '88px', // ~3-4 lines before scrolling
              lineHeight: '1.5', // Better line spacing
            }}
            rows={2}
            autoFocus={!disabled && !isListening}
            data-testid="message-input"
            onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
              const target = e.target as HTMLTextAreaElement;
              // Reset height to auto to get accurate scrollHeight
              target.style.height = 'auto';
              // Set height based on content, but within our min/max bounds
              const newHeight = Math.max(44, Math.min(target.scrollHeight, 88));
              target.style.height = newHeight + 'px';
            }}
          />

          {/* Voice Input */}
          {showVoiceButton && (
            <div className="mr-3">
              <NativeSpeechInput
                onTranscript={handleTranscript}
                onError={handleError}
                onStatusChange={handleStatusChange}
                onAudioLevel={handleAudioLevel}
                size="sm"
                variant="ghost"
                language={speechLanguage}
                continuous={true}
                interimResults={true}
                forceStop={forceStopSpeech}
                className="text-base-content/60 hover:text-base-content/80 p-0 bg-transparent border-0 rounded-none w-5 h-5"
              />
            </div>
          )}

          {/* Send Button */}
          <div className="h-8 w-8 flex items-center justify-center rounded-full bg-base-200 hover:bg-base-300 transition-colors">
            <button
              type="button"
              onClick={handleSendClick}
              disabled={isDisabled}
              data-testid={isStreaming ? 'stop-button' : 'send-button'}
              className="w-full h-full flex items-center justify-center text-base-content/70 hover:text-base-content transition-colors"
              title={
                isStreaming
                  ? 'Stop response (ESC)'
                  : value.trim()
                    ? 'Send message'
                    : 'Type a message to send'
              }
            >
              <FontAwesomeIcon icon={isStreaming ? faStop : faPaperPlane} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
