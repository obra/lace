import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot, faUser } from '@fortawesome/free-solid-svg-icons';

interface AvatarProps {
  role: 'user' | 'assistant';
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

const iconSizes = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export default function Avatar({ role, size = 'md' }: AvatarProps) {
  return (
    <div className="chat-image avatar">
      <div
        className={`${sizeClasses[size]} rounded-full bg-neutral text-neutral-content flex items-center justify-center`}
      >
        <FontAwesomeIcon icon={role === 'user' ? faUser : faRobot} className={iconSizes[size]} />
      </div>
    </div>
  );
}
