// ABOUTME: Context provider for delegate timeline data access
// ABOUTME: Eliminates prop drilling by providing component-level data fetching

import React, { createContext, useContext, ReactNode } from 'react';
import { Timeline } from '../../../../thread-processor.js';

interface DelegateTimelineContextValue {
  getDelegateTimeline: (threadId: string) => Timeline | undefined;
  getAllDelegateTimelines: () => Map<string, Timeline>;
  hasDelegateTimelines: () => boolean;
}

const DelegateTimelineContext = createContext<DelegateTimelineContextValue | null>(null);

interface DelegateTimelineProviderProps {
  children: ReactNode;
  delegateTimelines: Map<string, Timeline>;
}

export function DelegateTimelineProvider({ children, delegateTimelines }: DelegateTimelineProviderProps) {
  const contextValue: DelegateTimelineContextValue = {
    getDelegateTimeline: (threadId: string) => delegateTimelines.get(threadId),
    getAllDelegateTimelines: () => delegateTimelines,
    hasDelegateTimelines: () => delegateTimelines.size > 0,
  };

  return (
    <DelegateTimelineContext.Provider value={contextValue}>
      {children}
    </DelegateTimelineContext.Provider>
  );
}

export function useDelegateTimelines(): DelegateTimelineContextValue {
  const context = useContext(DelegateTimelineContext);
  if (!context) {
    throw new Error('useDelegateTimelines must be used within a DelegateTimelineProvider');
  }
  return context;
}

export function useDelegateTimeline(threadId: string): Timeline | undefined {
  const { getDelegateTimeline } = useDelegateTimelines();
  return getDelegateTimeline(threadId);
}