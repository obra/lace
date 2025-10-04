// ABOUTME: Providers settings page route component
// ABOUTME: Displays AI provider configuration in full-page layout

import { SettingsPageLayout } from '@lace/web/components/settings/SettingsPageLayout';
import { ProvidersPanel } from '@lace/web/components/settings/panels/ProvidersPanel';

export default function ProvidersSettingsPage() {
  return (
    <SettingsPageLayout activeTab="providers">
      <ProvidersPanel />
    </SettingsPageLayout>
  );
}
