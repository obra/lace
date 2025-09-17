// ABOUTME: Provider configuration panel for settings modal
// ABOUTME: Integrates provider instance management into unified configuration system

'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

  // Load current settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        const settings = await api.get<Record<string, unknown>>('/api/settings');
        const models = (settings.defaultModels || {}) as DefaultModels;
        setDefaultModels(models);
        setError(null);
      } catch (err) {
        setError('Failed to load current settings');
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
  }, []);

  // Parse provider:model format
  const parseModelSelection = (modelString: string | undefined) => {
    if (!modelString || !modelString.includes(':')) {
      return { providerId: undefined, modelId: undefined };
    }
    const [providerId, modelId] = modelString.split(':');
    return { providerId, modelId };
  };

  // Handle model selection
  const handleModelChange = useCallback(
    async (tier: 'fast' | 'smart', providerInstanceId: string, modelId: string) => {
      const newModelString = `${providerInstanceId}:${modelId}`;
      const newModels = { ...defaultModels, [tier]: newModelString };
      setDefaultModels(newModels);
      setSaveSuccess(false);

      // Auto-save
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
        setError(`Failed to save ${tier} model setting`);
        console.error('Failed to save settings:', err);
      } finally {
        setSaving(false);
      }
    },
    [defaultModels]
  );

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
            />
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
