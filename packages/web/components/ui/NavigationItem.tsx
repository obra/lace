import React from 'react';
import { ReactNode, MouseEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { Badge, StatusDot } from '@/components/ui';

interface NavigationItemProps {
  icon?: IconDefinition;
  title: string;
  subtitle?: string;
  badge?: string | number;
  status?: 'online' | 'offline' | 'busy' | 'away' | 'error' | 'success';
  isActive?: boolean;
  isDisabled?: boolean;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

const NavigationItem = ({
  icon,
  title,
  subtitle,
  badge,
  status,
  isActive = false,
  isDisabled = false,
  actions,
  onClick,
  className = '',
}: NavigationItemProps) => {
  const handleClick = (e: MouseEvent) => {
    if (isDisabled) return;
    onClick?.();
  };

  const handleActionsClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const baseClasses = `
    flex items-center gap-3 p-3 rounded-lg transition-colors cursor-pointer
    hover:bg-base-200
  `;

  const stateClasses = isActive
    ? 'bg-primary/10 text-primary border-l-2 border-primary'
    : isDisabled
      ? 'opacity-50 cursor-not-allowed hover:bg-transparent'
      : '';

  return (
    <div className={`${baseClasses} ${stateClasses} ${className}`} onClick={handleClick}>
      {/* Icon */}
      {icon && (
        <div className="flex-shrink-0 relative">
          <FontAwesomeIcon
            icon={icon}
            className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-base-content/60'}`}
          />
          {status && (
            <div className="absolute -top-1 -right-1">
              <StatusDot status={status} size="xs" />
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`font-medium truncate ${isActive ? 'text-primary' : 'text-base-content'}`}
          >
            {title}
          </span>

          {badge && (
            <Badge variant="primary" size="xs">
              {badge}
            </Badge>
          )}
        </div>

        {subtitle && <div className="text-xs text-base-content/60 truncate">{subtitle}</div>}
      </div>

      {/* Actions */}
      {actions && (
        <div className="flex-shrink-0" onClick={handleActionsClick}>
          {actions}
        </div>
      )}
    </div>
  );
};

export default NavigationItem;
