// ABOUTME: Providers settings page route component
// ABOUTME: Displays AI provider configuration in full-page layout

import { SettingsLayout } from '@/components/settings/SettingsLayout';
import { ProvidersPanel } from '@/components/settings/panels/ProvidersPanel';

export default function ProvidersSettingsPage() {
  return (
    <SettingsLayout activeTab="providers">
      <ProvidersPanel />
    </SettingsLayout>
  );
}
