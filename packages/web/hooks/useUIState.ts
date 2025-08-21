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
  // Unified sidebar state - persisted across navigation
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lace-sidebar-open');
      if (stored !== null) {
        // Type-safe parsing - only accept 'true'/'false' strings
        return stored === 'true';
      }
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
      localStorage.setItem('lace-sidebar-open', String(newValue));
      return newValue;
    });
  }, []);

  // Persist sidebar state when it changes
  useEffect(() => {
    localStorage.setItem('lace-sidebar-open', String(sidebarOpen));
  }, [sidebarOpen]);

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
