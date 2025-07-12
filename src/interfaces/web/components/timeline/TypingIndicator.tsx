// ABOUTME: Animated typing indicator component for showing when AI agents are thinking
// ABOUTME: Uses Framer Motion for smooth animations and agent-specific colors

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '~/interfaces/web/lib/fontawesome';
import { loadingDots, loadingDot, springConfig, fadeInUp } from '~/interfaces/web/lib/animations';

interface TypingIndicatorProps {
  agent: string;
}

export function TypingIndicator({ agent }: TypingIndicatorProps) {
  const agentColors = {
    Claude: 'bg-orange-500',
    'GPT-4': 'bg-green-600',
    Gemini: 'bg-blue-600',
  };

  const agentColorClasses = {
    Claude: 'bg-orange-500 text-white',
    'GPT-4': 'bg-green-600 text-white',
    Gemini: 'bg-blue-600 text-white',
  };

  const dotColor = agentColors[agent as keyof typeof agentColors] || 'bg-gray-600';
  const avatarColor = agentColorClasses[agent as keyof typeof agentColorClasses] || 'bg-gray-600 text-white';

  return (
    <motion.div 
      className="flex gap-3 lg:gap-4"
      variants={fadeInUp}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div 
        className="flex-shrink-0"
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.1, ...springConfig.bouncy }}
      >
        <motion.div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${avatarColor}`}
          animate={{
            boxShadow: [
              `0 0 0 0 ${agentColors[agent as keyof typeof agentColors] || 'rgba(156, 163, 175, 0.7)'}40`,
              `0 0 0 10px ${agentColors[agent as keyof typeof agentColors] || 'rgba(156, 163, 175, 0.7)'}10`,
              `0 0 0 0 ${agentColors[agent as keyof typeof agentColors] || 'rgba(156, 163, 175, 0.7)'}40`,
            ],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <FontAwesomeIcon icon={faRobot} className="text-xs" />
        </motion.div>
      </motion.div>
      
      <motion.div 
        className="bg-base-100 border border-base-300 rounded-2xl px-4 py-3 shadow-sm"
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.2, ...springConfig.gentle }}
        whileHover={{ 
          scale: 1.02,
          boxShadow: "0 8px 25px -8px rgba(0,0,0,0.1)",
          transition: springConfig.snappy
        }}
      >
        <motion.div 
          className="flex gap-1.5 items-center"
          variants={loadingDots}
          initial="initial"
          animate="animate"
        >
          {[0, 1, 2].map((index) => (
            <motion.div
              key={index}
              className={`w-2 h-2 rounded-full ${dotColor}`}
              variants={loadingDot}
              custom={index}
              animate={{
                scale: [1, 1.3, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: index * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
          
          {/* Subtle text hint */}
          <motion.span
            className="text-xs text-base-content/40 ml-2"
            animate={{
              opacity: [0.4, 0.8, 0.4],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            {agent} is thinking...
          </motion.span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}