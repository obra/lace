import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faStop } from '@/lib/fontawesome';

interface SendButtonProps {
  onSubmit?: () => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  hasContent?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function SendButton({
  onSubmit,
  onStop,
  disabled = false,
  isStreaming = false,
  hasContent = true,
  size = 'md',
  className = '',
}: SendButtonProps) {
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

  const handleClick = () => {
    if (isStreaming && onStop) {
      onStop();
    } else if (onSubmit) {
      onSubmit();
    }
  };

  // Button should be enabled when streaming (for stop) or when has content (for send)
  // Only disable when not streaming AND (disabled prop is true OR no content)
  const isDisabled = !isStreaming && (disabled || !hasContent);

  return (
    <button
      type={isStreaming ? 'button' : 'submit'}
      onClick={handleClick}
      disabled={isDisabled}
      className={`
        ${getSizeClasses()} rounded-xl transition-colors
        ${
          isStreaming
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-teal-600 text-white hover:bg-teal-700'
        }
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
      title={
        isStreaming
          ? 'Stop response (ESC)'
          : hasContent
            ? 'Send message'
            : 'Type a message to send'
      }
    >
      <FontAwesomeIcon 
        icon={isStreaming ? faStop : faPaperPlane} 
        className={getIconSize()} 
      />
    </button>
  );
}