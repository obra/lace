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

type DaisyUITheme = 'light' | 'dark';
type TimelineWidth = 'narrow' | 'medium' | 'wide' | 'full';

interface LaceTheme {
  daisyui: DaisyUITheme;
  timeline: {
    width: TimelineWidth;
  };
}

interface ThemeContextType {
  theme: LaceTheme;
  setDaisyUITheme: (theme: DaisyUITheme) => void;
  setTimelineWidth: (width: TimelineWidth) => void;
  setTheme: (theme: Partial<LaceTheme>) => void;
  getTimelineMaxWidthClass: () => string;
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

const defaultTheme: LaceTheme = {
  daisyui: 'dark',
  timeline: {
    width: 'medium',
  },
};

function getTimelineMaxWidthClass(width: TimelineWidth): string {
  switch (width) {
    case 'narrow':
      return 'max-w-2xl';
    case 'medium':
      return 'max-w-3xl';
    case 'wide':
      return 'max-w-5xl';
    case 'full':
      return 'max-w-none';
    default:
      return 'max-w-3xl';
  }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<LaceTheme>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  // Provide a fallback context value during server-side rendering
  const fallbackValue = useMemo(
    () => ({
      theme: defaultTheme,
      setDaisyUITheme: () => {},
      setTimelineWidth: () => {},
      setTheme: () => {},
      getTimelineMaxWidthClass: () => 'max-w-3xl',
    }),
    []
  );

  // Load theme from localStorage after component mounts
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('lace-theme');
    if (savedTheme) {
      try {
        const parsed = JSON.parse(savedTheme) as LaceTheme;
        // Validate the parsed theme has required structure
        if (
          parsed &&
          typeof parsed === 'object' &&
          (parsed.daisyui === 'light' || parsed.daisyui === 'dark') &&
          parsed.timeline &&
          ['narrow', 'medium', 'wide', 'full'].includes(parsed.timeline.width)
        ) {
          setThemeState(parsed);
        } else {
          // Invalid saved theme, use default
          setThemeState(defaultTheme);
        }
      } catch {
        // Failed to parse, use default
        setThemeState(defaultTheme);
      }
    }
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (mounted) {
      // Set DaisyUI theme
      document.documentElement.setAttribute('data-theme', theme.daisyui);
    }
  }, [theme, mounted]);

  const saveTheme = useCallback(
    (newTheme: LaceTheme) => {
      setThemeState(newTheme);
      localStorage.setItem('lace-theme', JSON.stringify(newTheme));
      if (mounted) {
        document.documentElement.setAttribute('data-theme', newTheme.daisyui);
      }
    },
    [mounted]
  );

  const setDaisyUITheme = useCallback(
    (daisyui: DaisyUITheme) => {
      const newTheme = { ...theme, daisyui };
      saveTheme(newTheme);
    },
    [theme, saveTheme]
  );

  const setTimelineWidth = useCallback(
    (width: TimelineWidth) => {
      const newTheme = {
        ...theme,
        timeline: { ...theme.timeline, width },
      };
      saveTheme(newTheme);
    },
    [theme, saveTheme]
  );

  const setTheme = useCallback(
    (partialTheme: Partial<LaceTheme>) => {
      const newTheme = {
        ...theme,
        ...partialTheme,
        timeline: { ...theme.timeline, ...partialTheme.timeline },
      };
      saveTheme(newTheme);
    },
    [theme, saveTheme]
  );

  const getTimelineMaxWidthClassForTheme = useCallback(() => {
    return getTimelineMaxWidthClass(theme.timeline.width);
  }, [theme.timeline.width]);

  const value = useMemo(
    () => ({
      theme,
      setDaisyUITheme,
      setTimelineWidth,
      setTheme,
      getTimelineMaxWidthClass: getTimelineMaxWidthClassForTheme,
    }),
    [theme, setDaisyUITheme, setTimelineWidth, setTheme, getTimelineMaxWidthClassForTheme]
  );

  // Use fallback during SSR or before mount
  const contextValue = mounted ? value : fallbackValue;

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}
