// ABOUTME: Animated carousel component with smooth transitions, drag support, and responsive design
// ABOUTME: Supports auto-scroll, navigation arrows, dot indicators, and multiple items per view

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import {
  springConfig,
  buttonTap,
  hoverLift,
  fadeInUp,
  staggerContainer,
  staggerItem,
} from '~/interfaces/web/lib/animations';

interface AnimatedCarouselProps {
  children: React.ReactNode[];
  className?: string;
  showNavigation?: boolean;
  showDots?: boolean;
  autoScroll?: boolean;
  scrollInterval?: number;
  itemsPerView?: {
    mobile: number;
    tablet: number;
    desktop: number;
  };
}

export function AnimatedCarousel({
  children,
  className = '',
  showNavigation = true,
  showDots = true,
  autoScroll = false,
  scrollInterval = 5000,
  itemsPerView = { mobile: 1, tablet: 2, desktop: 3 },
}: AnimatedCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [currentItemsPerView, setCurrentItemsPerView] = useState(itemsPerView.desktop);
  const [dragConstraints, setDragConstraints] = useState({ left: 0, right: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalItems = children.length;
  const totalPages = Math.ceil(totalItems / currentItemsPerView);
  const maxIndex = Math.max(0, totalPages - 1);

  // Handle responsive items per view
  useEffect(() => {
    const updateItemsPerView = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setCurrentItemsPerView(itemsPerView.mobile);
      } else if (width < 1024) {
        setCurrentItemsPerView(itemsPerView.tablet);
      } else {
        setCurrentItemsPerView(itemsPerView.desktop);
      }
    };

    updateItemsPerView();
    window.addEventListener('resize', updateItemsPerView);
    return () => window.removeEventListener('resize', updateItemsPerView);
  }, [itemsPerView]);

  // Update drag constraints
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const totalWidth = containerWidth * totalPages;
      setDragConstraints({
        left: -(totalWidth - containerWidth),
        right: 0,
      });
    }
  }, [totalPages, currentItemsPerView]);

  // Auto-scroll functionality
  useEffect(() => {
    if (!autoScroll || isUserInteracting || totalPages <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % totalPages);
    }, scrollInterval);

    return () => clearInterval(interval);
  }, [autoScroll, isUserInteracting, totalPages, scrollInterval]);

  // Scroll to current page
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current;
      const containerWidth = scrollContainer.offsetWidth;
      scrollContainer.scrollTo({
        left: currentIndex * containerWidth,
        behavior: 'smooth',
      });
    }
  }, [currentIndex]);

  const goToNext = () => {
    setIsUserInteracting(true);
    setCurrentIndex((prev) => Math.min(prev + 1, maxIndex));
    setTimeout(() => setIsUserInteracting(false), 3000);
  };

  const goToPrevious = () => {
    setIsUserInteracting(true);
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
    setTimeout(() => setIsUserInteracting(false), 3000);
  };

  const goToIndex = (index: number) => {
    setIsUserInteracting(true);
    setCurrentIndex(index);
    setTimeout(() => setIsUserInteracting(false), 3000);
  };

  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 50;
    const velocity = info.velocity.x;
    const offset = info.offset.x;

    // Determine direction based on offset and velocity
    if (Math.abs(offset) > threshold || Math.abs(velocity) > 500) {
      if (offset > 0 || velocity > 0) {
        goToPrevious();
      } else {
        goToNext();
      }
    }
  };

  if (totalItems === 0) return null;

  // Group children into pages
  const pages = [];
  for (let i = 0; i < totalItems; i += currentItemsPerView) {
    pages.push(children.slice(i, i + currentItemsPerView));
  }

  return (
    <motion.div
      className={`relative group ${className}`}
      role="region"
      aria-label="Content carousel"
      variants={fadeInUp}
      initial="initial"
      animate="animate"
    >
      {/* Main carousel container */}
      <div className="overflow-hidden" ref={containerRef}>
        <motion.div
          ref={scrollRef}
          className="flex hide-scrollbar"
          drag="x"
          dragConstraints={dragConstraints}
          dragElastic={0.1}
          onDragEnd={handleDragEnd}
          animate={{
            x: -currentIndex * 100 + '%',
          }}
          transition={springConfig.smooth}
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {pages.map((pageItems, pageIndex) => (
            <motion.div
              key={pageIndex}
              className="w-full flex-shrink-0 flex gap-4"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: {
                  delay: pageIndex * 0.1,
                  ...springConfig.gentle,
                },
              }}
            >
              <motion.div
                className="flex gap-4 w-full"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                {pageItems.map((child, itemIndex) => (
                  <motion.div
                    key={itemIndex}
                    className="flex-1"
                    style={{ minWidth: 0 }}
                    variants={staggerItem}
                    whileHover={{
                      y: -4,
                      transition: springConfig.snappy,
                    }}
                  >
                    {child}
                  </motion.div>
                ))}
                {/* Fill empty slots on last page */}
                {pageItems.length < currentItemsPerView &&
                  Array.from({ length: currentItemsPerView - pageItems.length }).map(
                    (_, emptyIndex) => <div key={`empty-${emptyIndex}`} className="flex-1" />
                  )}
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Navigation arrows */}
      <AnimatePresence>
        {showNavigation && totalPages > 1 && (
          <>
            <motion.button
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-base-100/90 hover:bg-base-100 border border-base-300 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 disabled:opacity-25 backdrop-blur-sm"
              aria-label="Previous page"
              disabled={currentIndex === 0}
              {...buttonTap}
              whileHover={{
                scale: 1.1,
                boxShadow: '0 8px 25px -8px rgba(0,0,0,0.2)',
                transition: springConfig.snappy,
              }}
            >
              <ChevronLeftIcon className="w-5 h-5 text-base-content" />
            </motion.button>

            <motion.button
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              onClick={goToNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-base-100/90 hover:bg-base-100 border border-base-300 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 disabled:opacity-25 backdrop-blur-sm"
              aria-label="Next page"
              disabled={currentIndex >= maxIndex}
              {...buttonTap}
              whileHover={{
                scale: 1.1,
                boxShadow: '0 8px 25px -8px rgba(0,0,0,0.2)',
                transition: springConfig.snappy,
              }}
            >
              <ChevronRightIcon className="w-5 h-5 text-base-content" />
            </motion.button>
          </>
        )}
      </AnimatePresence>

      {/* Dots navigation */}
      <AnimatePresence>
        {showDots && totalPages > 1 && (
          <motion.div
            className="flex justify-center mt-4 gap-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ delay: 0.2, ...springConfig.gentle }}
          >
            {Array.from({ length: totalPages }, (_, index) => (
              <motion.button
                key={index}
                onClick={() => goToIndex(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentIndex
                    ? 'bg-primary w-6'
                    : 'bg-base-content/30 hover:bg-base-content/50 w-2'
                }`}
                aria-label={`Go to page ${index + 1}`}
                initial={{ scale: 0 }}
                animate={{
                  scale: 1,
                  transition: {
                    delay: index * 0.05,
                    ...springConfig.bouncy,
                  },
                }}
                whileHover={{
                  scale: 1.2,
                  transition: springConfig.snappy,
                }}
                {...buttonTap}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress indicator */}
      <motion.div
        className="absolute bottom-0 left-0 h-1 bg-primary/20 w-full"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <motion.div
          className="h-full bg-primary origin-left"
          animate={{
            scaleX: (currentIndex + 1) / totalPages,
          }}
          transition={springConfig.smooth}
        />
      </motion.div>

      {/* Screen reader info */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Page {currentIndex + 1} of {totalPages}
      </div>
    </motion.div>
  );
}