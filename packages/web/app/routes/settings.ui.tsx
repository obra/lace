// ABOUTME: UI settings page route component
// ABOUTME: Displays UI preferences and theme settings in full-page layout

import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout';
import { UISettingsPanel } from '@/components/settings/panels/UISettingsPanel';
import { useTheme } from '@/components/providers/SettingsProvider';

export default function UISettingsPage() {
  const { theme, setDaisyUITheme } = useTheme();

  const handleThemeChange = (newTheme: string) => {
    if (newTheme === 'light' || newTheme === 'dark') {
      setDaisyUITheme(newTheme);
    }
  };

  return (
    <SettingsPageLayout activeTab="ui">
      <UISettingsPanel currentTheme={theme.daisyui} onThemeChange={handleThemeChange} />
    </SettingsPageLayout>
  );
}
