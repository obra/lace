// ABOUTME: User settings page route component
// ABOUTME: Displays user profile settings in full-page layout

import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout';
import { UserSettingsPanel } from '@/components/settings/panels/UserSettingsPanel';

export default function UserSettingsPage() {
  return (
    <SettingsPageLayout activeTab="user">
      <UserSettingsPanel />
    </SettingsPageLayout>
  );
}
