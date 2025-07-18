// ABOUTME: ProjectSettings component for comprehensive project configuration management
// ABOUTME: Provides tabbed interface for general settings, AI configuration, tools, and environment variables

import React, { useState } from 'react';
import { z } from 'zod';
import type { ProjectInfo } from '@/types/api';

interface ProjectWithConfiguration extends ProjectInfo {
  configuration: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    tools?: string[];
    toolPolicies?: Record<string, string>;
    environmentVariables?: Record<string, string>;
  };
}

interface ProjectSettingsProps {
  project: ProjectWithConfiguration;
  onSave: (project: ProjectWithConfiguration) => void;
  onCancel?: () => void;
}

const ProjectSettingsSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Project name is required'),
  description: z.string(),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  isArchived: z.boolean(),
  createdAt: z.date(),
  lastUsedAt: z.date(),
  configuration: z.object({
    provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
    model: z.string().optional(),
    maxTokens: z.number().positive('Max tokens must be positive').max(100000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(z.string()).optional(),
    toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
    environmentVariables: z.record(z.string()).optional(),
  }),
});

export function ProjectSettings({ project, onSave, onCancel }: ProjectSettingsProps) {
  const [formData, setFormData] = useState<ProjectWithConfiguration>(() => ({
    ...project,
    configuration: {
      provider: project.configuration?.provider || '',
      model: project.configuration?.model || '',
      maxTokens: project.configuration?.maxTokens || 4000,
      temperature: project.configuration?.temperature || 0.7,
      tools: project.configuration?.tools || [],
      toolPolicies: project.configuration?.toolPolicies || {},
      environmentVariables: project.configuration?.environmentVariables || {},
    },
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'general' | 'configuration' | 'tools' | 'environment'>('general');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = ProjectSettingsSchema.safeParse(formData);
    
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach(err => {
        const path = err.path.join('.');
        fieldErrors[path] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }
    
    setErrors({});
    onSave(result.data as ProjectWithConfiguration);
  };

  const updateField = (path: string, value: unknown) => {
    setFormData(prev => {
      const updated = { ...prev };
      const keys = path.split('.');
      let current: Record<string, unknown> = updated as Record<string, unknown>;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in current)) {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      
      current[keys[keys.length - 1]] = value;
      return updated;
    });
  };

  const addEnvironmentVariable = () => {
    const key = prompt('Environment variable name:');
    const value = prompt('Environment variable value:');
    
    if (key && value) {
      updateField('configuration.environmentVariables', {
        ...formData.configuration?.environmentVariables,
        [key]: value,
      });
    }
  };

  const removeEnvironmentVariable = (key: string) => {
    const envVars = { ...formData.configuration?.environmentVariables };
    delete envVars[key];
    updateField('configuration.environmentVariables', envVars);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow">
      <h1 className="text-2xl font-bold mb-6">Project Settings</h1>
      
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {[
            { id: 'general', label: 'General' },
            { id: 'configuration', label: 'AI Configuration' },
            { id: 'tools', label: 'Tools & Policies' },
            { id: 'environment', label: 'Environment Variables' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'general' | 'configuration' | 'tools' | 'environment')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* General Settings */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Working Directory
              </label>
              <input
                type="text"
                value={formData.workingDirectory}
                onChange={(e) => updateField('workingDirectory', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {errors.workingDirectory && <p className="text-red-500 text-sm mt-1">{errors.workingDirectory}</p>}
            </div>
          </div>
        )}

        {/* AI Configuration */}
        {activeTab === 'configuration' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provider
                </label>
                <select
                  data-testid="provider-select"
                  value={formData.configuration?.provider || ''}
                  onChange={(e) => updateField('configuration.provider', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Provider</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="lmstudio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model
                </label>
                <select
                  data-testid="model-select"
                  value={formData.configuration?.model || ''}
                  onChange={(e) => updateField('configuration.model', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Model</option>
                  {formData.configuration?.provider === 'anthropic' && (
                    <>
                      <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                      <option value="claude-3-haiku">Claude 3 Haiku</option>
                      <option value="claude-3-opus">Claude 3 Opus</option>
                    </>
                  )}
                  {formData.configuration?.provider === 'openai' && (
                    <>
                      <option value="gpt-4">GPT-4</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={formData.configuration?.maxTokens || ''}
                  onChange={(e) => updateField('configuration.maxTokens', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors['configuration.maxTokens'] && <p className="text-red-500 text-sm mt-1">{errors['configuration.maxTokens']}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={formData.configuration?.temperature || ''}
                  onChange={(e) => updateField('configuration.temperature', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors['configuration.temperature'] && <p className="text-red-500 text-sm mt-1">{errors['configuration.temperature']}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Tools & Policies */}
        {activeTab === 'tools' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Available Tools
              </label>
              <div className="grid grid-cols-3 gap-2">
                {['file-read', 'file-write', 'file-edit', 'file-list', 'bash', 'url-fetch', 'search'].map(tool => (
                  <label key={tool} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.configuration?.tools?.includes(tool) || false}
                      onChange={(e) => {
                        const tools = formData.configuration?.tools || [];
                        if (e.target.checked) {
                          updateField('configuration.tools', [...tools, tool]);
                        } else {
                          updateField('configuration.tools', tools.filter(t => t !== tool));
                          // Also remove from tool policies if unchecked
                          const policies = { ...formData.configuration?.toolPolicies };
                          delete policies[tool];
                          updateField('configuration.toolPolicies', policies);
                        }
                      }}
                      className="mr-2"
                    />
                    {tool}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tool Policies
              </label>
              <div className="space-y-2">
                {(formData.configuration?.tools || []).map(tool => (
                  <div key={tool} className="flex items-center justify-between">
                    <span className="text-sm">{tool}</span>
                    <select
                      data-testid={`tool-policy-${tool}`}
                      value={formData.configuration?.toolPolicies?.[tool] || 'require-approval'}
                      onChange={(e) => {
                        const policies = formData.configuration?.toolPolicies || {};
                        updateField('configuration.toolPolicies', {
                          ...policies,
                          [tool]: e.target.value,
                        });
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="allow">Allow</option>
                      <option value="require-approval">Require Approval</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Environment Variables */}
        {activeTab === 'environment' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Environment Variables
              </label>
              <button
                type="button"
                onClick={addEnvironmentVariable}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Add Variable
              </button>
            </div>

            <div className="space-y-2">
              {Object.entries(formData.configuration?.environmentVariables || {}).map(([key, value]) => (
                <div key={key} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={key}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
                  />
                  <span>=</span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => {
                      const envVars = { ...formData.configuration?.environmentVariables };
                      envVars[key] = e.target.value;
                      updateField('configuration.environmentVariables', envVars);
                    }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvironmentVariable(key)}
                    className="px-2 py-1 text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-6 border-t">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
}