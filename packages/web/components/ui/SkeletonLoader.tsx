// ABOUTME: Skeleton loader component for showing loading states

interface SkeletonLoaderProps {
  className?: string;
  width?: string;
  height?: string;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export default function SkeletonLoader({
  className = '',
  width = 'w-full',
  height = 'h-4',
  rounded = 'md',
}: SkeletonLoaderProps) {
  const roundedClass = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];

  return (
    <div
      className={`bg-base-300 animate-pulse ${width} ${height} ${roundedClass} ${className}`}
      role="status"
      aria-label="Loading..."
    />
  );
}

interface DocumentSkeletonProps {
  className?: string;
}

export function DocumentSkeleton({ className = '' }: DocumentSkeletonProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Document header skeleton */}
      <div className="flex items-center gap-2">
        <SkeletonLoader width="w-4" height="h-4" rounded="sm" />
        <SkeletonLoader width="w-48" height="h-4" />
        <div className="ml-auto flex gap-2">
          <SkeletonLoader width="w-12" height="h-6" rounded="full" />
          <SkeletonLoader width="w-6" height="h-6" rounded="sm" />
        </div>
      </div>

      {/* Thumbnail skeleton */}
      <SkeletonLoader width="w-full" height="h-32" rounded="md" />

      {/* Text preview skeleton */}
      <div className="space-y-2">
        <SkeletonLoader width="w-full" height="h-3" />
        <SkeletonLoader width="w-4/5" height="h-3" />
        <SkeletonLoader width="w-3/4" height="h-3" />
      </div>

      {/* Action button skeleton */}
      <div className="flex justify-between items-center">
        <SkeletonLoader width="w-32" height="h-8" rounded="md" />
        <SkeletonLoader width="w-20" height="h-4" />
      </div>
    </div>
  );
}
