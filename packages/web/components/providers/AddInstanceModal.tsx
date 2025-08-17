// ABOUTME: Modal for configuring new provider instances
// ABOUTME: Multi-step form with catalog selection, configuration, and credentials

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import { useProviderInstances, type CatalogProvider } from './ProviderInstanceProvider';

interface AddInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedProvider?: CatalogProvider | null;
}

export function AddInstanceModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedProvider,
}: AddInstanceModalProps) {
  const {
    catalogProviders: providers,
    catalogLoading: loading,
    catalogError: error,
    createInstance,
    loadCatalog,
  } = useProviderInstances();

  const [step, setStep] = useState<'select' | 'configure'>('select');
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    displayName: '',
    endpoint: '',
    timeout: 30000,
    apiKey: '',
  });

  useEffect(() => {
    if (isOpen && !preselectedProvider) {
      void loadCatalog();
    } else if (preselectedProvider) {
      setSelectedProvider(preselectedProvider);
      setFormData((prev) => ({
        ...prev,
        displayName: preselectedProvider.name,
      }));
      setStep('configure');
    }
  }, [isOpen, preselectedProvider, loadCatalog]);

  const handleProviderSelect = (provider: CatalogProvider) => {
    setSelectedProvider(provider);
    setFormData((prev) => ({
      ...prev,
      displayName: provider.name, // Use provider name directly
    }));
    setStep('configure');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProvider) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      // Create the instance using provider method
      await createInstance(selectedProvider.id, {
        displayName: formData.displayName,
        endpoint: formData.endpoint.trim(),
        timeout: formData.timeout,
        apiKey: formData.apiKey,
      });

      onSuccess();
      onClose();
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create instance');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep('select');
    setSelectedProvider(null);
    setFormData({ displayName: '', endpoint: '', timeout: 30000, apiKey: '' });
    setSubmitError(null);
  };

  const handleClose = () => {
    onClose();
    setTimeout(resetForm, 300); // Reset after modal closes
  };

  const getStepTitle = () => {
    if (preselectedProvider) {
      return `Add ${preselectedProvider.name} Instance`;
    }
    return step === 'select' ? 'Select Provider' : 'Configure Instance';
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={getStepTitle()} size="md">
      {(error || submitError) && (
        <div className="alert alert-error mb-4">
          <span className="text-sm">{error || submitError}</span>
        </div>
      )}

      {step === 'select' && !preselectedProvider ? (
        <div className="space-y-4">
          <p className="text-sm text-base-content/60">
            Choose a provider from the catalog to create a new instance.
          </p>

          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card bg-base-100 shadow-sm">
                  <div className="card-body py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="h-4 bg-base-300 rounded animate-pulse mb-2"></div>
                        <div className="h-3 bg-base-300 rounded animate-pulse w-2/3"></div>
                      </div>
                      <div className="h-5 bg-base-300 rounded animate-pulse w-16"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 max-h-96 overflow-y-auto">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow text-left"
                  onClick={() => handleProviderSelect(provider)}
                >
                  <div className="card-body py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">{provider.name}</h4>
                        <p className="text-xs text-base-content/60">
                          {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}{' '}
                          available
                        </p>
                      </div>
                      <Badge variant="outline" size="sm">
                        {provider.type}
                      </Badge>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">
              <span className="label-text">Instance Name *</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="My OpenAI Instance"
              required
            />
            <div className="label">
              <span className="label-text-alt">Give this instance a descriptive name</span>
            </div>
          </div>

          <div>
            <label className="label">
              <span className="label-text">API Key *</span>
            </label>
            <input
              type="password"
              className="input input-bordered w-full"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder="sk-..."
              required
            />
            <div className="label">
              <span className="label-text-alt">Your API key will be stored securely</span>
            </div>
          </div>

          <div>
            <label className="label">
              <span className="label-text">Provider</span>
            </label>
            <div className="flex items-center space-x-2">
              <Badge variant="primary" size="sm">
                {selectedProvider?.name}
              </Badge>
              <span className="text-sm text-base-content/60">from catalog</span>
            </div>
          </div>

          <div>
            <label className="label">
              <span className="label-text">Custom Endpoint</span>
            </label>
            <input
              type="url"
              className="input input-bordered w-full"
              value={formData.endpoint}
              onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
              placeholder={selectedProvider?.api_endpoint || 'Leave empty to use default'}
            />
            <div className="label">
              <span className="label-text-alt">Optional: Override the default API endpoint</span>
            </div>
          </div>

          <div>
            <label className="label">
              <span className="label-text">Timeout (seconds)</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              value={formData.timeout / 1000}
              onChange={(e) =>
                setFormData({ ...formData, timeout: parseInt(e.target.value) * 1000 })
              }
              min={5}
              max={300}
            />
          </div>

          {selectedProvider && (
            <div className="bg-base-200 p-3 rounded-lg">
              <p className="text-sm font-medium mb-1">This will enable access to:</p>
              <div className="text-xs text-base-content/60 space-y-1">
                {selectedProvider.models.slice(0, 3).map((model) => (
                  <div key={model.id}>
                    • {model.name} ({model.context_window / 1000}K context)
                  </div>
                ))}
                {selectedProvider.models.length > 3 && (
                  <div>
                    • And {selectedProvider.models.length - 3} more model
                    {selectedProvider.models.length - 3 !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            {!preselectedProvider && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStep('select')}
                disabled={submitting}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary vapor-button" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Creating...
                </>
              ) : (
                'Create Instance'
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
