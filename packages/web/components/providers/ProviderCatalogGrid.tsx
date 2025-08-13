// ABOUTME: Grid display of available providers from catalogs
// ABOUTME: Shows provider cards with model counts and pricing info

'use client';

import { useEffect, useState } from 'react';
import { ProviderCatalogCard } from './ProviderCatalogCard';
import { AddInstanceModal } from './AddInstanceModal';
import { parseResponse } from '@/lib/serialization';

interface CatalogModel {
  id: string;
  name: string;
  cost_per_1m_in: number;
  cost_per_1m_out: number;
  cost_per_1m_in_cached?: number;
  cost_per_1m_out_cached?: number;
  context_window: number;
  default_max_tokens: number;
  can_reason?: boolean;
  has_reasoning_effort?: boolean;
  supports_attachments?: boolean;
}

interface CatalogProvider {
  id: string;
  name: string;
  type: string;
  api_key?: string;
  api_endpoint?: string;
  default_large_model_id: string;
  default_small_model_id: string;
  models: CatalogModel[];
}

export function ProviderCatalogGrid() {
  const [providers, setProviders] = useState<CatalogProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/provider/catalog');

      if (!response.ok) {
        throw new Error(`Failed to load catalog: ${response.status}`);
      }

      const data = await parseResponse<{ providers: CatalogProvider[] }>(response);
      setProviders(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  const handleAddInstance = (provider: CatalogProvider) => {
    setSelectedProvider(provider);
    setShowAddModal(true);
  };

  const handleModalClose = () => {
    setShowAddModal(false);
    setSelectedProvider(null);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card bg-base-100 shadow-sm">
            <div className="card-body">
              <div className="flex items-center justify-between mb-3">
                <div className="h-6 bg-base-300 rounded animate-pulse w-1/2"></div>
                <div className="h-5 bg-base-300 rounded animate-pulse w-16"></div>
              </div>
              <div className="h-4 bg-base-300 rounded animate-pulse w-3/4 mb-3"></div>
              <div className="space-y-1">
                <div className="h-3 bg-base-300 rounded animate-pulse"></div>
                <div className="h-3 bg-base-300 rounded animate-pulse w-4/5"></div>
              </div>
              <div className="card-actions justify-end mt-4">
                <div className="h-8 bg-base-300 rounded animate-pulse w-24"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <span>Error: {error}</span>
        <button className="btn btn-sm btn-ghost" onClick={loadProviders}>
          Retry
        </button>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="max-w-md mx-auto">
          <div className="mb-4">
            <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg
                className="w-8 h-8 text-base-content/40"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14-7l2 7-2 7-14-7 2-7 2 7-2 7-14-7 14-7z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">No Providers Available</h3>
            <p className="text-base-content/60">
              No providers found in the catalog. Check your configuration or try again later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {providers.map((provider) => (
          <ProviderCatalogCard
            key={provider.id}
            provider={provider}
            onAddInstance={() => handleAddInstance(provider)}
          />
        ))}
      </div>

      <AddInstanceModal
        isOpen={showAddModal}
        onClose={handleModalClose}
        onSuccess={() => {
          // Success handled by parent component
          handleModalClose();
        }}
        preselectedProvider={selectedProvider}
      />
    </>
  );
}
