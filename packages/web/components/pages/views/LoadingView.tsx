// ABOUTME: Loading state view for LaceApp when projects or providers are loading
// ABOUTME: Displays animated loading spinner with descriptive messaging

'use client';

import React from 'react';

interface LoadingViewProps {
  message?: string;
}

export function LoadingView({ message = 'Loading your workspace...' }: LoadingViewProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="loading loading-spinner loading-lg text-base-content/60"></div>
        <div className="text-center">
          <div className="text-lg font-medium text-base-content">Setting things up</div>
          <div className="text-sm text-base-content/60 animate-pulse-soft">{message}</div>
        </div>
      </div>
    </div>
  );
}
