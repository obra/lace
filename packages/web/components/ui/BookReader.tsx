'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';

interface BookReaderProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

// Pride and Prejudice reading experience with book structure
const BOOK_CONTENT = [
  // Introduction
  '📖 Pride and Prejudice',
  'by Jane Austen',
  'Starting from beginning...',

  // Chapter 1 opening
  'Chapter 1',
  'It is a truth',
  'universally acknowledged,',
  'that a single man',
  'in possession of',
  'a good fortune',
  'must be in want',
  'of a wife.',

  'However little known',
  'the feelings or views',
  'of such a man',
  'may be on his',
  'first entering',
  'a neighbourhood,',

  'this truth is',
  'so well fixed',
  'in the minds of',
  'the surrounding families,',
  'that he is considered',
  'as the rightful property',
  'of some one or other',
  'of their daughters.',

  // Continuing with key passages
  '"My dear Mr. Bennet,"',
  'said his lady',
  'to him one day,',
  '"have you heard that',
  'Netherfield Park',
  'is let at last?"',

  'Mr. Bennet replied',
  'that he had not.',

  '"But it is,"',
  'returned she;',
  '"for Mrs. Long',
  'has just been here,',
  'and she told me',
  'all about it."',

  // Skip ahead indicator
  '⏩ Continuing story...',

  // Key character moments
  'Elizabeth meets Darcy',
  'First impressions form',
  'Pride and prejudice clash',

  'Chapter 34',
  'The famous proposal',
  '"In vain I have struggled"',
  'Darcy declares his love',
  'Elizabeth rejects him',

  'Chapter 35',
  'The letter arrives',
  'Truth about Wickham',
  'Prejudices crumble',

  '⏩ Story develops...',

  'Chapter 43',
  'Pemberley visit',
  "Seeing Darcy's true nature",
  'Second chances emerge',

  'Final chapters',
  'Love conquers pride',
  'Happiness achieved',
  '"They were both',
  'sensible of the',
  'warmest gratitude"',

  '📚 End of Pride and Prejudice',
  'Returning to beginning...',
];

const sizeConfig = {
  xs: {
    container: 'h-4 w-52 px-2 text-[10px]',
    speed: 800,
  },
  sm: {
    container: 'h-6 w-60 px-3 text-xs',
    speed: 700,
  },
  md: {
    container: 'h-8 w-72 px-4 text-sm',
    speed: 600,
  },
  lg: {
    container: 'h-10 w-80 px-5 text-base',
    speed: 500,
  },
};

export default function BookReader({ size = 'sm', className = '' }: BookReaderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const config = sizeConfig[size];

  const getCurrentText = useCallback(() => {
    if (isPaused) return '⏸ Reading paused';
    return BOOK_CONTENT[currentIndex] || BOOK_CONTENT[0];
  }, [currentIndex, isPaused]);

  const togglePause = () => {
    setIsPaused((prev) => !prev);
  };

  const increaseSpeed = () => {
    setSpeedMultiplier((prev) => Math.min(prev + 0.25, 3)); // Max 3x speed
  };

  const decreaseSpeed = () => {
    setSpeedMultiplier((prev) => Math.max(prev - 0.25, 0.25)); // Min 0.25x speed
  };

  useEffect(() => {
    if (isPaused) return; // Don't set interval when paused

    const interval = setInterval(() => {
      setIsTransitioning(true);

      // After a short fade out, change the text
      setTimeout(() => {
        setCurrentIndex((prev) => {
          const nextIndex = prev + 1;
          // Reset to beginning when we reach the end
          return nextIndex >= BOOK_CONTENT.length ? 0 : nextIndex;
        });
        setIsTransitioning(false);
      }, 100); // Faster transition for Blinkist-style
    }, config.speed / speedMultiplier);

    return () => clearInterval(interval);
  }, [config.speed, speedMultiplier, isPaused]);

  return (
    <div
      className={`
      group
      inline-flex items-center justify-between
      bg-gradient-to-r from-blue-50 to-indigo-50 
      border border-blue-200/50
      rounded-full
      ${config.container}
      font-sans
      text-slate-700
      shadow-sm
      ${className}
    `}
    >
      <div
        className="flex items-center space-x-1.5 flex-1 min-w-0 cursor-pointer"
        onClick={togglePause}
      >
        <div className="flex items-center">
          <div
            className={`w-1.5 h-1.5 bg-blue-500 rounded-full ${isPaused ? '' : 'animate-pulse'}`}
          ></div>
          <div className="w-0.5 h-3 bg-blue-400/40 mx-1"></div>
        </div>
        <span
          className={`
            font-medium text-left flex-1
            transition-all duration-100 ease-in-out
            ${isTransitioning ? 'opacity-35 scale-95' : 'opacity-100 scale-100'}
            ${isPaused ? 'text-slate-500 italic' : ''}
          `}
        >
          {getCurrentText()}
        </span>
      </div>

      <div className="flex flex-col items-center ml-2 -space-y-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={increaseSpeed}
          className="text-blue-500 hover:text-blue-600 transition-colors p-0"
          title={`Speed up (${speedMultiplier.toFixed(2)}x)`}
        >
          <FontAwesomeIcon icon={faChevronUp} className="w-2 h-2" />
        </button>
        <button
          onClick={decreaseSpeed}
          className="text-blue-500 hover:text-blue-600 transition-colors p-0"
          title={`Slow down (${speedMultiplier.toFixed(2)}x)`}
        >
          <FontAwesomeIcon icon={faChevronDown} className="w-2 h-2" />
        </button>
      </div>
    </div>
  );
}
