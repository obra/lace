import { useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperclip } from '~/lib/fontawesome';

interface FileAttachButtonProps {
  onFilesSelected: (files: FileList) => void;
  disabled?: boolean;
  maxFiles?: number;
  acceptedTypes?: string[];
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'ghost' | 'outline';
  className?: string;
  title?: string;
}

export default function FileAttachButton({
  onFilesSelected,
  disabled = false,
  maxFiles = 10,
  acceptedTypes = [
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
  ],
  size = 'md',
  variant = 'ghost',
  className = '',
  title = 'Attach files',
}: FileAttachButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'p-1.5';
      case 'md':
        return 'p-2';
      case 'lg':
        return 'p-3';
      default:
        return 'p-2';
    }
  };

  const getVariantClasses = () => {
    if (disabled) {
      return 'text-base-content/30 cursor-not-allowed';
    }

    switch (variant) {
      case 'primary':
        return 'text-primary hover:text-primary-focus hover:bg-primary/10';
      case 'ghost':
        return 'text-base-content/60 hover:text-teal-600 hover:bg-base-200';
      case 'outline':
        return 'text-base-content/60 hover:text-teal-600 border border-base-300 hover:bg-base-200';
      default:
        return 'text-base-content/60 hover:text-teal-600 hover:bg-base-200';
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'sm':
        return 'w-3 h-3';
      case 'md':
        return 'w-4 h-4';
      case 'lg':
        return 'w-5 h-5';
      default:
        return 'w-4 h-4';
    }
  };

  const handleClick = useCallback(() => {
    if (disabled || !fileInputRef.current) return;
    fileInputRef.current.click();
  }, [disabled]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFilesSelected(files);
      }
      // Clear the input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onFilesSelected]
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={acceptedTypes.join(',')}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />
      
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`
          ${getSizeClasses()} ${getVariantClasses()} 
          rounded-lg transition-colors
          ${className}
        `}
        title={title}
      >
        <FontAwesomeIcon icon={faPaperclip} className={getIconSize()} />
      </button>
    </>
  );
}