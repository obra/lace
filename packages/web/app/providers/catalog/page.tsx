// ABOUTME: Provider catalog browser page
// ABOUTME: Shows available providers from catalog with add instance actions

import { ProviderCatalogGrid } from '@/components/providers/ProviderCatalogGrid';

export default function CatalogPage() {
  return (
    <div className="space-y-6">
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
  );
}
