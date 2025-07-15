import { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '~/lib/heroicons';

interface SectionHeaderProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  badge?: {
    text: string | number;
    variant?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info' | 'teal';
  };
  rightContent?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export default function SectionHeader({
  title,
  isExpanded,
  onToggle,
  badge,
  rightContent,
  className = '',
  disabled = false,
}: SectionHeaderProps) {
  const getBadgeClasses = (variant: string = 'primary') => {
    const baseClasses = 'badge badge-sm border-0';
    
    switch (variant) {
      case 'primary':
        return `${baseClasses} bg-primary text-primary-content`;
      case 'secondary':
        return `${baseClasses} bg-secondary text-secondary-content`;
      case 'accent':
        return `${baseClasses} bg-accent text-accent-content`;
      case 'success':
        return `${baseClasses} bg-success text-success-content`;
      case 'warning':
        return `${baseClasses} bg-warning text-warning-content`;
      case 'error':
        return `${baseClasses} bg-error text-error-content`;
      case 'info':
        return `${baseClasses} bg-info text-info-content`;
      case 'teal':
        return `${baseClasses} bg-teal-500 text-white`;
      default:
        return `${baseClasses} bg-primary text-primary-content`;
    }
  };

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`
        flex items-center justify-between w-full text-left p-3 
        hover:bg-base-200 rounded-lg transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      <span className="text-sm font-medium text-base-content">{title}</span>
      
      <div className="flex items-center gap-2">
        {badge && (
          <span className={getBadgeClasses(badge.variant)}>
            {badge.text}
          </span>
        )}
        
        {rightContent}
        
        {/* Expand/Collapse Icon */}
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-4 transition-transform text-base-content/60" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 transition-transform text-base-content/60" />
        )}
      </div>
    </button>
  );
}