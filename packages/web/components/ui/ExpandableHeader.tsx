import { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import IconButton from './IconButton';

interface ExpandableHeaderProps {
  title: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  badge?: string | number;
  actions?: ReactNode;
  className?: string;
}

const ExpandableHeader = ({
  title,
  isExpanded,
  onToggle,
  badge,
  actions,
  className = ''
}: ExpandableHeaderProps) => {
  return (
    <div className={`flex items-center justify-between p-3 hover:bg-base-200 transition-colors cursor-pointer ${className}`}>
      <button 
        onClick={onToggle}
        className="flex items-center gap-2 flex-1 text-left"
      >
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-4 text-base-content/60" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-base-content/60" />
        )}
        
        <span className="font-medium text-base-content">{title}</span>
        
        {badge && (
          <div className="badge badge-primary badge-xs">
            {badge}
          </div>
        )}
      </button>

      {actions && (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
};

export default ExpandableHeader;