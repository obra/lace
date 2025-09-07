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

  // Load theme from settings API after component mounts
  useEffect(() => {
    setMounted(true);
    let cancelled = false;

    const loadTheme = async () => {
      try {
        // Load from settings API
        const settings = await api.get<Record<string, unknown>>('/api/settings');

        // Check if theme exists in settings API
        const apiTheme = settings.theme;
        const apiTimelineWidth = settings.timelineWidth;

        if (apiTheme === 'light' || apiTheme === 'dark') {
          // Use API theme with API timeline width or default
          const timelineWidth = ['narrow', 'medium', 'wide', 'full'].includes(
            apiTimelineWidth as string
          )
            ? (apiTimelineWidth as TimelineWidth)
            : 'medium';

          if (!cancelled) {
            setThemeState({
              daisyui: apiTheme,
              timeline: { width: timelineWidth },
            });
          }
          return;
        }

        // Migration: Check localStorage for existing theme
        const savedTheme = localStorage.getItem('lace-theme');
        if (savedTheme) {
          try {
            // Try to parse as new LaceTheme format
            const parsed = JSON.parse(savedTheme) as LaceTheme;
            if (
              parsed &&
              typeof parsed === 'object' &&
              (parsed.daisyui === 'light' || parsed.daisyui === 'dark') &&
              parsed.timeline &&
              ['narrow', 'medium', 'wide', 'full'].includes(parsed.timeline.width)
            ) {
              // Migrate complete theme to settings API
              await api.patch('/api/settings', {
                theme: parsed.daisyui,
                timelineWidth: parsed.timeline.width,
              });
              if (cancelled) return;
              setThemeState(parsed);
              localStorage.removeItem('lace-theme');
              return;
            }
          } catch {
            // Fall through to simple string check
          }

          // Try old format (simple string)
          if (savedTheme === 'light' || savedTheme === 'dark') {
            // Migrate to settings API with default timeline width
            await api.patch('/api/settings', {
              theme: savedTheme,
              timelineWidth: 'medium',
            });
            if (cancelled) return;
            setThemeState({
              daisyui: savedTheme,
              timeline: { width: 'medium' },
            });
            localStorage.removeItem('lace-theme');
            return;
          }
        }

        // Default theme
        if (!cancelled) setThemeState(defaultTheme);
      } catch (error) {
        console.warn('Failed to load theme from settings:', error);
        // Default theme if API fails
        if (!cancelled) setThemeState(defaultTheme);
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
      document.documentElement.setAttribute('data-theme', theme.daisyui);
    }
  }, [theme, mounted]);

  const saveTheme = useCallback(
    (newTheme: LaceTheme) => {
      setThemeState(newTheme);
      if (mounted) {
        document.documentElement.setAttribute('data-theme', newTheme.daisyui);

        // Save both theme and timeline width to settings API
        void api
          .patch('/api/settings', {
            theme: newTheme.daisyui,
            timelineWidth: newTheme.timeline.width,
          })
          .catch((error) => {
            console.warn('Failed to save theme to settings:', error);
          });
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

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
