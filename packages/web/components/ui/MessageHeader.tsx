import React from 'react';
import { ReactNode } from 'react';
import { Avatar } from '@/components/ui';
import { formatTime } from '@/lib/format';
import LLMModelBadge from './LLMModelBadge';

interface MessageHeaderProps {
  name: string;
  timestamp: Date | string;
  avatar?: ReactNode;
  badge?: {
    text: string;
    variant?:
      | 'default'
      | 'primary'
      | 'secondary'
      | 'accent'
      | 'success'
      | 'warning'
      | 'error'
      | 'info';
    className?: string;
  };
  icon?: ReactNode;
  role?: 'user' | 'assistant';
  className?: string;
  action?: ReactNode;
  hideTimestamp?: boolean;
}

export default function MessageHeader({
  name,
  timestamp,
  avatar,
  badge,
  icon,
  role,
  className = '',
  action,
  hideTimestamp = false,
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
      default:
        return `${baseClasses} bg-base-content/10 text-base-content/60`;
    }
  };

  const isLLMModel = (text: string) => {
    const lowerText = text.toLowerCase();
    return (
      lowerText.includes('claude') || lowerText.includes('gpt') || lowerText.includes('gemini')
    );
  };

  return (
    <div className={`flex gap-3 ${className}`}>
      {/* Avatar */}
      <div className="flex-shrink-0">{avatar || (role && <Avatar role={role} size="sm" />)}</div>

      {/* Header content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            {icon && <span className="text-sm">{icon}</span>}
            <span className="font-medium text-sm text-base-content">{name}</span>
            {badge &&
              (isLLMModel(badge.text) ? (
                <LLMModelBadge model={badge.text} className={badge.className} />
              ) : (
                <span className={badge.className || getBadgeClasses(badge.variant)}>
                  {badge.text}
                </span>
              ))}
          </div>
          <div className="flex items-center gap-2">
            {!hideTimestamp && (
              <span className="text-xs text-base-content/50">{formatTime(timestamp)}</span>
            )}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}
