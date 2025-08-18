'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@/lib/fontawesome';
import { loadingDots, loadingDot, springConfig, fadeInUp } from '@/lib/animations';

interface AnimatedTypingIndicatorProps {
  agent: string;
}

export function AnimatedTypingIndicator({ agent }: AnimatedTypingIndicatorProps) {
  const getAgentStyles = (agentName: string) => {
    switch (agentName) {
      case 'Claude':
        return {
          dotClass: 'bg-[rgb(var(--agent-claude))]',
          avatarClass: 'bg-[rgb(var(--agent-claude))] text-white',
        };
      case 'GPT-4':
        return {
          dotClass: 'bg-[rgb(var(--agent-gpt4))]',
          avatarClass: 'bg-[rgb(var(--agent-gpt4))] text-white',
        };
      case 'Gemini':
        return {
          dotClass: 'bg-[rgb(var(--agent-gemini))]',
          avatarClass: 'bg-[rgb(var(--agent-gemini))] text-white',
        };
      default:
        return {
          dotClass: 'bg-neutral',
          avatarClass: 'bg-neutral text-neutral-content',
        };
    }
  };

  const { dotClass, avatarClass } = getAgentStyles(agent);
  
  const getAgentShadowColor = (agentName: string) => {
    switch (agentName) {
      case 'Claude':
        return 'rgba(var(--agent-claude), 0.4)';
      case 'GPT-4':
        return 'rgba(var(--agent-gpt4), 0.4)';
      case 'Gemini':
        return 'rgba(var(--agent-gemini), 0.4)';
      default:
        return 'rgba(156, 163, 175, 0.4)';
    }
  };

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
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${avatarClass}`}
          animate={{
            boxShadow: [
              `0 0 0 0 ${getAgentShadowColor(agent)}`,
              `0 0 0 10px ${getAgentShadowColor(agent).replace('0.4', '0.1')}`,
              `0 0 0 0 ${getAgentShadowColor(agent)}`,
            ],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
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
          boxShadow: '0 8px 25px -8px rgba(0,0,0,0.1)',
          transition: springConfig.snappy,
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
              className={`w-2 h-2 rounded-full ${dotClass}`}
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
                ease: 'easeInOut',
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
              ease: 'easeInOut',
            }}
          >
            {agent} is thinking...
          </motion.span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
