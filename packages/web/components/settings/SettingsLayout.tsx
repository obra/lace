// ABOUTME: Layout wrapper for full-page settings providing common structure
// ABOUTME: Includes header, navigation tabs, and content area for all settings pages

'use client';

import React from 'react';
import { useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@/lib/fontawesome';
import { SettingsNavigation } from './SettingsNavigation';

interface SettingsLayoutProps {
  children: React.ReactNode;
  activeTab: 'providers' | 'mcp' | 'ui' | 'user';
}

export function SettingsLayout({ children, activeTab }: SettingsLayoutProps) {
  const navigate = useNavigate();

  const handleClose = () => {
    // Navigate back to the previous page, or to home if no history
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-base-100">
      {/* Settings Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-base-300">
        <h1 className="text-2xl font-semibold text-base-content">Settings</h1>
        <button
          onClick={handleClose}
          className="btn btn-ghost btn-sm btn-circle"
          aria-label="Close settings"
        >
          <FontAwesomeIcon icon={faTimes} className="w-5 h-5" />
        </button>
      </div>

      {/* Tab Navigation */}
      <SettingsNavigation activeTab={activeTab} />

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">{children}</div>
      </div>
    </div>
  );
}
