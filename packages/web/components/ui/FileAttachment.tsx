'use client';

import React from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperclip, faFile, faImage, faFileCode, faFileAlt } from '@/lib/fontawesome';
import { DismissButton } from '@/components/ui/DismissButton';
import { Modal } from '@/components/ui/Modal';

export interface AttachedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  url?: string;
}

interface FileAttachmentProps {
  attachedFiles: AttachedFile[];
  onFilesAttached: (files: AttachedFile[]) => void;
  onFileRemoved: (fileId: string) => void;
  onFileCleared: () => void;
  maxFiles?: number;
  maxSizeBytes?: number;
  acceptedTypes?: string[];
  disabled?: boolean;
}

const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ACCEPTED_TYPES = [
  'image/*',
  'text/*',
  '.pdf',
  '.doc',
  '.docx',
  '.md',
  '.json',
  '.csv',
  '.xlsx',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.html',
  '.css',
  '.scss',
  '.sass',
];

export function FileAttachment({
  attachedFiles,
  onFilesAttached,
  onFileRemoved,
  onFileCleared,
  maxFiles = DEFAULT_MAX_FILES,
  maxSizeBytes = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  disabled = false,
}: FileAttachmentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleFileSelect = useCallback(
    (selectedFiles: FileList | null) => {
      if (!selectedFiles || disabled) return;

      const newFiles: AttachedFile[] = [];
      const errors: string[] = [];

      Array.from(selectedFiles).forEach((file) => {
        // Check file count limit
        if (attachedFiles.length + newFiles.length >= maxFiles) {
          errors.push(`Maximum ${maxFiles} files allowed`);
          return;
        }

        // Check file size
        if (file.size > maxSizeBytes) {
          errors.push(`${file.name} is too large (max ${formatFileSize(maxSizeBytes)})`);
          return;
        }

        // Check file type (simplified check)
        const isAccepted = acceptedTypes.some((type) => {
          if (type.includes('*')) {
            const category = type.split('/')[0];
            return file.type.startsWith(category);
          }
          return type.startsWith('.')
            ? file.name.toLowerCase().endsWith(type.toLowerCase())
            : file.type === type;
        });

        if (!isAccepted) {
          errors.push(`${file.name} type not supported`);
          return;
        }

        // Check for duplicates
        const isDuplicate = attachedFiles.some(
          (attached) => attached.name === file.name && attached.size === file.size
        );

        if (isDuplicate) {
          errors.push(`${file.name} already attached`);
          return;
        }

        const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        newFiles.push({
          id: fileId,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
        });
      });

      if (errors.length > 0) {
        console.warn('File attachment errors:', errors);
        // You could show these errors to the user via a toast or modal
      }

      if (newFiles.length > 0) {
        onFilesAttached(newFiles);
      }

      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [attachedFiles, onFilesAttached, maxFiles, maxSizeBytes, acceptedTypes, disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (!disabled) {
        handleFileSelect(e.dataTransfer.files);
      }
    },
    [handleFileSelect, disabled]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFileSelect(e.target.files);
    },
    [handleFileSelect]
  );

  const handleAttachClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-2">
      {/* File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptedTypes.join(',')}
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled}
      />

      {/* Drag and Drop Zone - Hidden on mobile */}
      {attachedFiles.length === 0 && !isMobile && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
            dragOver ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-base-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={!disabled ? handleAttachClick : undefined}
        >
          <FontAwesomeIcon icon={faPaperclip} className="w-6 h-6 text-base-content/40 mb-2" />
          <p className="text-sm text-base-content/60">Drop files here or click to attach</p>
          <p className="text-xs text-base-content/40 mt-1">
            Max {maxFiles} files, {formatFileSize(maxSizeBytes)} each
          </p>
        </div>
      )}

      {/* Attached Files Carousel */}
      {attachedFiles.length > 0 && (
        <FileCarousel
          attachedFiles={attachedFiles}
          onFileRemoved={onFileRemoved}
          onFileCleared={onFileCleared}
          disabled={disabled}
        />
      )}
    </div>
  );
}

