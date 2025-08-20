// ABOUTME: Standardized page layout component with sidebar and main content area
// ABOUTME: Eliminates layout duplication across all pages and provides consistent structure

'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@/lib/fontawesome';
import { useUIContext } from '@/components/providers/UIProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { SettingsContainer } from '@/components/settings/SettingsContainer';

interface PageLayoutProps {
  title: string;
  onSelectProject?: () => void;
  onSelectAgent?: (agentId: string) => void;
  onSelectSession?: () => void;
  children: ReactNode;
}

export function PageLayout({
  title,
  onSelectProject,
  onSelectAgent,
  onSelectSession,
  children,
}: PageLayoutProps) {
  const { sidebarOpen, toggleSidebar } = useUIContext();

  return (
    <motion.div
      className="flex h-screen bg-gradient-to-br from-base-100 via-base-200/50 to-base-200 text-base-content font-ui overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Unified Sidebar */}
      <div data-testid="sidebar" className="flex-shrink-0 h-full">
        <SettingsContainer>
          {({ onOpenSettings }) => (
            <Sidebar open={sidebarOpen} onToggle={toggleSidebar} onSettingsClick={onOpenSettings}>
              <SidebarContent
                onCloseMobileNav={toggleSidebar}
                onSwitchProject={onSelectProject || (() => {})}
                onAgentSelect={onSelectAgent || (() => {})}
                onClearAgent={() => {}} // TODO: Add to interface if needed
                onConfigureAgent={() => {}} // TODO: Add to interface if needed
                onConfigureSession={onSelectSession || (() => {})}
              />
            </Sidebar>
          )}
        </SettingsContainer>
      </div>

      {/* Main Content */}
      <motion.div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Top Bar */}
        <motion.div className="bg-base-100/90 backdrop-blur-md border-b border-base-300/50 flex-shrink-0 z-30">
          <div className="flex items-center justify-between p-4 lg:px-6">
            <div className="flex items-center gap-3">
              <motion.button
                onClick={toggleSidebar}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
                aria-label="Toggle sidebar"
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </motion.button>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-base-content truncate">{title}</h1>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
