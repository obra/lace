// ABOUTME: User settings page route component
// ABOUTME: Displays user profile settings in full-page layout

import { SettingsLayout } from '@/components/settings/SettingsLayout';
import { UserSettingsPanel } from '@/components/settings/panels/UserSettingsPanel';

export default function UserSettingsPage() {
  return (
    <SettingsLayout activeTab="user">
      <UserSettingsPanel />
    </SettingsLayout>
  );
}
