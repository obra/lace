'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '~/lib/fontawesome';

interface CarouselProps {
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

export function Carousel({
  children,
  className = '',
  showNavigation = true,
  showDots = true,
  autoScroll = false,
  scrollInterval = 5000,
  itemsPerView = { mobile: 1, tablet: 2, desktop: 3 },
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [currentItemsPerView, setCurrentItemsPerView] = useState(itemsPerView.desktop);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

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

  // Touch handlers for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const swipeThreshold = 50;
    const swipeDistance = touchStartX.current - touchEndX.current;

    if (Math.abs(swipeDistance) > swipeThreshold) {
      if (swipeDistance > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToPrevious();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToNext();
    }
  };

  if (totalItems === 0) return null;

  // Group children into pages
  const pages = [];
  for (let i = 0; i < totalItems; i += currentItemsPerView) {
    pages.push(children.slice(i, i + currentItemsPerView));
  }

  return (
    <div 
      className={`relative group ${className}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Content carousel"
    >
      {/* Main carousel container */}
      <div className="overflow-hidden">
        <div
          ref={scrollRef}
          className="flex overflow-x-auto scroll-smooth snap-x snap-mandatory hide-scrollbar"
          style={{ 
            scrollbarWidth: 'none', 
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {pages.map((pageItems, pageIndex) => (
            <div
              key={pageIndex}
              className="w-full flex-shrink-0 snap-start flex gap-4"
              aria-hidden={pageIndex !== currentIndex}
            >
              {pageItems.map((child, itemIndex) => (
                <div
                  key={itemIndex}
                  className="flex-1"
                  style={{
                    minWidth: 0, // Prevent flex items from overflowing
                  }}
                >
                  {child}
                </div>
              ))}
              {/* Fill empty slots on last page */}
              {pageItems.length < currentItemsPerView && Array.from({ length: currentItemsPerView - pageItems.length }).map((_, emptyIndex) => (
                <div key={`empty-${emptyIndex}`} className="flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>


      {/* Navigation arrows */}
      {showNavigation && totalPages > 1 && (
        <>
          <button
            onClick={goToPrevious}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-base-100/80 hover:bg-base-100 border border-base-300 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 disabled:opacity-25"
            aria-label="Previous page"
            disabled={currentIndex === 0}
          >
            <FontAwesomeIcon icon={faChevronLeft} className="w-4 h-4 text-base-content" />
          </button>

          <button
            onClick={goToNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-base-100/80 hover:bg-base-100 border border-base-300 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 disabled:opacity-25"
            aria-label="Next page"
            disabled={currentIndex >= maxIndex}
          >
            <FontAwesomeIcon icon={faChevronRight} className="w-4 h-4 text-base-content" />
          </button>
        </>
      )}

      {/* Dots navigation */}
      {showDots && totalPages > 1 && (
        <div className="flex justify-center mt-3 gap-2">
          {Array.from({ length: totalPages }, (_, index) => (
            <button
              key={index}
              onClick={() => goToIndex(index)}
              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                index === currentIndex
                  ? 'bg-primary scale-125'
                  : 'bg-base-content/30 hover:bg-base-content/50'
              }`}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Screen reader info */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Page {currentIndex + 1} of {totalPages}
      </div>
    </div>
  );
}