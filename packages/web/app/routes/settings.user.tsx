// ABOUTME: User settings page route component
// ABOUTME: Displays user profile settings in full-page layout

import { SettingsPageLayout } from '@lace/web/components/settings/SettingsPageLayout';
import { UserSettingsPanel } from '@lace/web/components/settings/panels/UserSettingsPanel';

export default function UserSettingsPage() {
  return (
    <SettingsPageLayout activeTab="user">
      <UserSettingsPanel />
    </SettingsPageLayout>
  );
}
