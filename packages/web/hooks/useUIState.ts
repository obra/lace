// ABOUTME: Centralized UI state management for modals and unified sidebar visibility
// ABOUTME: Manages unified sidebar state that works for both mobile and desktop layouts

import { useState, useCallback, useEffect } from 'react';

export interface UseUIStateResult {
  // Unified sidebar state
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Modal state
  autoOpenCreateProject: boolean;
  setAutoOpenCreateProject: (open: boolean) => void;

  // Loading state
  loading: boolean;
  setLoading: (loading: boolean) => void;

  // Legacy support - will be removed
  showMobileNav: boolean;
  showDesktopSidebar: boolean;
  setShowMobileNav: (show: boolean) => void;
  toggleDesktopSidebar: () => void;
}

export function useUIState(): UseUIStateResult {
  // Unified sidebar state - persisted across navigation
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lace-sidebar-open');
      return stored !== null ? JSON.parse(stored) : true;
    }
    return true;
  });

  // Modal state
  const [autoOpenCreateProject, setAutoOpenCreateProject] = useState(false);

  // Loading state
  const [loading, setLoading] = useState(false);

  // Unified sidebar toggle with persistence
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev: boolean) => {
      const newValue = !prev;
      localStorage.setItem('lace-sidebar-open', JSON.stringify(newValue));
      return newValue;
    });
  }, []);

  // Persist sidebar state when it changes
  useEffect(() => {
    localStorage.setItem('lace-sidebar-open', JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  // Legacy support - map to unified state
  const showMobileNav = sidebarOpen;
  const showDesktopSidebar = sidebarOpen;
  const setShowMobileNav = setSidebarOpen;
  const toggleDesktopSidebar = toggleSidebar;

  return {
    // New unified API
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,

    // Modal state
    autoOpenCreateProject,
    setAutoOpenCreateProject,

    // Loading state
    loading,
    setLoading,

    // Legacy support for gradual migration
    showMobileNav,
    showDesktopSidebar,
    setShowMobileNav,
    toggleDesktopSidebar,
  };
}
