import { ReactNode } from 'react';
import { Avatar } from '@/components/ui';
import { formatTime } from '@/lib/format';

interface MessageHeaderProps {
  name: string;
  timestamp: Date | string;
  avatar?: ReactNode;
  badge?: {
    text: string;
    variant?: 'default' | 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info';
    className?: string;
  };
  role?: 'user' | 'assistant';
  className?: string;
}

export default function MessageHeader({
  name,
  timestamp,
  avatar,
  badge,
  role,
  className = '',
}: MessageHeaderProps) {
  const getBadgeClasses = (variant: string = 'default') => {
    const baseClasses = 'text-xs px-1.5 py-0.5 rounded';
    
    switch (variant) {
      case 'primary':
        return `${baseClasses} bg-primary/20 text-primary`;
      case 'secondary':
        return `${baseClasses} bg-secondary/20 text-secondary`;
      case 'accent':
        return `${baseClasses} bg-accent/20 text-accent`;
      case 'success':
        return `${baseClasses} bg-success/20 text-success`;
      case 'warning':
        return `${baseClasses} bg-warning/20 text-warning`;
      case 'error':
        return `${baseClasses} bg-error/20 text-error`;
      case 'info':
        return `${baseClasses} bg-info/20 text-info`;
      case 'claude':
        return `${baseClasses} bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400`;
      case 'gpt-4':
        return `${baseClasses} bg-green-900/20 text-green-600 dark:bg-green-900/30 dark:text-green-400`;
      case 'gemini':
        return `${baseClasses} bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400`;
      default:
        return `${baseClasses} bg-base-content/10 text-base-content/60`;
    }
  };

  return (
    <div className={`flex gap-3 ${className}`}>
      {/* Avatar */}
      <div className="flex-shrink-0">
        {avatar || (role && <Avatar role={role} size="sm" />)}
      </div>

      {/* Header content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-medium text-sm text-base-content">{name}</span>
          <span className="text-xs text-base-content/50">
            {typeof timestamp === 'string' ? timestamp : formatTime(timestamp)}
          </span>
          {badge && (
            <span className={badge.className || getBadgeClasses(badge.variant)}>
              {badge.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}