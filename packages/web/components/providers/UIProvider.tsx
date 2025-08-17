// ABOUTME: UI state provider for sidebar, modal, and navigation state management
// ABOUTME: Separates UI concerns from business logic providers for clean architecture

'use client';

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useUIState } from '@/hooks/useUIState';
import type { UseUIStateResult } from '@/hooks/useUIState';

interface UIProviderProps {
  children: ReactNode;
}

const UIContext = createContext<UseUIStateResult | null>(null);

export function UIProvider({ children }: UIProviderProps) {
  const uiState = useUIState();

  return <UIContext.Provider value={uiState}>{children}</UIContext.Provider>;
}

export function useUIContext(): UseUIStateResult {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUIContext must be used within UIProvider');
  }
  return context;
}
