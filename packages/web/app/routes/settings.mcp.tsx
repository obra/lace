// ABOUTME: MCP servers settings page route component
// ABOUTME: Displays MCP server configuration in full-page layout

import { SettingsLayout } from '@/components/settings/SettingsLayout';
import { MCPPanel } from '@/components/settings/panels/MCPPanel';

export default function MCPSettingsPage() {
  return (
    <SettingsLayout activeTab="mcp">
      <MCPPanel />
    </SettingsLayout>
  );
}
