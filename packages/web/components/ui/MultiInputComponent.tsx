'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';

interface MultiInputComponentProps {
  className?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

// Management theory and workplace platitudes
const MANAGEMENT_CONTENT = [
  // Introduction
  '💼 Management Wisdom',
  'Timeless leadership insights',
  'Loading workplace excellence...',

  // Core Management Principles
  'Synergize cross-functional',
  'deliverables for maximum',
  'stakeholder value creation',

  'Leverage best practices',
  'to drive innovation',
  'and operational excellence',

  'Think outside the box',
  'while maintaining core',
  'competencies and alignment',

  'Circle back on key',
  'action items to ensure',
  'seamless execution',

  '🎯 Strategic Focus',
  'Optimize low-hanging fruit',
  'through agile methodologies',
  'and data-driven insights',

  'Deep dive into',
  'scalable solutions that',
  'move the needle',

  'Pivot toward sustainable',
  'growth opportunities',
  'in our target markets',

  '⚡ Innovation Mindset',
  'Disrupt traditional workflows',
  'with cutting-edge paradigms',
  'and blue-sky thinking',

  'Ideate revolutionary',
  'customer experiences',
  'through design thinking',

  'Embrace fail-fast mentality',
  'to iterate toward',
  'breakthrough solutions',

  '📊 Data-Driven Leadership',
  'Monetize actionable insights',
  'from big data analytics',
  'and machine learning',

  'Optimize conversion funnels',
  'through A/B testing',
  'and user journey mapping',

  'Scale robust infrastructure',
  'for enterprise-grade',
  'digital transformation',

  '🤝 Team Empowerment',
  'Empower high-performing',
  'teams to exceed',
  'quarterly expectations',

  'Foster collaborative',
  'environments that unlock',
  'untapped potential',

  'Develop talent pipelines',
  'through mentorship',
  'and skill diversification',

  '🚀 Future-Ready Organization',
  'Cultivate organizational',
  'resilience through',
  'adaptive leadership',

  'Build sustainable',
  'competitive advantages',
  'in dynamic markets',

  'Drive continuous improvement',
  'across all business',
  'verticals and touchpoints',

  '💡 Innovation Pipeline',
  'Establish centers of',
  'excellence for rapid',
  'prototyping and deployment',

  'Harness collective',
  'intelligence to accelerate',
  'time-to-market delivery',

  'Transform organizational',
  'DNA through cultural',
  'change management',

  '📈 Performance Optimization',
  'Maximize ROI through',
  'strategic resource',
  'allocation and planning',

  'End of wisdom cycle...',
  'Reloading insights...',
];

export default function MultiInputComponent({
  className = '',
  placeholder = 'Enter your message...',
  value = '',
  onChange,
  onSubmit,
}: MultiInputComponentProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  const getCurrentText = useCallback(() => {
    if (isPaused) return '⏸ Wisdom paused';
    return MANAGEMENT_CONTENT[currentIndex] || MANAGEMENT_CONTENT[0];
  }, [currentIndex, isPaused]);

  const togglePause = () => {
    setIsPaused((prev) => !prev);
  };

  const increaseSpeed = () => {
    setSpeedMultiplier((prev) => Math.min(prev + 0.25, 3));
  };

  const decreaseSpeed = () => {
    setSpeedMultiplier((prev) => Math.max(prev - 0.25, 0.25));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange?.(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.(inputValue);
    }
  };

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      setIsTransitioning(true);

      setTimeout(() => {
        setCurrentIndex((prev) => {
          const nextIndex = prev + 1;
          return nextIndex >= MANAGEMENT_CONTENT.length ? 0 : nextIndex;
        });
        setIsTransitioning(false);
      }, 120);
    }, 900 / speedMultiplier);

    return () => clearInterval(interval);
  }, [speedMultiplier, isPaused]);

  return (
    <div className={`w-full max-w-2xl mx-auto ${className}`}>
      {/* Management Wisdom Display */}
      <div className="group relative">
        <div
          className="
            flex items-center justify-between
            bg-gradient-to-r from-indigo-50 to-purple-50 
            border border-indigo-200/50
            rounded-2xl
            h-16 px-6
            font-sans
            text-slate-700
            shadow-sm
            mb-4
            cursor-pointer
          "
          onClick={togglePause}
        >
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <div className="flex items-center">
              <div
                className={`w-2 h-2 bg-indigo-500 rounded-full ${isPaused ? '' : 'animate-pulse'}`}
              ></div>
              <div className="w-0.5 h-6 bg-indigo-400/40 mx-2"></div>
            </div>
            <span
              className={`
                font-medium text-left flex-1 text-base
                transition-all duration-120 ease-in-out
                ${isTransitioning ? 'opacity-35 scale-95' : 'opacity-100 scale-100'}
                ${isPaused ? 'text-slate-500 italic' : ''}
              `}
            >
              {getCurrentText()}
            </span>
          </div>

          <div className="flex flex-col items-center ml-3 -space-y-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={(e) => {
                e.stopPropagation();
                increaseSpeed();
              }}
              className="text-indigo-500 hover:text-indigo-600 transition-colors p-0"
              title={`Speed up (${speedMultiplier.toFixed(2)}x)`}
            >
              <FontAwesomeIcon icon={faChevronUp} className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                decreaseSpeed();
              }}
              className="text-indigo-500 hover:text-indigo-600 transition-colors p-0"
              title={`Slow down (${speedMultiplier.toFixed(2)}x)`}
            >
              <FontAwesomeIcon icon={faChevronDown} className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="relative">
        <textarea
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="
            w-full
            min-h-24
            p-4
            border border-slate-200
            rounded-xl
            font-sans
            text-slate-700
            placeholder-slate-400
            resize-none
            focus:outline-none
            focus:ring-2
            focus:ring-indigo-500/20
            focus:border-indigo-500/50
            transition-all
            duration-200
          "
          rows={3}
        />
        <div className="absolute bottom-3 right-3 text-xs text-slate-400">
          Press Enter to submit, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
