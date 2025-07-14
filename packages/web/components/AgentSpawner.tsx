// ABOUTME: Agent creation interface for spawning new agents in a session
// ABOUTME: Allows provider/model selection and agent naming

import React, { useState } from 'react';
import { Agent, CreateAgentRequest, ThreadId } from '@/types/api';
import { useSessionAPI } from '@/hooks/useSessionAPI';

interface AgentSpawnerProps {
  sessionId: ThreadId;
  agents: Agent[];
  onAgentSpawn: (agent: Agent) => void;
}

const PROVIDERS = [
  { name: 'anthropic', models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'] },
  { name: 'openai', models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
];

export function AgentSpawner({ sessionId, agents, onAgentSpawn }: AgentSpawnerProps) {
  const [showForm, setShowForm] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-3-haiku-20240307');
  const { spawnAgent, loading, error } = useSessionAPI();

  const currentProvider = PROVIDERS.find(p => p.name === provider);
  const availableModels = currentProvider?.models || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!agentName.trim()) return;

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
          
          <div className="flex gap-2">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                const newProvider = PROVIDERS.find(p => p.name === e.target.value);
                if (newProvider && newProvider.models.length > 0) {
                  setModel(newProvider.models[0]);
                }
              }}
              className="flex-1 px-3 py-1 bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-terminal-green text-sm"
              disabled={loading}
            >
              {PROVIDERS.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>

            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-1 px-3 py-1 bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-terminal-green text-sm"
              disabled={loading}
            >
              {availableModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || !agentName.trim()}
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