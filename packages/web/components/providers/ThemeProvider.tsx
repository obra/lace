// ABOUTME: Theme provider component for DaisyUI theme switching
// ABOUTME: Manages theme state and settings API persistence with localStorage migration

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  ReactNode,
} from 'react';
import { api } from '@/lib/api-client';

type ThemeValue = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemeValue;
  setTheme: (theme: ThemeValue) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeValue>('dark'); // Always start with dark to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);

  // Load theme from settings API after component mounts
  useEffect(() => {
    setMounted(true);
    let cancelled = false;

    const loadTheme = async () => {
      try {
        // Load from settings API
        const settings = await api.get<Record<string, unknown>>('/api/settings');

        // Check if theme exists in settings
        const apiTheme = settings.theme;
        if (apiTheme === 'light' || apiTheme === 'dark') {
          if (!cancelled) setThemeState(apiTheme);
          return;
        }

        // Migration: Check localStorage for existing theme
        const savedTheme = localStorage.getItem('lace-theme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
          // Migrate to settings API
          await api.patch('/api/settings', { theme: savedTheme });
          if (!cancelled) setThemeState(savedTheme);
          // Remove from localStorage after successful migration
          localStorage.removeItem('lace-theme');
          return;
        }

        // Default to dark theme
        if (!cancelled) setThemeState('dark');
      } catch (error) {
        console.warn('Failed to load theme from settings:', error);
        // Default to dark theme if API fails
        if (!cancelled) setThemeState('dark');
      }
    };

    void loadTheme();

    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme, mounted]);

  const setTheme = useCallback(
    (newTheme: ThemeValue) => {
      setThemeState(newTheme);
      if (mounted) {
        document.documentElement.setAttribute('data-theme', newTheme);

        // Save to settings API
        void api.patch('/api/settings', { theme: newTheme }).catch((error) => {
          console.warn('Failed to save theme to settings:', error);
        });
      }
    },
    [mounted]
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
