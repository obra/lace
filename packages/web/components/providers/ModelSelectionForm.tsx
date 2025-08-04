// ABOUTME: Model selection component for session creation
// ABOUTME: Shows available models from selected provider instance with pricing

'use client';

import { useState, useEffect } from 'react';
import Badge from '@/components/ui/Badge';
import StatusDot from '@/components/ui/StatusDot';
import { parseResponse } from '@/lib/serialization';

interface Model {
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

interface ProviderInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  hasCredentials: boolean;
  status?: 'connected' | 'error' | 'untested';
}

interface ModelSelectionFormProps {
  onSelectionChange: (instanceId: string, modelId: string) => void;
  selectedInstanceId?: string;
  selectedModelId?: string;
  className?: string;
}

export function ModelSelectionForm({ 
  onSelectionChange, 
  selectedInstanceId = '',
  selectedModelId = '',
  className = ''
}: ModelSelectionFormProps) {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInstances();
  }, []);

  useEffect(() => {
    if (selectedInstanceId) {
      loadModelsForInstance(selectedInstanceId);
    } else {
      setAvailableModels([]);
    }
  }, [selectedInstanceId, instances]);

  const loadInstances = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/provider/instances');
      
      if (!response.ok) {
        throw new Error(`Failed to load instances: ${response.status}`);
      }
      
      const data = await parseResponse<{ instances: ProviderInstance[] }>(response);
      // Only show instances with credentials
      const configuredInstances = data.instances.filter(instance => instance.hasCredentials);
      setInstances(configuredInstances);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  };

  const loadModelsForInstance = async (instanceId: string) => {
    try {
      setModelsLoading(true);
      setError(null);
      const response = await fetch(`/api/provider/catalog`);
      
      if (!response.ok) {
        throw new Error(`Failed to load models: ${response.status}`);
      }
      
      const data = await parseResponse<{ providers: Array<{ id: string; models: Model[] }> }>(response);
      
      // Find the instance and get its catalog provider
      const instance = instances.find(inst => inst.id === instanceId);
      if (instance) {
        const catalogProvider = data.providers.find(p => p.id === instance.catalogProviderId);
        setAvailableModels(catalogProvider?.models || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleInstanceChange = (instanceId: string) => {
    setAvailableModels([]);
    if (instanceId && selectedModelId) {
      // Clear model selection when instance changes
      onSelectionChange(instanceId, '');
    } else if (instanceId) {
      onSelectionChange(instanceId, selectedModelId);
    }
  };

  const handleModelChange = (modelId: string) => {
    if (selectedInstanceId && modelId) {
      onSelectionChange(selectedInstanceId, modelId);
    }
  };

  const getStatusIcon = (instance: ProviderInstance) => {
    const status = instance.status || 'untested';
    switch (status) {
      case 'connected': return <StatusDot status="success" size="sm" />;
      case 'error': return <StatusDot status="error" size="sm" />;
      default: return <StatusDot status="warning" size="sm" />;
    }
  };

  const formatPrice = (price: number) => {
    if (price === 0) return 'Free';
    if (price < 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(0)}`;
  };

  const getSelectedModel = () => {
    return availableModels.find(m => m.id === selectedModelId);
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="space-y-2">
          <div className="h-4 bg-base-300 rounded animate-pulse w-24"></div>
          <div className="h-12 bg-base-300 rounded animate-pulse"></div>
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-base-300 rounded animate-pulse w-20"></div>
          <div className="h-32 bg-base-300 rounded animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`alert alert-error ${className}`}>
        <span>Error: {error}</span>
        <button className="btn btn-sm btn-ghost" onClick={loadInstances}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <label className="label">
          <span className="label-text font-medium">Provider Instance</span>
        </label>
        <select 
          className="select select-bordered w-full"
          value={selectedInstanceId}
          onChange={(e) => handleInstanceChange(e.target.value)}
        >
          <option value="">Select provider instance</option>
          {instances.map(instance => (
            <option key={instance.id} value={instance.id}>
              {instance.displayName}
            </option>
          ))}
        </select>
        
        {selectedInstanceId && (
          <div className="flex items-center space-x-2 mt-2">
            {(() => {
              const instance = instances.find(inst => inst.id === selectedInstanceId);
              return instance ? (
                <>
                  {getStatusIcon(instance)}
                  <span className="text-xs text-base-content/60">
                    {instance.status === 'connected' ? 'Connected' : 
                     instance.status === 'error' ? 'Connection Error' : 'Untested'} • 
                    {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available
                  </span>
                </>
              ) : null;
            })()}
          </div>
        )}
      </div>

      {instances.length === 0 && (
        <div className="alert alert-info">
          <span>No provider instances configured. </span>
          <a href="/providers" className="link">Configure providers</a>
        </div>
      )}

      {selectedInstanceId && availableModels.length > 0 && (
        <div>
          <label className="label">
            <span className="label-text font-medium">Model</span>
          </label>
          
          {modelsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-base-300 rounded animate-pulse"></div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {availableModels.map(model => (
                <label key={model.id} className="cursor-pointer">
                  <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-base-200 transition-colors">
                    <input
                      type="radio"
                      name="model"
                      value={model.id}
                      checked={selectedModelId === model.id}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="radio radio-primary radio-sm"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{model.name}</span>
                        <div className="flex items-center space-x-2">
                          <Badge variant="primary" size="xs">
                            {formatPrice(model.cost_per_1m_in)}/{formatPrice(model.cost_per_1m_out)}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-base-content/60 mt-1 space-x-3">
                        <span>{Math.floor(model.context_window / 1000)}K context</span>
                        {model.can_reason && <span>• Reasoning</span>}
                        {model.supports_attachments && <span>• Attachments</span>}
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {selectedModelId && getSelectedModel() && (
            <div className="bg-info/20 p-3 rounded-lg mt-4">
              <div className="text-sm">
                <div className="font-medium">
                  Estimated cost: ~{formatPrice(getSelectedModel()!.cost_per_1m_in * 10 + getSelectedModel()!.cost_per_1m_out * 5)} per conversation
                </div>
                <div className="text-xs text-base-content/60 mt-1">
                  Based on typical usage patterns (10K input, 5K output tokens)
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}