// ABOUTME: Agent creation interface for spawning new agents in a session
// ABOUTME: Uses dynamic provider/model discovery API instead of hardcoded lists

import React, { useState, useEffect } from 'react';
import { Agent, CreateAgentRequest, ThreadId } from '@/types/api';
import { useSessionAPI } from '@/hooks/useSessionAPI';
import type { ProviderWithModels, ProvidersResponse } from '@/app/api/providers/route';

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

export function AgentSpawner({ sessionId, agents, onAgentSpawn }: AgentSpawnerProps) {
  const [showForm, setShowForm] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const { spawnAgent, loading, error } = useSessionAPI();

  // Load providers on mount
  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    try {
      const res = await fetch('/api/providers');
      const data: ProvidersResponse = await res.json();
      setProviders(data.providers);
      
      // Build model options
      const options: ModelOption[] = [];
      let defaultOption: string | null = null;
      
      data.providers.forEach(provider => {
        if (!provider.configured) {
          // Add disabled option for unconfigured provider
          options.push({
            value: '',
            label: `${provider.displayName} (Not Configured)`,
            description: provider.configurationHint,
            disabled: true,
          });
        } else {
          // Add all models from configured provider
          provider.models.forEach(model => {
            const value = `${provider.name}/${model.id}`;
            options.push({
              value,
              label: `${provider.displayName} - ${model.displayName}`,
              description: model.description,
              isDefault: model.isDefault,
              disabled: false,
            });
            
            if (model.isDefault && !defaultOption) {
              defaultOption = value;
            }
          });
        }
      });
      
      setModelOptions(options);
      
      // Set default selection
      if (defaultOption) {
        setSelectedModel(defaultOption);
      } else if (options.length > 0 && !options[0].disabled) {
        setSelectedModel(options[0].value);
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!agentName.trim() || !selectedModel) return;

    const [provider, model] = selectedModel.split('/');
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

  const selectedOption = modelOptions.find(opt => opt.value === selectedModel);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-400">Agents</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
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
          />
          
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-1 bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-terminal-green text-sm"
            disabled={loading || modelOptions.length === 0}
          >
            {modelOptions.length === 0 && (
              <option value="">Loading providers...</option>
            )}
            {modelOptions.map((option, idx) => (
              <option 
                key={idx} 
                value={option.value} 
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>

          {selectedOption?.description && (
            <p className="text-xs text-gray-500 px-1">
              {selectedOption.description}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !agentName.trim() || !selectedModel}
            className="w-full px-3 py-1 bg-terminal-purple text-black rounded hover:bg-terminal-purple/80 transition-colors disabled:opacity-50 text-sm"
          >
            {loading ? 'Spawning...' : 'Spawn Agent'}
          </button>

          {error && (
            <p className="text-terminal-red text-xs">{error}</p>
          )}
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {agents.map((agent) => (
          <div
            key={agent.threadId}
            className="px-3 py-1 bg-gray-800 rounded text-sm flex items-center gap-2"
          >
            <span className="font-medium">{agent.name}</span>
            <span className={`text-xs ${getStatusColor(agent.status)}`}>
              {agent.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStatusColor(status: Agent['status']): string {
  switch (status) {
    case 'idle': return 'status-idle';
    case 'thinking': return 'status-thinking';
    case 'streaming': return 'status-streaming';
    case 'tool_execution': return 'status-tool-execution';
    default: return 'text-gray-500';
  }
}