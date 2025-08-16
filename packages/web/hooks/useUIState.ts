// ABOUTME: Centralized UI state management for modals and sidebar visibility
// ABOUTME: Manages mobile navigation, desktop sidebar, and modal display states

import { useState, useCallback, useEffect } from 'react';

interface UseUIStateResult {
  // Navigation state
  showMobileNav: boolean;
  showDesktopSidebar: boolean;
  setShowMobileNav: (show: boolean) => void;
  setShowDesktopSidebar: (show: boolean) => void;
  toggleDesktopSidebar: () => void;

  // Modal state
  autoOpenCreateProject: boolean;
  setAutoOpenCreateProject: (open: boolean) => void;

  // Loading state
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

export function useUIState(): UseUIStateResult {
  // Navigation state
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);

  // Modal state
  const [autoOpenCreateProject, setAutoOpenCreateProject] = useState(false);

  // Loading state
  const [loading, setLoading] = useState(false);

  // Sidebar toggle action
  const toggleDesktopSidebar = useCallback(() => {
    setShowDesktopSidebar((prev) => !prev);
  }, []);

  // Close mobile nav when clicking outside or navigation
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setShowMobileNav(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    // Navigation state
    showMobileNav,
    showDesktopSidebar,
    setShowMobileNav,
    setShowDesktopSidebar,
    toggleDesktopSidebar,

    // Modal state
    autoOpenCreateProject,
    setAutoOpenCreateProject,

    // Loading state
    loading,
    setLoading,
  };
}
