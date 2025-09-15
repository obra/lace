// ABOUTME: MCP servers settings page route component
// ABOUTME: Displays MCP server configuration in full-page layout

import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout';
import { MCPPanel } from '@/components/settings/panels/MCPPanel';

export default function MCPSettingsPage() {
  return (
    <SettingsPageLayout activeTab="mcp">
      <MCPPanel />
    </SettingsPageLayout>
  );
}
