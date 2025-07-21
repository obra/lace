'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  ChatTextarea, 
  VoiceButton, 
  SendButton, 
  FileAttachButton 
} from '@/components/ui';
import { FileAttachment, AttachedFile } from '@/components/ui/FileAttachment';

interface ChatInputComposerProps {
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
  showVoiceButton?: boolean;
  showFileAttachment?: boolean;
}

export default function ChatInputComposer({
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
  showVoiceButton = true,
  showFileAttachment = true,
}: ChatInputComposerProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<any>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleVoiceToggle = () => {
    if (isListening && onStopVoice) {
      onStopVoice();
    } else if (onStartVoice) {
      onStartVoice();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && isStreaming && onInterrupt) {
      e.preventDefault();
      onInterrupt();
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

  const dynamicPlaceholder = isDragOver
    ? 'Drop files here...'
    : isListening
      ? 'Listening...'
      : isStreaming
        ? 'Press ESC to interrupt...'
        : placeholder;

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

      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="relative">
        <div className="flex gap-3 items-end">
          {/* Voice Input (Mobile Only) */}
          {isMobile && showVoiceButton && onStartVoice && (
            <div className="lg:hidden">
              <VoiceButton
                isListening={isListening}
                onToggle={handleVoiceToggle}
                size="md"
                variant="ghost"
                disabled={disabled}
              />
            </div>
          )}

          {/* Message Input Area */}
          <div className="flex-1 relative">
            <ChatTextarea
              ref={textareaRef}
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              onKeyDown={handleKeyDown}
              placeholder={dynamicPlaceholder}
              disabled={disabled}
              isMobile={isMobile}
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="pr-20"
              autoFocus={!disabled}
              data-testid="message-input"
            />

            {/* Right Side Controls */}
            <div className="absolute right-2 bottom-2 flex gap-1">
              {/* File Attachment Button */}
              {showFileAttachment && onFilesAttached && (
                <FileAttachButton
                  onFilesSelected={handleFilesSelected}
                  disabled={disabled}
                  size="md"
                  variant="ghost"
                />
              )}

              {/* Send/Stop Button */}
              <SendButton
                onSubmit={onSubmit}
                onStop={onInterrupt}
                disabled={disabled}
                isStreaming={isStreaming}
                hasContent={Boolean(value.trim())}
                size="md"
              />
            </div>
          </div>
        </div>

        {/* Voice Status Indicator (Mobile) */}
        {isListening && isMobile && (
          <div className="flex items-center justify-center gap-2 mt-2 text-teal-600 text-sm lg:hidden">
            <div className="flex gap-1">
              {[12, 16, 20, 16, 12].map((height, index) => (
                <div
                  key={index}
                  className="w-1 bg-teal-600 rounded-full animate-pulse"
                  style={{ 
                    height: `${height}px`,
                    animationDelay: `${index * 0.1}s`
                  }}
                />
              ))}
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