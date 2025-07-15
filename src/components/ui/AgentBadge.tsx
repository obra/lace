interface AgentBadgeProps {
  agent: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export default function AgentBadge({ agent, size = 'xs', className = '' }: AgentBadgeProps) {
  const agentBadgeColors = {
    Claude: 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    'GPT-4': 'bg-green-900/20 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    Gemini: 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  };

  const sizeClasses = {
    xs: 'text-xs px-1.5 py-0.5',
    sm: 'text-sm px-2 py-1',
    md: 'text-base px-3 py-1.5',
  };

  const badgeColorClass = agentBadgeColors[agent as keyof typeof agentBadgeColors] || 
    'bg-base-content/10 text-base-content/60';

  return (
    <span
      className={`${sizeClasses[size]} rounded ${badgeColorClass} ${className}`}
    >
      {agent}
    </span>
  );
}