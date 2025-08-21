// ABOUTME: Main provider instances dashboard with PageLayout architecture
// ABOUTME: Shows configured instances with status and management actions

'use client';

import React from 'react';
import { ProviderInstanceList } from '@/components/providers/ProviderInstanceList';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';
import { ContextProviders } from '@/components/providers/ContextProviders';
import { PageLayout } from '@/components/layout/PageLayout';
import { useNavigation } from '@/hooks/useNavigation';

function ProvidersPageContent() {
  const navigation = useNavigation();

  return (
    <PageLayout title="Provider Instances" onSelectProject={navigation.toHome}>
      <div className="p-6 space-y-6">
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
    </PageLayout>
  );
}

export default function ProvidersPage() {
  return (
    <ContextProviders>
      <ProviderInstanceProvider>
        <ProvidersPageContent />
      </ProviderInstanceProvider>
    </ContextProviders>
  );
}
