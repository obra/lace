// ABOUTME: Agent creation interface for spawning new agents in a session
// ABOUTME: Uses dynamic provider/model discovery API instead of hardcoded lists

import React, { useState, useEffect } from 'react';
import { Agent, CreateAgentRequest, ThreadId } from '@/types/api';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import type { ProviderWithModels, ProvidersResponse } from '@/app/api/providers/route';
import type { ApiErrorResponse } from '@/types/api';

interface AgentSpawnerProps {
  sessionId: ThreadId;
  agents: Agent[];
  onAgentSpawn: (agent: Agent) => void;
}

interface ModelOption {
  value: string; // provider/model format
  label: string;
  description?: string;
  isDefault?: boolean;
  disabled?: boolean;
}

// Type guard for ProvidersResponse
function isProvidersResponse(data: unknown): data is ProvidersResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'providers' in data &&
    Array.isArray((data as ProvidersResponse).providers)
  );
}

// Type guard for ApiErrorResponse
function isErrorResponse(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as ApiErrorResponse).error === 'string'
  );
}

export function AgentSpawner({ sessionId, agents, onAgentSpawn }: AgentSpawnerProps) {
  const [showForm, setShowForm] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [_providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const { spawnAgent, loading, error } = useSessionAPI();

  // Load providers on mount
  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data: unknown = await res.json();
      
      // Type guard to check if response is an error
      if (isErrorResponse(data)) {
        throw new Error(data.error);
      }
      
      // Type guard to check if response is valid providers response
      if (!isProvidersResponse(data)) {
        throw new Error('Invalid response format from providers API');
      }
      
      setProviders(data.providers);

      // Build model options
      const options: ModelOption[] = [];
      let defaultOption: string | null = null;

      data.providers.forEach((provider) => {
        if (!provider.configured) {
          // Add disabled option for unconfigured provider
          const option: ModelOption = {
            value: '',
            label: `${provider.displayName} (Not Configured)`,
            disabled: true,
          };
          if (provider.configurationHint) {
            option.description = provider.configurationHint;
          }
          options.push(option);
        } else {
          // Add all models from configured provider
          provider.models.forEach((model) => {
            const value = `${provider.name}/${model.id}`;
            const option: ModelOption = {
              value,
              label: `${provider.displayName} - ${model.displayName}`,
              disabled: false,
            };
            
            if (model.description) {
              option.description = model.description;
            }
            
            if (model.isDefault) {
              option.isDefault = model.isDefault;
              if (!defaultOption) {
                defaultOption = value;
              }
            }
            
            options.push(option);
          });
        }
      });

      setModelOptions(options);

      // Set default selection
      if (defaultOption) {
        setSelectedModel(defaultOption);
      } else if (options.length > 0 && !options[0]?.disabled) {
        setSelectedModel(options[0]?.value || '');
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agentName.trim() || !selectedModel) return;

    const [provider, model] = selectedModel.split('/');
    if (!provider || !model) {
      console.error('Invalid model selection');
      return;
    }
    
    const request: CreateAgentRequest = {
      name: agentName.trim(),
      provider,
      model,
    };

    const agent = await spawnAgent(sessionId, request);
    if (agent) {
      onAgentSpawn(agent);
      setAgentName('');
      setShowForm(false);
    }
  };

  const selectedOption = modelOptions.find((opt) => opt.value === selectedModel);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-400">Agents</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
          data-testid="spawn-agent-button"
        >
          {showForm ? 'Cancel' : '+ Add Agent'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 space-y-2">
          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Agent name (e.g., pm, architect)"
            className="w-full px-3 py-1 bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-terminal-green text-sm"
            disabled={loading}
            autoFocus
            data-testid="agent-name-input"
          />

          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-1 bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-terminal-green text-sm"
            disabled={loading || modelOptions.length === 0}
          >
            {modelOptions.length === 0 && <option value="">Loading providers...</option>}
            {modelOptions.map((option, idx) => (
              <option key={idx} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>

          {selectedOption?.description && (
            <p className="text-xs text-gray-500 px-1">{selectedOption.description}</p>
          )}

          <button
            type="submit"
            disabled={loading || !agentName.trim() || !selectedModel}
            className="w-full px-3 py-1 bg-terminal-purple text-black rounded hover:bg-terminal-purple/80 transition-colors disabled:opacity-50 text-sm"
            data-testid="confirm-spawn-agent"
          >
            {loading ? 'Spawning...' : 'Spawn Agent'}
          </button>

          {error && <p className="text-terminal-red text-xs">{error}</p>}
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => (
          <div
            key={String(agent.threadId)}
            className="px-3 py-1 bg-gray-800 rounded text-sm flex items-center gap-2"
          >
            <span className="font-medium">{agent.name}</span>
            <span className="text-xs text-gray-400">{agent.model}</span>
            <span className={`text-xs ${getStatusColor(agent.status)}`}>{agent.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStatusColor(status: Agent['status']): string {
  switch (status) {
    case 'idle':
      return 'status-idle';
    case 'thinking':
      return 'status-thinking';
    case 'streaming':
      return 'status-streaming';
    case 'tool_execution':
      return 'status-tool-execution';
    default:
      return 'text-gray-500';
  }
}
