'use client';

import { ChatInputComposer } from '~/components/ui';
import { AttachedFile } from '~/components/ui/FileAttachment';

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
  return (
    <ChatInputComposer
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      disabled={disabled}
      isListening={isListening}
      onStartVoice={onStartVoice}
      onStopVoice={onStopVoice}
      onInterrupt={onInterrupt}
      isStreaming={isStreaming}
      placeholder={placeholder}
      attachedFiles={attachedFiles}
      onFilesAttached={onFilesAttached}
      onFileRemoved={onFileRemoved}
      onFileCleared={onFileCleared}
      showVoiceButton={!!onStartVoice}
      showFileAttachment={!!onFilesAttached}
    />
  );
}
