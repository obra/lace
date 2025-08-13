// ABOUTME: React component for console forwarding script injection  
// ABOUTME: Only injects in development mode to avoid production overhead
//
// This component automatically initializes console forwarding when mounted
// and is designed to be included in the root layout to work across all pages.

'use client';

import { useEffect } from 'react';
import { initConsoleForwarding, destroyConsoleForwarding } from './client';
import { DEFAULT_CONFIG } from './index';

/**
 * React component that initializes console forwarding in development mode
 * 
 * Include this component in your app layout to automatically enable
 * browser console forwarding to your development server terminal.
 * 
 * The component renders nothing and only runs the initialization side effect.
 */
export function ConsoleForwardScript() {
  useEffect(() => {
    // Only run in development mode - no overhead in production
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    // Initialize console forwarding with default configuration
    initConsoleForwarding(DEFAULT_CONFIG);

    return () => {
      // Explicit cleanup to restore original console methods
      destroyConsoleForwarding();
    };
  }, []); // Empty dependency array - only run once on mount

  // This component renders nothing - it's purely for the initialization side effect
  return null;
}