interface FileCarouselProps {
  attachedFiles: AttachedFile[];
  onFileRemoved: (fileId: string) => void;
  onFileCleared: () => void;
  disabled: boolean;
}

function FileCarousel({
  attachedFiles,
  onFileRemoved,
  onFileCleared,
  disabled,
}: FileCarouselProps) {
  const [selectedFile, setSelectedFile] = useState<AttachedFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleFileClick = async (file: AttachedFile) => {
    setSelectedFile(file);

    // Read file content for text files
    if (isTextFile(file)) {
      try {
        const content = await readFileContent(file.file);
        setFileContent(content);
      } catch {
        setFileContent('Error reading file content');
      }
    }

    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedFile(null);
    setFileContent('');
  };

  const isTextFile = (file: AttachedFile): boolean => {
    return (
      file.type.startsWith('text/') ||
      file.name.match(/\.(md|txt|json|csv|html|css|js|jsx|ts|tsx|py|yaml|yml|xml)$/i) !== null
    );
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-base-content/70 font-medium">
          Attached Files ({attachedFiles.length})
        </span>
        <button
          type="button"
          onClick={onFileCleared}
          className="text-xs text-base-content/50 hover:text-red-600 transition-colors"
          disabled={disabled}
        >
          Clear all
        </button>
      </div>

      <div className="relative">
        <div
          className="flex gap-3 overflow-x-auto scroll-smooth pb-2"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {attachedFiles.map((file) => (
            <div key={file.id} className="flex-none w-32">
              <FilePreviewCard
                file={file}
                onFileClick={(f) => void handleFileClick(f)}
                onFileRemoved={onFileRemoved}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>
      </div>

      {/* File Content Modal */}
      <Modal isOpen={isModalOpen} onClose={handleModalClose} title={selectedFile?.name} size="lg">
        {selectedFile && (
          <FileContentModal file={selectedFile} content={fileContent} onClose={handleModalClose} />
        )}
      </Modal>
    </div>
  );
}

interface FilePreviewCardProps {
  file: AttachedFile;
  onFileClick: (file: AttachedFile) => void;
  onFileRemoved: (fileId: string) => void;
  disabled: boolean;
}

function FilePreviewCard({ file, onFileClick, onFileRemoved, disabled }: FilePreviewCardProps) {
  const [imagePreview, setImagePreview] = useState<string>('');
  const [textPreview, setTextPreview] = useState<string>('');

  useEffect(() => {
    if (isImageFile(file)) {
      const url = URL.createObjectURL(file.file);
      setImagePreview(url);
      return () => URL.revokeObjectURL(url);
    } else if (isTextFile(file) && file.size < 1024 * 10) {
      // Only preview small text files
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setTextPreview(content.slice(0, 200)); // First 200 chars
      };
      reader.readAsText(file.file);
    }
  }, [file]);

  const isImageFile = (file: AttachedFile): boolean => {
    return file.type.startsWith('image/');
  };

  const isTextFile = (file: AttachedFile): boolean => {
    return (
      file.type.startsWith('text/') ||
      file.name.match(/\.(md|txt|json|csv|html|css|js|jsx|ts|tsx|py|yaml|yml|xml)$/i) !== null
    );
  };

  const getFiletypeLabel = (file: AttachedFile): string => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension) {
      return extension.toUpperCase();
    }
    if (file.type.startsWith('image/')) return 'IMG';
    if (file.type.startsWith('text/')) return 'TXT';
    return 'FILE';
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const getFileIconForPreview = (file: AttachedFile) => {
    if (file.type.startsWith('image/')) return faImage;
    if (file.type.includes('text') || file.name.match(/\.(md|txt|json|csv)$/i)) return faFileAlt;
    if (file.name.match(/\.(ts|tsx|js|jsx|py|html|css|scss|sass)$/i)) return faFileCode;
    return faFile;
  };

  return (
    <div className="relative group bg-base-200 rounded-lg overflow-hidden border border-base-300 hover:border-primary/50 transition-all duration-200 cursor-pointer aspect-square max-h-44">
      {/* Remove button */}
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-all duration-200">
        <div onClick={(e) => e.stopPropagation()}>
          <DismissButton
            onClick={() => onFileRemoved(file.id)}
            size="sm"
            ariaLabel="Remove file"
            disabled={disabled}
            className="bg-black/50 text-white hover:bg-black/70 hover:scale-110"
          />
        </div>
      </div>

      {/* File type overlay pill - Hide for images */}
      {!isImageFile(file) && (
        <div className="absolute bottom-2 right-2 z-10 bg-black/70 text-white px-2 py-1 rounded-full text-xs font-medium">
          {getFiletypeLabel(file)}
        </div>
      )}

      <div onClick={() => onFileClick(file)} className="p-1.5 h-full flex flex-col">
        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center relative">
          {isImageFile(file) && imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imagePreview}
              alt={file.name}
              className="w-full h-full object-cover rounded"
            />
          ) : isTextFile(file) && textPreview ? (
            <div className="text-xs text-base-content/60 font-mono bg-base-100 p-2 rounded text-left w-full h-full overflow-hidden">
              {textPreview}
              {textPreview.length >= 200 && '...'}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full bg-base-100 rounded">
              <FontAwesomeIcon
                icon={getFileIconForPreview(file)}
                className="w-8 h-8 text-base-content/40 mb-2"
              />
              <div className="text-xs text-base-content/60 text-center px-1">
                <div className="font-medium truncate" title={file.name}>
                  {file.name}
                </div>
                <div className="text-xs text-base-content/40">{formatFileSize(file.size)}</div>
              </div>
            </div>
          )}
        </div>

        {/* File info overlay for images */}
        {isImageFile(file) && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
            <div className="text-white text-xs">
              <div className="font-medium truncate" title={file.name}>
                {file.name}
              </div>
              <div className="text-xs text-white/80">{formatFileSize(file.size)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface FileContentModalProps {
  file: AttachedFile;
  content: string;
}

function FileContentModal({ file, content }: FileContentModalProps) {
  const isImageFile = (file: AttachedFile): boolean => {
    return file.type.startsWith('image/');
  };

  const getFileIcon = (file: AttachedFile) => {
    if (file.type.startsWith('image/')) return faImage;
    if (file.type.includes('text') || file.name.match(/\.(md|txt|json|csv)$/i)) return faFileAlt;
    if (file.name.match(/\.(ts|tsx|js|jsx|py|html|css|scss|sass)$/i)) return faFileCode;
    return faFile;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-4">
      {/* File info */}
      <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
        <FontAwesomeIcon icon={getFileIcon(file)} className="w-6 h-6 text-base-content/60" />
        <div className="flex-1">
          <div className="font-medium text-base-content">{file.name}</div>
          <div className="text-sm text-base-content/60">
            {file.type} • {formatFileSize(file.size)}
          </div>
        </div>
      </div>

      {/* File content */}
      <div className="max-h-96 overflow-y-auto">
        {isImageFile(file) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={URL.createObjectURL(file.file)}
            alt={file.name}
            className="max-w-full h-auto rounded-lg border border-base-300"
          />
        ) : content ? (
          <pre className="text-sm bg-base-200 p-4 rounded-lg overflow-x-auto font-mono">
            <code className="font-mono">{content}</code>
          </pre>
        ) : (
          <div className="text-center py-8 text-base-content/60">
            <FontAwesomeIcon icon={getFileIcon(file)} className="w-12 h-12 mb-3" />
            <p>File preview not available</p>
          </div>
        )}
      </div>
    </div>
  );
}
