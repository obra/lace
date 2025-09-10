// ABOUTME: Settings provider component managing all user preferences
// ABOUTME: Handles theme, UI settings, debugging preferences with API persistence

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

// Flat settings structure - matches existing API pattern
const LaceSettingsSchema = z.object({
  // Theme settings (keeping existing structure for compatibility)
  theme: DaisyUIThemeSchema,
  timelineWidth: TimelineWidthSchema,

  // Debugging settings
  debugPanelEnabled: z.boolean(),
});

type DaisyUITheme = z.infer<typeof DaisyUIThemeSchema>;
type TimelineWidth = z.infer<typeof TimelineWidthSchema>;
type LaceSettings = z.infer<typeof LaceSettingsSchema>;

interface SettingsContextType {
  // Settings state
  settings: LaceSettings;

  // Theme methods (keeping useTheme compatibility)
  setDaisyUITheme: (theme: DaisyUITheme) => void;
  setTimelineWidth: (width: TimelineWidth) => void;
  getTimelineMaxWidthClass: () => string;

  // Debugging methods
  setDebugPanelEnabled: (enabled: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

// Legacy theme hook for backward compatibility
export function useTheme() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useTheme must be used within SettingsProvider');
  }
  return {
    theme: {
      daisyui: context.settings.theme,
      timeline: { width: context.settings.timelineWidth },
    },
    setDaisyUITheme: context.setDaisyUITheme,
    setTimelineWidth: context.setTimelineWidth,
    setTheme: (partialTheme: { daisyui?: DaisyUITheme; timeline?: { width?: TimelineWidth } }) => {
      if (partialTheme.daisyui) {
        context.setDaisyUITheme(partialTheme.daisyui);
      }
      if (partialTheme.timeline?.width) {
        context.setTimelineWidth(partialTheme.timeline.width);
      }
    },
    getTimelineMaxWidthClass: context.getTimelineMaxWidthClass,
  };
}

// New debugging settings hook
export function useDebuggingSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useDebuggingSettings must be used within SettingsProvider');
  }
  return {
    debugPanelEnabled: context.settings.debugPanelEnabled,
    setDebugPanelEnabled: context.setDebugPanelEnabled,
  };
}

interface SettingsProviderProps {
  children: ReactNode;
}

const defaultSettings: LaceSettings = {
  theme: 'dark',
  timelineWidth: 'medium',
  debugPanelEnabled: false,
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
  const [settings, setSettingsState] = useState<LaceSettings>(defaultSettings);
  const [mounted, setMounted] = useState(false);

  // Load settings from API after component mounts
  useEffect(() => {
    setMounted(true);
    let cancelled = false;

    const loadSettings = async () => {
      try {
        // Load from settings API
        const apiSettings = await api.get<Record<string, unknown>>('/api/settings');

        // Parse each setting with fallbacks
        const parsedSettings: LaceSettings = {
          theme: DaisyUIThemeSchema.safeParse(apiSettings.theme).success
            ? DaisyUIThemeSchema.parse(apiSettings.theme)
            : defaultSettings.theme,
          timelineWidth: TimelineWidthSchema.safeParse(apiSettings.timelineWidth).success
            ? TimelineWidthSchema.parse(apiSettings.timelineWidth)
            : defaultSettings.timelineWidth,
          debugPanelEnabled:
            typeof apiSettings.debugPanelEnabled === 'boolean'
              ? apiSettings.debugPanelEnabled
              : defaultSettings.debugPanelEnabled,
        };

        if (!cancelled) {
          setSettingsState(parsedSettings);
        }
      } catch (error) {
        console.warn('Failed to load settings from API:', error);
        if (!cancelled) {
          setSettingsState(defaultSettings);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }, [settings.theme, mounted]);

  const saveSettings = useCallback(
    (newSettings: LaceSettings) => {
      setSettingsState(newSettings);
      if (mounted) {
        document.documentElement.setAttribute('data-theme', newSettings.theme);

        // Save all settings to API
        void api
          .patch('/api/settings', {
            theme: newSettings.theme,
            timelineWidth: newSettings.timelineWidth,
            debugPanelEnabled: newSettings.debugPanelEnabled,
          })
          .catch((error) => {
            console.warn('Failed to save settings to API:', error);
          });
      }
    },
    [mounted]
  );

  const setDaisyUITheme = useCallback(
    (theme: DaisyUITheme) => {
      const newSettings = { ...settings, theme };
      saveSettings(newSettings);
    },
    [settings, saveSettings]
  );

  const setTimelineWidth = useCallback(
    (timelineWidth: TimelineWidth) => {
      const newSettings = { ...settings, timelineWidth };
      saveSettings(newSettings);
    },
    [settings, saveSettings]
  );

  const setDebugPanelEnabled = useCallback(
    (debugPanelEnabled: boolean) => {
      const newSettings = { ...settings, debugPanelEnabled };
      saveSettings(newSettings);
    },
    [settings, saveSettings]
  );

  const getTimelineMaxWidthClassForSettings = useCallback(() => {
    return getTimelineMaxWidthClass(settings.timelineWidth);
  }, [settings.timelineWidth]);

  const value = useMemo(
    () => ({
      settings,
      setDaisyUITheme,
      setTimelineWidth,
      setDebugPanelEnabled,
      getTimelineMaxWidthClass: getTimelineMaxWidthClassForSettings,
    }),
    [
      settings,
      setDaisyUITheme,
      setTimelineWidth,
      setDebugPanelEnabled,
      getTimelineMaxWidthClassForSettings,
    ]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
