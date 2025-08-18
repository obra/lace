import React from 'react';
import { ReactNode } from 'react';
import { Avatar, Badge, StatusDot } from '@/components/ui';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  avatar?: {
    name?: string;
    status?: 'online' | 'offline' | 'busy' | 'away';
  };
  header?: {
    name: string;
    timestamp?: string;
    badges?: Array<{
      text: string;
      variant?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info';
    }>;
  };
  children: ReactNode;
  actions?: ReactNode;
  variant?: 'default' | 'highlighted' | 'error' | 'system';
  className?: string;
}

const MessageBubble = ({
  role,
  avatar,
  header,
  children,
  actions,
  variant = 'default',
  className = '',
}: MessageBubbleProps) => {
  const variantClasses = {
    default: 'bg-base-100 border-base-300',
    highlighted: 'bg-primary/5 border-primary/20',
    error: 'bg-error/5 border-error/20',
    system: 'bg-info/5 border-info/20',
  };

  return (
    <div className={`border rounded-lg p-4 ${variantClasses[variant]} ${className}`}>
      <div className="flex gap-3 items-start">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <Avatar role={role} size="md" />
          {avatar?.status && (
            <div className="absolute -bottom-0.5 -right-0.5">
              <StatusDot status={avatar.status} size="sm" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          {header && (
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-base-content">{header.name}</span>

              {header.badges &&
                header.badges.map((badge, index) => (
                  <Badge key={index} variant={badge.variant} size="xs">
                    {badge.text}
                  </Badge>
                ))}

              {header.timestamp && (
                <span className="text-xs text-base-content/60 ml-auto">{header.timestamp}</span>
              )}
            </div>
          )}

          {/* Message Content */}
          <div className="text-base-content">{children}</div>

          {/* Actions */}
          {actions && (
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-base-300/50">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
