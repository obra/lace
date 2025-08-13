import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faTimes } from '@/lib/fontawesome';

interface VoiceButtonProps {
  isListening: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'ghost' | 'outline';
  disabled?: boolean;
  className?: string;
}

export default function VoiceButton({
  isListening,
  onToggle,
  size = 'md',
  variant = 'primary',
  disabled = false,
  className = '',
}: VoiceButtonProps) {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'w-8 h-8';
      case 'md':
        return 'w-10 h-10';
      case 'lg':
        return 'w-12 h-12';
      default:
        return 'w-10 h-10';
    }
  };

  const getVariantClasses = () => {
    if (disabled) {
      return 'bg-base-300 text-base-content/50 cursor-not-allowed';
    }

    if (isListening) {
      return 'bg-red-500 hover:bg-red-600 text-white';
    }

    switch (variant) {
      case 'primary':
        return 'bg-primary hover:bg-primary-focus text-primary-content';
      case 'ghost':
        return 'bg-transparent hover:bg-base-200 text-base-content';
      case 'outline':
        return 'border border-base-300 hover:bg-base-200 text-base-content';
      default:
        return 'bg-primary hover:bg-primary-focus text-primary-content';
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

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`
        relative rounded-full flex items-center justify-center transition-all duration-200
        ${getSizeClasses()} ${getVariantClasses()}
        ${isListening && !disabled ? 'animate-pulse' : !disabled ? 'hover:scale-105' : ''}
        ${className}
      `}
      aria-label={isListening ? 'Stop listening' : 'Start voice input'}
    >
      <FontAwesomeIcon icon={isListening ? faTimes : faMicrophone} className={getIconSize()} />

      {/* Active indicator */}
      {isListening && !disabled && (
        <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-25"></div>
      )}
    </button>
  );
}
