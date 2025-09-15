// ABOUTME: Release notes settings page route component
// ABOUTME: Displays release notes content in settings with manual access option

import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout';
import { ReleaseNotesPanel } from '@/components/settings/panels/ReleaseNotesPanel';
import { SETTINGS_TABS } from '@/lib/settings-config';

export default function ReleaseNotesSettingsPage() {
  return (
    <SettingsPageLayout activeTab={SETTINGS_TABS.RELEASE_NOTES}>
      <ReleaseNotesPanel />
    </SettingsPageLayout>
  );
}
