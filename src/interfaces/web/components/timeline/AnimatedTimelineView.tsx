// ABOUTME: Main animated timeline view component with smooth scrolling and staggered message animations
// ABOUTME: Handles auto-scroll to bottom, scroll-to-bottom button, and sophisticated entry/exit animations

'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { TimelineEntry } from '~/interfaces/web/types';
import { AnimatedTimelineMessage } from './AnimatedTimelineMessage';
import { AnimatedTypingIndicator } from './AnimatedTypingIndicator';
import { staggerContainer, fadeInUp, springConfig } from '~/interfaces/web/lib/animations';

interface AnimatedTimelineViewProps {
  entries: TimelineEntry[];
  isTyping: boolean;
  currentAgent: string;
}

export function AnimatedTimelineView({ entries, isTyping, currentAgent }: AnimatedTimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const isInViewport = useInView(messagesRef, { margin: "0px 0px -100px 0px" });

  // Smooth scroll to bottom when new messages arrive
  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const isScrolledToBottom = 
        container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
      
      if (isScrolledToBottom) {
        // Smooth scroll animation
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [entries, isTyping]);

  return (
    <div 
      ref={containerRef} 
      className="flex-1 overflow-y-auto overscroll-contain"
      style={{ 
        scrollBehavior: 'smooth',
        // Add momentum scrolling for iOS
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <motion.div 
        ref={messagesRef}
        className="p-4 pb-32"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <AnimatePresence mode="sync">
          <motion.div className="space-y-4">
            {entries.map((entry, index) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ 
                  opacity: 1, 
                  y: 0, 
                  scale: 1,
                  transition: {
                    delay: Math.min(index * 0.05, 0.5), // Cap delay for performance
                    ...springConfig.gentle
                  }
                }}
                exit={{ 
                  opacity: 0, 
                  scale: 0.95,
                  y: -10,
                  transition: { duration: 0.2 }
                }}
                className="timeline-entry"
              >
                <AnimatedTimelineMessage entry={entry} index={index} />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>

        {/* Typing indicator with fade animation */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ 
                opacity: 1, 
                y: 0, 
                scale: 1,
                transition: springConfig.gentle
              }}
              exit={{ 
                opacity: 0, 
                y: -10,
                scale: 0.9,
                transition: { duration: 0.2 }
              }}
              layout
            >
              <AnimatedTypingIndicator agent={currentAgent} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scroll to bottom button */}
        <AnimatePresence>
          {!isInViewport && entries.length > 3 && (
            <motion.button
              initial={{ opacity: 0, scale: 0 }}
              animate={{ 
                opacity: 1, 
                scale: 1,
                transition: springConfig.bouncy
              }}
              exit={{ 
                opacity: 0, 
                scale: 0,
                transition: { duration: 0.2 }
              }}
              className="fixed bottom-20 right-4 z-10 w-12 h-12 bg-primary text-primary-content rounded-full shadow-lg flex items-center justify-center"
              onClick={() => {
                if (containerRef.current) {
                  containerRef.current.scrollTo({
                    top: containerRef.current.scrollHeight,
                    behavior: 'smooth'
                  });
                }
              }}
              whileHover={{ 
                scale: 1.1,
                boxShadow: "0 10px 30px -10px rgba(0,0,0,0.3)",
                transition: springConfig.snappy
              }}
              whileTap={{ scale: 0.95 }}
            >
              <svg 
                className="w-5 h-5" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <motion.path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}