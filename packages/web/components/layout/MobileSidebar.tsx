// ABOUTME: Composable Mobile Sidebar component with flexible content composition
// ABOUTME: Provides mobile-optimized overlay layout while allowing custom content

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faCog } from '@/lib/fontawesome';

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsClick?: () => void;
  children: React.ReactNode;
}

export function MobileSidebar({ isOpen, onClose, onSettingsClick, children }: MobileSidebarProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <motion.div
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed left-0 top-0 h-full w-80 bg-base-100 z-50 lg:hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-base-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-teal-600 to-teal-700 rounded-lg flex items-center justify-center shadow-lg overflow-hidden relative">
                <div className="absolute inset-0 opacity-20">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px), repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 4px)`,
                    }}
                  ></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white/30 rounded transform rotate-45"></div>
                  <div className="absolute w-3 h-3 border border-white/20 rounded transform rotate-45"></div>
                </div>
              </div>
              <span className="font-semibold text-base-content">Lace</span>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="p-2 hover:bg-base-200 rounded-lg transition-colors"
              >
                <FontAwesomeIcon icon={faTimes} className="w-5 h-5 text-base-content/60" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-base-300">
          <button
            onClick={onSettingsClick}
            className="btn btn-ghost w-full justify-start"
            title="Settings"
          >
            <FontAwesomeIcon icon={faCog} className="w-4 h-4 mr-2" />
            Settings
          </button>
        </div>
      </motion.div>
    </>
  );
}