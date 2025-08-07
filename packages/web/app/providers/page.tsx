// ABOUTME: Main provider instances dashboard
// ABOUTME: Shows configured instances with status and management actions

import { ProviderInstanceList } from '@/components/providers/ProviderInstanceList';

export default function ProvidersPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Configured Instances</h2>
          <p className="text-sm text-base-content/60 mt-1">
            Manage your AI provider connections and credentials
          </p>
        </div>
      </div>
      <ProviderInstanceList />
    </div>
  );
}