// ABOUTME: Composable Mobile Sidebar component with flexible content composition
// ABOUTME: Provides mobile-optimized overlay layout while allowing custom content

'use client';

import React from 'react';
import Link from 'next/link';
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
            <div className="flex-1 gap-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-emerald-300 to-cyan-800 text-xs text-neutral-200">✦</span>
                <span className="text-lg">Lace</span>
              </Link>
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