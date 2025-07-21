import { ReactNode } from 'react';
import { SectionHeader } from '@/components/ui';

interface SidebarSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: {
    text: string | number;
    variant?:
      | 'primary'
      | 'secondary'
      | 'accent'
      | 'success'
      | 'warning'
      | 'error'
      | 'info'
      | 'teal';
  };
  rightContent?: ReactNode;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
}

export default function SidebarSection({
  title,
  isExpanded,
  onToggle,
  children,
  badge,
  rightContent,
  className = '',
  contentClassName = '',
  disabled = false,
}: SidebarSectionProps) {
  return (
    <div className={`p-4 ${className}`}>
      <SectionHeader
        title={title}
        isExpanded={isExpanded}
        onToggle={onToggle}
        badge={badge}
        rightContent={rightContent}
        disabled={disabled}
        asButton={!rightContent || typeof rightContent === 'string'}
      />

      {isExpanded && <div className={`mt-2 space-y-1 ${contentClassName}`}>{children}</div>}
    </div>
  );
}
