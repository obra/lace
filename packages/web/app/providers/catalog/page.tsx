// ABOUTME: Provider catalog browser page with PageLayout architecture
// ABOUTME: Shows available providers from catalog with add instance actions

'use client';

import React from 'react';
import { ProviderCatalogGrid } from '@/components/providers/ProviderCatalogGrid';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';
import { ContextProviders } from '@/components/providers/ContextProviders';
import { PageLayout } from '@/components/layout/PageLayout';
import { useNavigation } from '@/hooks/useNavigation';

function CatalogPageContent() {
  const navigation = useNavigation();

  return (
    <PageLayout title="Provider Catalog" onSelectProject={navigation.toHome}>
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold">Provider Catalog</h2>
            <p className="text-sm text-base-content/60 mt-1">
              Browse available AI providers and their models
            </p>
          </div>
        </div>
        <ProviderCatalogGrid />
      </div>
    </PageLayout>
  );
}

export default function CatalogPage() {
  return (
    <ContextProviders>
      <ProviderInstanceProvider>
        <CatalogPageContent />
      </ProviderInstanceProvider>
    </ContextProviders>
  );
}
