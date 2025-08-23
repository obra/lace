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
}

export function useUIState(): UseUIStateResult {
  // Unified sidebar state - persisted across navigation by React state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Modal state
  const [autoOpenCreateProject, setAutoOpenCreateProject] = useState(false);

  // Loading state
  const [loading, setLoading] = useState(false);

  // Unified sidebar toggle
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev: boolean) => !prev);
  }, []);

  // No localStorage persistence needed - Next.js maintains state across navigation

  return {
    // Unified sidebar API
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,

    // Modal state
    autoOpenCreateProject,
    setAutoOpenCreateProject,

    // Loading state
    loading,
    setLoading,
  };
}
