// ABOUTME: Debugging panel with right-side drawer for monitoring SSE events
// ABOUTME: Shows when debugging is enabled in settings, provides real-time event monitoring

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBug, faXmark, faStream } from '@/lib/fontawesome';
import { useDebuggingSettings } from '@/components/providers/SettingsProvider';
import { EventStreamMonitor } from './EventStreamMonitor';

interface DebugPanelProps {
  children: React.ReactNode;
}

export function DebugPanel({ children }: DebugPanelProps) {
  const { debugPanelEnabled } = useDebuggingSettings();
  const [isOpen, setIsOpen] = useState(false);

  if (!debugPanelEnabled) {
    return <>{children}</>;
  }

  return (
    <div className="drawer drawer-end">
      <input
        id="debug-drawer"
        type="checkbox"
        className="drawer-toggle"
        checked={isOpen}
        onChange={(e) => setIsOpen(e.target.checked)}
      />

      {/* Main content */}
      <div className="drawer-content flex flex-col">
        {children}

        {/* Debug panel toggle button - fixed position */}
        <div className="fixed bottom-4 right-4 z-50">
          <label
            htmlFor="debug-drawer"
            className="btn btn-circle btn-primary shadow-lg drawer-button"
            title="Open Debug Panel"
          >
            <FontAwesomeIcon icon={faBug} className="w-4 h-4" />
          </label>
        </div>
      </div>

      {/* Right-side drawer */}
      <div className="drawer-side">
        <label htmlFor="debug-drawer" className="drawer-overlay" />

        <aside className="min-h-full w-96 bg-base-200 text-base-content">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-base-300">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon icon={faBug} className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Debug Panel</h2>
            </div>
            <label
              htmlFor="debug-drawer"
              className="btn btn-sm btn-ghost btn-circle"
              title="Close Debug Panel"
            >
              <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
            </label>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col p-4">
            <div className="flex items-center gap-2 mb-4">
              <FontAwesomeIcon icon={faStream} className="w-4 h-4 text-info" />
              <h3 className="text-sm font-medium">SSE Event Stream</h3>
            </div>

            <div className="flex-1">
              <EventStreamMonitor />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
