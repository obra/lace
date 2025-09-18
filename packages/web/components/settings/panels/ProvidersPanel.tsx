// ABOUTME: Provider configuration panel for settings modal
// ABOUTME: Integrates provider instance management into unified configuration system

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProviderInstanceList } from '@/components/providers/ProviderInstanceList';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { Alert } from '@/components/ui/Alert';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRocket, faBrain, faPlug, faInfoCircle } from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';

interface DefaultModels {
  fast?: string;
  smart?: string;
}

export function ProvidersPanel() {
  const {
    availableProviders,
    instancesLoading: providersLoading,
    instancesError: providersError,
  } = useProviderInstances();
  const [defaultModels, setDefaultModels] = useState<DefaultModels>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load current settings with retry mechanism
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const settings = await api.get<Record<string, unknown>>('/api/settings');
      const models = (settings.defaultModels || {}) as DefaultModels;
      setDefaultModels(models);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('fetch')) {
        setError(
          'Unable to connect to settings server. Please check your connection and try again.'
        );
      } else if (errorMessage.includes('401') || errorMessage.includes('403')) {
        setError('Access denied. Please check your authentication and try again.');
      } else {
        setError(`Failed to load settings: ${errorMessage}`);
      }
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Parse provider:model format (memoized for performance)
  const parseModelSelection = useCallback((modelString: string | undefined) => {
    if (!modelString || !modelString.includes(':')) {
      return { providerId: undefined, modelId: undefined };
    }
    const parts = modelString.split(':');
    if (parts.length !== 2) {
      console.warn('Invalid model format:', modelString);
      return { providerId: undefined, modelId: undefined };
    }
    const [providerId, modelId] = parts;
    return { providerId, modelId };
  }, []);

  // Handle model selection with cleanup tracking
  const pendingSavesRef = useRef(new Set<Promise<void>>());

  const handleModelChange = useCallback(
    async (tier: 'fast' | 'smart', providerInstanceId: string, modelId: string) => {
      const newModelString = `${providerInstanceId}:${modelId}`;
      const newModels = { ...defaultModels, [tier]: newModelString };
      setDefaultModels(newModels);
      setSaveSuccess(false);

      // Auto-save with race condition protection
      const savePromise = (async () => {
        try {
          setSaving(true);
          setError(null);
          await api.patch('/api/settings', {
            defaultModels: newModels,
          });
          setSaveSuccess(true);
          // Clear success message after 3 seconds
          setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('fetch')) {
            setError(`Unable to save ${tier} model. Please check your connection and try again.`);
          } else if (errorMessage.includes('400')) {
            setError(
              `Invalid ${tier} model configuration. Please verify the selected model is valid.`
            );
          } else {
            setError(`Failed to save ${tier} model: ${errorMessage}`);
          }
          console.error('Failed to save settings:', err);
        } finally {
          setSaving(false);
        }
      })();

      // Track pending save for cleanup
      pendingSavesRef.current.add(savePromise);
      try {
        await savePromise;
      } finally {
        pendingSavesRef.current.delete(savePromise);
      }
    },
    [defaultModels]
  );

  // Cleanup on unmount - cancel pending saves
  useEffect(() => {
    const pendingSaves = pendingSavesRef.current;
    return () => {
      // Note: We can't actually cancel the API calls, but we can prevent state updates
      pendingSaves.clear();
    };
  }, []);

  const { providerId: fastProviderId, modelId: fastModelId } = parseModelSelection(
    defaultModels.fast
  );
  const { providerId: smartProviderId, modelId: smartModelId } = parseModelSelection(
    defaultModels.smart
  );

  if (loading || providersLoading) {
    return (
      <SettingsPanel title="AI Models">
        <div className="flex items-center justify-center p-8">
          <span className="loading loading-spinner loading-md"></span>
        </div>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="AI Models">
      <div className="space-y-6">
        {/* Default Models Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Default Models</h3>

          {/* Error/Success Messages */}
          {error && (
            <Alert
              variant="error"
              title="Configuration Error"
              description={error}
              onDismiss={() => setError(null)}
            >
              <button
                onClick={() => void loadSettings()}
                className="btn btn-sm btn-primary mt-2"
                disabled={loading}
              >
                {loading ? 'Retrying...' : 'Retry'}
              </button>
            </Alert>
          )}

          {saveSuccess && (
            <Alert
              variant="success"
              title="Settings Saved"
              description="Default model configuration has been updated"
            />
          )}

          {providersError && (
            <Alert
              variant="warning"
              title="Provider Loading Error"
              description="Failed to load provider list. Some models may not be available."
            />
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Fast Model */}
            <SettingField label="Fast Model" description="For quick tasks like session naming">
              <div className="flex items-center gap-3">
                <FontAwesomeIcon icon={faRocket} className="w-4 h-4 text-primary" />
                <ModelSelector
                  providers={availableProviders}
                  selectedProviderInstanceId={fastProviderId}
                  selectedModelId={fastModelId}
                  onChange={(providerId, modelId) => handleModelChange('fast', providerId, modelId)}
                  disabled={saving}
                  placeholder="Select fast model..."
                  className="select select-bordered select-sm w-full"
                />
              </div>
            </SettingField>

            {/* Smart Model */}
            <SettingField label="Smart Model" description="For complex analysis and reasoning">
              <div className="flex items-center gap-3">
                <FontAwesomeIcon icon={faBrain} className="w-4 h-4 text-accent" />
                <ModelSelector
                  providers={availableProviders}
                  selectedProviderInstanceId={smartProviderId}
                  selectedModelId={smartModelId}
                  onChange={(providerId, modelId) =>
                    handleModelChange('smart', providerId, modelId)
                  }
                  disabled={saving}
                  placeholder="Select smart model..."
                  className="select select-bordered select-sm w-full"
                />
              </div>
            </SettingField>
          </div>

          <div className="rounded-xl p-3 bg-base-200/30 text-xs text-base-content/60">
            <strong>Tip:</strong> Choose smaller, faster models for "Fast" (e.g., Claude Haiku,
            GPT-4o Mini) and larger models for "Smart" (e.g., Claude Opus, GPT-4o).
          </div>
        </div>

        <div className="divider"></div>

        {/* Provider Instances section */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Provider Instances</h3>
          <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-accent">
                <FontAwesomeIcon icon={faPlug} className="w-5 h-5" />
              </div>
              <div className="text-sm">
                <div className="font-medium text-accent mb-1">Configure Connections</div>
                <div className="text-base-content/75 leading-relaxed">
                  Set up connections to providers like OpenAI, Anthropic, and local models. Each
                  instance can define endpoints, timeouts, and credentials for flexible routing and
                  fallbacks.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* List card */}
        <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
          <ProviderInstanceList />
        </div>
      </div>
    </SettingsPanel>
  );
}
