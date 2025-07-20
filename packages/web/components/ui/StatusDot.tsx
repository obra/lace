interface StatusDotProps {
  status: 'online' | 'offline' | 'busy' | 'away' | 'error' | 'success' | 'warning' | 'info';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

const StatusDot = ({ 
  status, 
  size = 'sm', 
  pulse = false, 
  className = '' 
}: StatusDotProps) => {
  const sizeClasses = {
    xs: 'w-1.5 h-1.5',
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  };

  const statusClasses = {
    online: 'bg-success',
    offline: 'bg-base-300',
    busy: 'bg-error',
    away: 'bg-warning',
    error: 'bg-error',
    success: 'bg-success',
    warning: 'bg-warning',
    info: 'bg-info'
  };

  const pulseClass = pulse ? 'animate-pulse' : '';

  return (
    <div 
      className={`${sizeClasses[size]} ${statusClasses[status]} ${pulseClass} rounded-full ${className}`}
      aria-label={`Status: ${status}`}
    />
  );
};

export default StatusDot;