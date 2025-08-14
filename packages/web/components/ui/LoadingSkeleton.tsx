'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { shimmer, springConfig, staggerContainer, staggerItem } from '@/lib/animations';

interface LoadingSkeletonProps {
  variant?: 'text' | 'card' | 'avatar' | 'timeline' | 'carousel';
  count?: number;
  className?: string;
}

export function LoadingSkeleton({
  variant = 'text',
  count = 1,
  className = '',
}: LoadingSkeletonProps) {
  const renderTextSkeleton = () => (
    <motion.div
      className={`bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded ${className}`}
      style={{ backgroundSize: '200% 100%' }}
      variants={shimmer}
      animate="animate"
    >
      <div className="h-4 w-full" />
    </motion.div>
  );

  const renderCardSkeleton = () => (
    <motion.div
      className={`bg-base-100 border border-base-300 rounded-lg p-4 space-y-3 ${className}`}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <motion.div
        className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-6 w-3/4"
        variants={shimmer}
        animate="animate"
      />
      <motion.div
        className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-full"
        variants={shimmer}
        animate="animate"
      />
      <motion.div
        className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-2/3"
        variants={shimmer}
        animate="animate"
      />
    </motion.div>
  );

  const renderAvatarSkeleton = () => (
    <motion.div
      className={`flex items-center gap-3 ${className}`}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <motion.div
        className="w-8 h-8 bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded-md"
        variants={shimmer}
        animate="animate"
      />
      <div className="space-y-2 flex-1">
        <motion.div
          className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-1/3"
          variants={shimmer}
          animate="animate"
        />
        <motion.div
          className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-3 w-2/3"
          variants={shimmer}
          animate="animate"
        />
      </div>
    </motion.div>
  );

  const renderTimelineSkeleton = () => (
    <motion.div
      className={`space-y-4 ${className}`}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <motion.div key={index} className="flex gap-3" variants={staggerItem}>
          <motion.div
            className="w-8 h-8 bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded-md flex-shrink-0"
            variants={shimmer}
            animate="animate"
          />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <motion.div
                className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-20"
                variants={shimmer}
                animate="animate"
              />
              <motion.div
                className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-3 w-16"
                variants={shimmer}
                animate="animate"
              />
            </div>
            <motion.div
              className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-full"
              variants={shimmer}
              animate="animate"
            />
            <motion.div
              className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-3/4"
              variants={shimmer}
              animate="animate"
            />
          </div>
        </motion.div>
      ))}
    </motion.div>
  );

  const renderCarouselSkeleton = () => (
    <motion.div
      className={`space-y-4 ${className}`}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      <motion.div
        className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-6 w-1/3"
        variants={shimmer}
        animate="animate"
      />
      <div className="flex gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <motion.div
            key={index}
            className="flex-1 bg-base-100 border border-base-300 rounded-lg p-4 space-y-3"
            variants={staggerItem}
          >
            <motion.div
              className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-5 w-3/4"
              variants={shimmer}
              animate="animate"
            />
            <motion.div
              className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-full"
              variants={shimmer}
              animate="animate"
            />
            <motion.div
              className="bg-gradient-to-r from-base-300 via-base-200 to-base-300 bg-[length:200%_100%] rounded h-4 w-2/3"
              variants={shimmer}
              animate="animate"
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );

  const renderSkeleton = () => {
    switch (variant) {
      case 'text':
        return renderTextSkeleton();
      case 'card':
        return renderCardSkeleton();
      case 'avatar':
        return renderAvatarSkeleton();
      case 'timeline':
        return renderTimelineSkeleton();
      case 'carousel':
        return renderCarouselSkeleton();
      default:
        return renderTextSkeleton();
    }
  };

  if (count === 1) {
    return renderSkeleton();
  }

  return (
    <motion.div
      className="space-y-4"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {Array.from({ length: count }).map((_, index) => (
        <motion.div key={index} variants={staggerItem}>
          {renderSkeleton()}
        </motion.div>
      ))}
    </motion.div>
  );
}

// Specialized skeleton components
export function ChatMessageSkeleton() {
  return <LoadingSkeleton variant="avatar" />;
}

export function TimelineSkeleton() {
  return <LoadingSkeleton variant="timeline" />;
}

export function CarouselSkeleton() {
  return <LoadingSkeleton variant="carousel" />;
}

export function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return <LoadingSkeleton variant="card" count={count} />;
}
