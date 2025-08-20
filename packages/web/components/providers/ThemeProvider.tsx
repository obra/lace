// ABOUTME: Theme provider component for DaisyUI theme switching
// ABOUTME: Manages theme state and localStorage persistence with proper hydration

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

interface ThemeContextType {
  theme: string;
  setTheme: (theme: string) => void;
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
  const [theme, setThemeState] = useState('dark'); // Always start with dark to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage after component mounts
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('lace-theme') || 'dark';
    setThemeState(savedTheme);
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme, mounted]);

  const setTheme = useCallback(
    (newTheme: string) => {
      setThemeState(newTheme);
      localStorage.setItem('lace-theme', newTheme);
      if (mounted) {
        document.documentElement.setAttribute('data-theme', newTheme);
      }
    },
    [mounted]
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
