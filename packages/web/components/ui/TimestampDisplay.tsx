import { formatTime } from '@/lib/format';

interface TimestampDisplayProps {
  timestamp: Date | string;
  format?: 'time' | 'relative' | 'full';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export default function TimestampDisplay({ 
  timestamp, 
  format = 'time', 
  size = 'xs',
  className = '' 
}: TimestampDisplayProps) {
  const sizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    md: 'text-base',
  };

  const formatTimestamp = (ts: Date | string): string => {
    const date = typeof ts === 'string' ? new Date(ts) : ts;
    
    switch (format) {
      case 'time':
        return formatTime(date);
      case 'relative':
        return getRelativeTime(date);
      case 'full':
        return date.toLocaleString();
      default:
        return formatTime(date);
    }
  };

  const getRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <span className={`${sizeClasses[size]} text-base-content/50 ${className}`}>
      {formatTimestamp(timestamp)}
    </span>
  );
}