interface LoadingDotsProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  xs: 'loading-xs',
  sm: 'loading-sm',
  md: 'loading-md',
  lg: 'loading-lg',
};

export default function LoadingDots({ size = 'sm' }: LoadingDotsProps) {
  return <span className={`loading loading-dots ${sizeClasses[size]}`}></span>;
}
