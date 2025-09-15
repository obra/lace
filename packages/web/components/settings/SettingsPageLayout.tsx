// ABOUTME: Simple layout wrapper for settings pages with sidebar
// ABOUTME: Provides basic UI structure without complex context preservation

'use client';

import React, { useCallback } from 'react';
import { motion } from 'motion/react';
import { UIProvider } from '@/components/providers/UIProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { useUIContext } from '@/components/providers/UIProvider';
import { useNavigate } from 'react-router';
import { SettingsLayout } from './SettingsLayout';

interface SettingsPageLayoutProps {
  children: React.ReactNode;
  activeTab: 'providers' | 'mcp' | 'ui' | 'user';
}

// Inner component that has access to UIContext
function SettingsPageInner({ children, activeTab }: SettingsPageLayoutProps) {
  const { sidebarOpen, toggleSidebar } = useUIContext();
  const navigate = useNavigate();

  const handleSwitchProject = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const handleAgentSelect = useCallback(() => {
    // No-op for settings pages
  }, []);

  return (
    <motion.div
      className="flex h-screen bg-gradient-to-br from-base-100 via-base-200/50 to-base-200 text-base-content font-ui overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Sidebar */}
      <div data-testid="sidebar" className="flex-shrink-0 h-full">
        <Sidebar open={sidebarOpen} onToggle={toggleSidebar}>
          <SidebarContent
            isMobile={false}
            onCloseMobileNav={toggleSidebar}
            onSwitchProject={handleSwitchProject}
            onAgentSelect={handleAgentSelect}
          />
        </Sidebar>
      </div>

      {/* Settings Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <SettingsLayout activeTab={activeTab}>{children}</SettingsLayout>
      </div>
    </motion.div>
  );
}

const noOpCallback = () => {};

export function SettingsPageLayout({ children, activeTab }: SettingsPageLayoutProps) {
  // Provide minimal context just for the sidebar to render
  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={null}
        onProjectSelect={noOpCallback}
        onProjectChange={noOpCallback}
      >
        <SettingsPageInner activeTab={activeTab}>{children}</SettingsPageInner>
      </ProjectProvider>
    </UIProvider>
  );
}
