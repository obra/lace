'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperclip } from '~/lib/fontawesome';

interface DragDropOverlayProps {
  children: React.ReactNode;
  onFilesDropped: (files: FileList) => void;
  disabled?: boolean;
  className?: string;
}

export function DragDropOverlay({
  children,
  onFilesDropped,
  disabled = false,
  className = '',
}: DragDropOverlayProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragEnterCounter, setDragEnterCounter] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setDragEnterCounter((prev) => prev + 1);

      // Check if the drag contains files
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setDragEnterCounter((prev) => {
        const newCount = prev - 1;
        if (newCount <= 0) {
          setIsDragOver(false);
          return 0;
        }
        return newCount;
      });
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      // Set drop effect to copy to show the appropriate cursor
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      setIsDragOver(false);
      setDragEnterCounter(0);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        onFilesDropped(files);
      }
    },
    [disabled, onFilesDropped]
  );

  // Reset state when disabled changes
  useEffect(() => {
    if (disabled) {
      setIsDragOver(false);
      setDragEnterCounter(0);
    }
  }, [disabled]);

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Drag Overlay */}
      {isDragOver && !disabled && (
        <div className="absolute inset-0 bg-teal-500/10 border-2 border-dashed border-teal-500 rounded-lg flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="text-center p-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-teal-500/20 rounded-full flex items-center justify-center">
              <FontAwesomeIcon icon={faPaperclip} className="w-8 h-8 text-teal-600" />
            </div>
            <h3 className="text-lg font-semibold text-teal-700 dark:text-teal-300 mb-2">
              Drop files to attach
            </h3>
            <p className="text-sm text-teal-600 dark:text-teal-400">
              Release to add files to your message
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
