'use client';

import React from 'react';
import { useState } from 'react';
import { motion, PanInfo, useMotionValue, useTransform } from 'framer-motion';
import { springConfig } from '@/lib/animations';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onTap?: () => void;
  swipeThreshold?: number;
  className?: string;
  leftAction?: {
    icon: React.ReactNode;
    color: string;
    label: string;
  };
  rightAction?: {
    icon: React.ReactNode;
    color: string;
    label: string;
  };
}

/** @public */
export function SwipeableCard({
  children,
  onSwipeLeft,
  onSwipeRight,
  onTap,
  swipeThreshold = 100,
  className = '',
  leftAction,
  rightAction,
}: SwipeableCardProps) {
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  const x = useMotionValue(0);

  // Transform opacity based on swipe distance
  const leftOpacity = useTransform(x, [-swipeThreshold, 0], [1, 0]);
  const rightOpacity = useTransform(x, [0, swipeThreshold], [0, 1]);

  // Transform scale for feedback
  const scale = useTransform(x, [-swipeThreshold, 0, swipeThreshold], [1.05, 1, 1.05]);

  const handleDragStart = () => {
    setIsSwipeActive(true);
  };

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsSwipeActive(false);
    const offset = info.offset.x;
    const velocity = info.velocity.x;

    // Determine if swipe threshold was met
    if (Math.abs(offset) > swipeThreshold || Math.abs(velocity) > 500) {
      if (offset > 0 && onSwipeRight) {
        onSwipeRight();
      } else if (offset < 0 && onSwipeLeft) {
        onSwipeLeft();
      }
    }

    // Reset position
    x.set(0);
  };

  const handleTap = () => {
    if (!isSwipeActive && onTap) {
      onTap();
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* Left action background */}
      {leftAction && (
        <motion.div
          className={`absolute inset-y-0 left-0 flex items-center justify-start pl-4 ${leftAction.color}`}
          style={{ opacity: leftOpacity }}
        >
          <div className="flex items-center gap-2 text-white">
            {leftAction.icon}
            <span className="text-sm font-medium">{leftAction.label}</span>
          </div>
        </motion.div>
      )}

      {/* Right action background */}
      {rightAction && (
        <motion.div
          className={`absolute inset-y-0 right-0 flex items-center justify-end pr-4 ${rightAction.color}`}
          style={{ opacity: rightOpacity }}
        >
          <div className="flex items-center gap-2 text-white">
            <span className="text-sm font-medium">{rightAction.label}</span>
            {rightAction.icon}
          </div>
        </motion.div>
      )}

      {/* Main card */}
      <motion.div
        className={`relative bg-base-100 ${className}`}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        style={{ x, scale }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onTap={handleTap}
        whileTap={{ scale: 0.98 }}
        transition={springConfig.gentle}
      >
        {children}
      </motion.div>
    </div>
  );
}

// Specialized swipe card for timeline messages
interface SwipeableTimelineMessageProps {
  children: React.ReactNode;
  onDelete?: () => void;
  onReply?: () => void;
  onBookmark?: () => void;
  className?: string;
}

/** @public */
export function SwipeableTimelineMessage({
  children,
  onDelete,
  onReply,
  onBookmark,
  className = '',
}: SwipeableTimelineMessageProps) {
  return (
    <SwipeableCard
      className={className}
      onSwipeLeft={onDelete}
      onSwipeRight={onReply}
      leftAction={
        onDelete
          ? {
              icon: <span>🗑️</span>,
              color: 'bg-red-500',
              label: 'Delete',
            }
          : undefined
      }
      rightAction={
        onReply
          ? {
              icon: <span>↩️</span>,
              color: 'bg-blue-500',
              label: 'Reply',
            }
          : undefined
      }
      onTap={onBookmark}
    >
      {children}
    </SwipeableCard>
  );
}

// Pull to refresh component
interface PullToRefreshProps {
  children: React.ReactNode;
  onRefresh?: () => Promise<void>;
  threshold?: number;
  className?: string;
}

/** @public */
export function PullToRefresh({
  children,
  onRefresh,
  threshold = 80,
  className = '',
}: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, threshold], [0, 1]);
  const rotate = useTransform(y, [0, threshold], [0, 180]);

  const handleDragEnd = async (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const offset = info.offset.y;

    if (offset > threshold && onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }

    y.set(0);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Pull indicator */}
      <motion.div
        className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full p-4"
        style={{ opacity }}
      >
        <motion.div
          className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
          style={{ rotate }}
          animate={isRefreshing ? { rotate: 360 } : undefined}
          transition={
            isRefreshing
              ? {
                  duration: 1,
                  repeat: Infinity,
                  ease: 'linear',
                }
              : springConfig.gentle
          }
        />
      </motion.div>

      {/* Content */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        style={{ y }}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </div>
  );
}

// Floating action button with gestures
interface FloatingActionButtonProps {
  icon: React.ReactNode;
  onClick?: () => void;
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/** @public */
export function FloatingActionButton({
  icon,
  onClick,
  position = 'bottom-right',
  className = '',
  size = 'md',
}: FloatingActionButtonProps) {
  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-14 h-14',
    lg: 'w-16 h-16',
  };

  const positionClasses = {
    'bottom-right': 'bottom-6 right-6',
    'bottom-left': 'bottom-6 left-6',
    'bottom-center': 'bottom-6 left-1/2 transform -translate-x-1/2',
  };

  return (
    <motion.button
      className={`
        fixed ${positionClasses[position]} ${sizeClasses[size]}
        bg-primary text-primary-content rounded-full shadow-lg z-50
        flex items-center justify-center ${className}
      `}
      onClick={onClick}
      whileHover={{
        scale: 1.1,
        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.3)',
        transition: springConfig.snappy,
      }}
      whileTap={{
        scale: 0.9,
        transition: { duration: 0.1 },
      }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ delay: 0.5, ...springConfig.bouncy }}
      drag
      dragConstraints={{ left: -50, right: 50, top: -50, bottom: 50 }}
      dragElastic={0.3}
      whileDrag={{ scale: 1.2 }}
    >
      {icon}
    </motion.button>
  );
}

// Long press component
interface LongPressProps {
  children: React.ReactNode;
  onLongPress?: () => void;
  duration?: number;
  className?: string;
}

/** @public */
export function LongPress({
  children,
  onLongPress,
  duration = 500,
  className = '',
}: LongPressProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const handlePressStart = () => {
    setIsPressed(true);
    if (onLongPress) {
      const id = setTimeout(() => {
        onLongPress();
      }, duration);
      setTimeoutId(id);
    }
  };

  const handlePressEnd = () => {
    setIsPressed(false);
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
  };

  return (
    <motion.div
      className={className}
      onPointerDown={handlePressStart}
      onPointerUp={handlePressEnd}
      onPointerLeave={handlePressEnd}
      whileTap={{ scale: 0.95 }}
      animate={isPressed ? { scale: 1.05 } : { scale: 1 }}
      transition={springConfig.gentle}
    >
      {children}
    </motion.div>
  );
}
