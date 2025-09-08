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
import { z } from 'zod';
import { api } from '@/lib/api-client';

const DaisyUIThemeSchema = z.enum(['light', 'dark']);
const TIMELINE_WIDTHS = ['narrow', 'medium', 'wide', 'full'] as const;
const TimelineWidthSchema = z.enum(TIMELINE_WIDTHS);

export { TIMELINE_WIDTHS };

const LaceThemeSchema = z.object({
  daisyui: DaisyUIThemeSchema,
  timeline: z.object({
    width: TimelineWidthSchema,
  }),
});

type DaisyUITheme = z.infer<typeof DaisyUIThemeSchema>;
type TimelineWidth = z.infer<typeof TimelineWidthSchema>;
type LaceTheme = z.infer<typeof LaceThemeSchema>;

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
    throw new Error('useTheme must be used within SettingsProvider');
  }
  return context;
}

interface SettingsProviderProps {
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

export function SettingsProvider({ children }: SettingsProviderProps) {
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

        const daisyUIResult = DaisyUIThemeSchema.safeParse(apiTheme);
        if (daisyUIResult.success) {
          // Use API theme with API timeline width or default
          const timelineWidthResult = TimelineWidthSchema.safeParse(apiTimelineWidth);
          const timelineWidth = timelineWidthResult.success ? timelineWidthResult.data : 'medium';

          if (!cancelled) {
            setThemeState({
              daisyui: daisyUIResult.data,
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
            const parsedUnknown = JSON.parse(savedTheme) as unknown;
            const themeResult = LaceThemeSchema.safeParse(parsedUnknown);
            if (themeResult.success) {
              // Migrate complete theme to settings API
              await api.patch('/api/settings', {
                theme: themeResult.data.daisyui,
                timelineWidth: themeResult.data.timeline.width,
              });
              if (cancelled) return;
              setThemeState(themeResult.data);
              localStorage.removeItem('lace-theme');
              return;
            }
          } catch {
            // Fall through to simple string check
          }

          // Try old format (simple string)
          const oldThemeResult = DaisyUIThemeSchema.safeParse(savedTheme);
          if (oldThemeResult.success) {
            // Migrate to settings API with default timeline width
            await api.patch('/api/settings', {
              theme: oldThemeResult.data,
              timelineWidth: 'medium',
            });
            if (cancelled) return;
            setThemeState({
              daisyui: oldThemeResult.data,
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
