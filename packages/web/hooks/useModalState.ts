// ABOUTME: Custom hook for modal state management
// ABOUTME: Centralizes all modal visibility states and task selection

import { useState } from 'react';
import type { Task } from '@/types/core';

interface UseModalStateResult {
  // Navigation states
  showMobileNav: boolean;
  setShowMobileNav: (show: boolean) => void;
  showDesktopSidebar: boolean;
  setShowDesktopSidebar: (show: boolean) => void;

  // Task-related modal states
  showTaskBoard: boolean;
  setShowTaskBoard: (show: boolean) => void;
  showTaskCreation: boolean;
  setShowTaskCreation: (show: boolean) => void;
  showTaskDisplay: boolean;
  setShowTaskDisplay: (show: boolean) => void;
  selectedTaskForDisplay: Task | null;
  setSelectedTaskForDisplay: (task: Task | null) => void;

  // Project creation state
  autoOpenCreateProject: boolean;
  setAutoOpenCreateProject: (open: boolean) => void;
}

export function useModalState(): UseModalStateResult {
  // Navigation states
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);

  // Task-related modal states
  const [showTaskBoard, setShowTaskBoard] = useState(false);
  const [showTaskCreation, setShowTaskCreation] = useState(false);
  const [showTaskDisplay, setShowTaskDisplay] = useState(false);
  const [selectedTaskForDisplay, setSelectedTaskForDisplay] = useState<Task | null>(null);

  // Project creation state
  const [autoOpenCreateProject, setAutoOpenCreateProject] = useState(false);

  return {
    // Navigation
    showMobileNav,
    setShowMobileNav,
    showDesktopSidebar,
    setShowDesktopSidebar,

    // Task modals
    showTaskBoard,
    setShowTaskBoard,
    showTaskCreation,
    setShowTaskCreation,
    showTaskDisplay,
    setShowTaskDisplay,
    selectedTaskForDisplay,
    setSelectedTaskForDisplay,

    // Project creation
    autoOpenCreateProject,
    setAutoOpenCreateProject,
  };
}
