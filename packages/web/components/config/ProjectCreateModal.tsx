// ABOUTME: Modal component for creating new projects with wizard interface
// ABOUTME: Handles project creation form with simplified and advanced modes

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { GlassCard } from '@/components/ui/GlassCard';
import { AccentButton } from '@/components/ui/AccentButton';
import { DirectoryField } from '@/components/ui';
import type { ProviderInfo } from '@/types/api';

interface ProjectConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  [key: string]: unknown;
}

interface ProjectCreateModalProps {
  isOpen: boolean;
  providers: ProviderInfo[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (projectData: {
    name: string;
    description?: string;
    workingDirectory: string;
    configuration: ProjectConfiguration;
  }) => Promise<void>;
  onAddProvider: () => void;
}

const AVAILABLE_TOOLS = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_find',
  'url_fetch',
  'ripgrep_search',
  'file_insert',
  'delegate',
  'task_add',
  'task_list',
  'task_complete',
  'task_update',
  'task_add_note',
  'task_view',
];

const DEFAULT_PROJECT_CONFIG: ProjectConfiguration = {
  maxTokens: 4096,
  tools: AVAILABLE_TOOLS,
  toolPolicies: {},
  environmentVariables: {},
};

export function ProjectCreateModal({
  isOpen,
  providers,
  loading,
  onClose,
  onSubmit,
  onAddProvider,
}: ProjectCreateModalProps) {
  const [createStep, setCreateStep] = useState<number>(2);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createWorkingDirectory, setCreateWorkingDirectory] = useState('');
  const [createConfig, setCreateConfig] = useState<ProjectConfiguration>(DEFAULT_PROJECT_CONFIG);
  const [createNewEnvKey, setCreateNewEnvKey] = useState('');
  const [createNewEnvValue, setCreateNewEnvValue] = useState('');
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showDirHelp, setShowDirHelp] = useState(false);
  const [showProviderHelp, setShowProviderHelp] = useState(false);

  const isSimplifiedMode = !showAdvancedOptions;

  // Get available providers (only those that are configured with instance IDs)
  const availableProviders = useMemo(() => {
    return (providers || []).filter((p): p is ProviderInfo & { instanceId: string } =>
      Boolean(p.configured && p.instanceId)
    );
  }, [providers]);

  // Get available models for project creation
  const availableCreateModels = useMemo(() => {
    const provider = providers.find((p) => p.instanceId === createConfig.providerInstanceId);
    return provider?.models || [];
  }, [providers, createConfig.providerInstanceId]);

  // Initialize with first available provider instance
  useEffect(() => {
    if (availableProviders.length > 0 && !createConfig.providerInstanceId) {
      const firstProvider = availableProviders[0];
      setCreateConfig((prev) => ({
        ...prev,
        providerInstanceId: firstProvider.instanceId,
        modelId: firstProvider.models[0]?.id || '',
      }));
    }
  }, [availableProviders, createConfig.providerInstanceId]);

  // When the modal opens, start at step 2 (Directory)
  useEffect(() => {
    if (isOpen) {
      setCreateStep(2);
    }
  }, [isOpen]);

  // Reset state when modal closes
  const handleClose = () => {
    setCreateName('');
    setCreateDescription('');
    setCreateWorkingDirectory('');
    setCreateConfig(DEFAULT_PROJECT_CONFIG);
    setCreateNewEnvKey('');
    setCreateNewEnvValue('');
    setShowAdvancedOptions(false);
    setShowDirHelp(false);
    setShowProviderHelp(false);
    setCreateStep(2);
    onClose();
  };

  // Auto-populate name from directory in simplified mode
  const handleCreateDirectoryChange = (directory: string) => {
    setCreateWorkingDirectory(directory);

    if (isSimplifiedMode) {
      const baseName =
        directory
          .replace(/[/\\]+$/, '')
          .split(/[/\\]/)
          .pop() || '';
      if (baseName) {
        setCreateName(baseName);
      }
    }
  };

  // Handle create project environment variables
  const handleAddCreateEnvironmentVariable = () => {
    if (!createNewEnvKey.trim() || !createNewEnvValue.trim()) return;

    setCreateConfig((prev) => ({
      ...prev,
      environmentVariables: {
        ...prev.environmentVariables,
        [createNewEnvKey.trim()]: createNewEnvValue.trim(),
      },
    }));

    setCreateNewEnvKey('');
    setCreateNewEnvValue('');
  };

  const handleRemoveCreateEnvironmentVariable = (key: string) => {
    setCreateConfig((prev) => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  // Handle create project tool policy changes
  const handleCreateToolPolicyChange = (
    tool: string,
    policy: 'allow' | 'require-approval' | 'deny'
  ) => {
    setCreateConfig((prev) => ({
      ...prev,
      toolPolicies: {
        ...prev.toolPolicies,
        [tool]: policy,
      },
    }));
  };

  // Handle project creation
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !createWorkingDirectory.trim()) return;

    await onSubmit({
      name: createName.trim(),
      description: createDescription.trim() || undefined,
      workingDirectory: createWorkingDirectory.trim(),
      configuration: createConfig,
    });

    handleClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Project"
      size="xl"
      className="max-h-[90vh] flex flex-col"
    >
      <form onSubmit={handleCreateProject} className="flex flex-col max-h-[80vh]">
        <div className="flex-1 overflow-y-auto px-1 space-y-6">
          {isSimplifiedMode ? (
            // Simplified Mode Wizard
            <>
              {createStep === 2 && (
                <GlassCard className="p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-semibold">Set project directory</h4>
                    <button
                      type="button"
                      className="btn btn-accent btn-xs btn-circle text-base-100 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                      aria-label="Show directory tips"
                      onClick={() => setShowDirHelp((v) => !v)}
                      title={showDirHelp ? 'Hide tips' : 'Show tips'}
                      aria-expanded={showDirHelp}
                    >
                      i
                    </button>
                  </div>
                  <DirectoryField
                    label="Directory path"
                    value={createWorkingDirectory}
                    onChange={handleCreateDirectoryChange}
                    placeholder="/path/to/your/project"
                    required
                    className="input-lg focus:outline-none focus:ring-2 focus:ring-accent/60"
                  />
                  {createWorkingDirectory.trim() &&
                    !createWorkingDirectory.trim().startsWith('/') && (
                      <p className="mt-2 text-sm text-error">
                        Please paste an absolute path starting with &quot;/&quot;.
                      </p>
                    )}
                  {showDirHelp && (
                    <div className="collapse mt-3 text-sm text-base-content/60 space-y-2">
                      <input type="checkbox" checked readOnly />
                      <div className="collapse-title font-medium">How to copy the full path</div>
                      <div className="collapse-content">
                        <ul className="list-disc pl-5 space-y-1">
                          <li>
                            macOS Finder: hold <kbd>Option</kbd>, right‑click the folder → Copy
                            &quot;<i>name</i>&quot; as Pathname
                          </li>
                          <li>
                            Terminal: drag the folder into the Terminal window to paste its absolute
                            path
                          </li>
                        </ul>
                        <p className="font-medium">Tips</p>
                        <ul className="list-disc pl-5 space-y-1">
                          <li>
                            Pick the repository root (where your package.json, pyproject.toml, or
                            .git lives)
                          </li>
                          <li>You can change this later in Project Settings</li>
                        </ul>
                      </div>
                    </div>
                  )}
                  {isSimplifiedMode && (
                    <div className="mt-4 grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="label">
                          <span className="label-text font-medium">Project Name</span>
                        </label>
                        <input
                          type="text"
                          value={createName}
                          className="input input-bordered w-full focus:outline-none focus:ring-2 focus:ring-accent/60"
                          readOnly
                        />
                      </div>
                    </div>
                  )}
                </GlassCard>
              )}

              {createStep === 3 && (
                <GlassCard className="p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-semibold">Set default AI provider</h4>
                    <button
                      type="button"
                      className="btn btn-accent btn-xs btn-circle text-base-100 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
                      aria-label="Show provider tips"
                      onClick={() => setShowProviderHelp((v) => !v)}
                      title={showProviderHelp ? 'Hide tips' : 'Show tips'}
                      aria-expanded={showProviderHelp}
                    >
                      i
                    </button>
                  </div>

                  {availableProviders.length === 0 ? (
                    // No providers available - show model selection prompt
                    <div>
                      <div className="mb-4">
                        <button
                          type="button"
                          onClick={onAddProvider}
                          className="w-full p-4 border-2 border-dashed border-base-300 rounded-lg hover:border-primary hover:bg-primary/5 transition-all text-left"
                        >
                          <div className="text-base font-medium text-base-content">
                            Select an AI model
                          </div>
                          <div className="text-sm text-base-content/60 mt-1">
                            Choose from OpenAI, Anthropic, local models, and more
                          </div>
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Providers available - show selection dropdowns
                    <>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="label">
                            <span className="label-text font-medium">Provider</span>
                          </label>
                          <select
                            className="select select-bordered w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            value={createConfig.providerInstanceId || ''}
                            onChange={(e) => {
                              const newInstanceId = e.target.value;
                              const provider = providers.find(
                                (p) => p.instanceId === newInstanceId
                              );
                              const providerModels = provider?.models || [];
                              setCreateConfig((prev) => ({
                                ...prev,
                                providerInstanceId: newInstanceId,
                                modelId: providerModels[0]?.id || prev.modelId,
                              }));
                            }}
                          >
                            {availableProviders.map((p) => (
                              <option key={p.instanceId} value={p.instanceId}>
                                {p.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">
                            <span className="label-text font-medium">Model</span>
                          </label>
                          <select
                            className="select select-bordered w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            value={createConfig.modelId || ''}
                            onChange={(e) =>
                              setCreateConfig((prev) => ({
                                ...prev,
                                modelId: e.target.value,
                              }))
                            }
                          >
                            {availableCreateModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.displayName || m.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={onAddProvider}
                          className="btn btn-link text-sm text-base-content/70 no-underline p-0 h-auto min-h-0"
                        >
                          <FontAwesomeIcon icon={faPlus} className="w-3 h-3 mr-2" />
                          Add more providers
                        </button>
                      </div>
                    </>
                  )}

                  {/* Help section */}
                  {showProviderHelp && (
                    <div className="mt-4 text-sm text-base-content/70 space-y-2">
                      <p className="font-medium">What this does</p>
                      <p>
                        Sets the default AI for this project. You can override per session or task
                        later.
                      </p>
                      {availableProviders.length > 0 ? (
                        <>
                          <p className="font-medium">Choosing a model</p>
                          <ul className="list-disc pl-5 space-y-1">
                            <li>Pick a balanced model (good quality + speed) to start</li>
                            <li>
                              Use larger models for complex refactors; smaller models for quick
                              edits
                            </li>
                          </ul>
                        </>
                      ) : (
                        <>
                          <p className="font-medium">Getting started</p>
                          <p>
                            Click &quot;Select an AI model&quot; to add a provider and choose your
                            preferred model. You can add multiple providers and switch between them
                            later.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </GlassCard>
              )}

              {createStep === 4 && (
                <GlassCard className="p-6">
                  <h4 className="text-lg font-semibold mb-2">Review</h4>
                  <p className="text-sm text-base-content/70 mb-3">
                    Review your project settings. Go back to make changes.
                  </p>
                  <div>
                    <div>
                      <span className="font-medium">Name:</span> {createName || '(from directory)'}
                    </div>
                    <div>
                      <span className="font-medium">Directory:</span> {createWorkingDirectory}
                    </div>
                    <div>
                      <span className="font-medium">Provider:</span>{' '}
                      {providers.find((p) => p.instanceId === createConfig.providerInstanceId)
                        ?.displayName || '—'}
                    </div>
                    <div>
                      <span className="font-medium">Model:</span> {createConfig.modelId || '—'}
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* Bottom footer: back, step indicators, primary action */}
              <div className="mt-auto flex justify-between items-center pt-4">
                <div>
                  {createStep > 2 && (
                    <button
                      type="button"
                      className="btn btn-link text-base-content/70 no-underline"
                      onClick={() => setCreateStep(createStep - 1)}
                    >
                      Back
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {createStep >= 3 && (
                    <div className="w-40 h-1.5 rounded-full bg-base-content/20 overflow-hidden">
                      <div
                        className="h-full bg-accent/80 transition-all"
                        style={{ width: `${createStep === 3 ? 66 : 100}%` }}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {createStep === 2 && (
                      <button
                        type="button"
                        className="btn btn-link text-base-content/70 no-underline"
                        onClick={() => setShowAdvancedOptions(true)}
                      >
                        Advanced setup
                      </button>
                    )}
                    {createStep > 1 && createStep < 4 && (
                      <AccentButton
                        type="button"
                        onClick={() => setCreateStep(createStep + 1)}
                        disabled={
                          (createStep === 2 &&
                            !(
                              createWorkingDirectory.trim().startsWith('/') &&
                              createWorkingDirectory.trim().length > 1
                            )) ||
                          (createStep === 3 &&
                            (availableProviders.length === 0 ||
                              !createConfig.providerInstanceId ||
                              !createConfig.modelId))
                        }
                      >
                        Continue
                      </AccentButton>
                    )}
                    {createStep === 4 && (
                      <AccentButton
                        type="submit"
                        disabled={!createWorkingDirectory.trim()}
                        data-testid="create-project-submit"
                      >
                        {loading ? (
                          <>
                            <div className="loading loading-spinner loading-sm"></div>
                            Creating...
                          </>
                        ) : (
                          'Create project'
                        )}
                      </AccentButton>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            // Full Advanced Mode UI
            <>
              {/* Basic Information */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Project Name *</span>
                  </label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="input input-bordered w-full"
                    data-testid="project-name-input"
                    placeholder="Enter project name"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="label">
                    <span className="label-text font-medium">Description</span>
                  </label>
                  <input
                    type="text"
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    className="input input-bordered w-full"
                    placeholder="Optional description"
                  />
                </div>
              </div>

              {/* Working Directory */}
              <DirectoryField
                label="Working Directory *"
                value={createWorkingDirectory}
                onChange={setCreateWorkingDirectory}
                placeholder="/path/to/project"
                required
              />

              {/* Default Provider and Model Configuration */}
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Default Provider</span>
                  </label>
                  <select
                    data-testid="create-project-provider-select"
                    value={createConfig.providerInstanceId || ''}
                    onChange={(e) => {
                      const newInstanceId = e.target.value;
                      const provider = providers.find((p) => p.instanceId === newInstanceId);
                      const providerModels = provider?.models || [];
                      setCreateConfig((prev) => ({
                        ...prev,
                        providerInstanceId: newInstanceId,
                        modelId: providerModels[0]?.id || prev.modelId,
                      }));
                    }}
                    className="select select-bordered w-full"
                  >
                    {availableProviders.map((provider) => (
                      <option key={provider.instanceId} value={provider.instanceId}>
                        {provider.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">
                    <span className="label-text font-medium">Default Model</span>
                  </label>
                  <select
                    data-testid="create-project-model-select"
                    value={createConfig.modelId || ''}
                    onChange={(e) =>
                      setCreateConfig((prev) => ({ ...prev, modelId: e.target.value }))
                    }
                    className="select select-bordered w-full"
                  >
                    {availableCreateModels.length === 0 ? (
                      <option value="">No models available</option>
                    ) : (
                      <>
                        {!createConfig.modelId && <option value="">Select a model</option>}
                        {availableCreateModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Environment Variables */}
              <div>
                <label className="label">
                  <span className="label-text font-medium">Environment Variables</span>
                </label>
                <div className="space-y-2">
                  {Object.entries(createConfig.environmentVariables || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={key}
                        className="input input-bordered input-sm flex-1"
                        readOnly
                      />
                      <span className="text-base-content/60">=</span>
                      <input
                        type="text"
                        value={value}
                        className="input input-bordered input-sm flex-1"
                        readOnly
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveCreateEnvironmentVariable(key)}
                        className="btn btn-error btn-sm btn-square"
                      >
                        <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={createNewEnvKey}
                      onChange={(e) => setCreateNewEnvKey(e.target.value)}
                      className="input input-bordered input-sm flex-1"
                      placeholder="Key"
                    />
                    <span className="text-base-content/60">=</span>
                    <input
                      type="text"
                      value={createNewEnvValue}
                      onChange={(e) => setCreateNewEnvValue(e.target.value)}
                      className="input input-bordered input-sm flex-1"
                      placeholder="Value"
                    />
                    <button
                      type="button"
                      onClick={handleAddCreateEnvironmentVariable}
                      className="btn btn-primary btn-sm"
                      disabled={!createNewEnvKey.trim() || !createNewEnvValue.trim()}
                    >
                      <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Tool Access Policies */}
              <div>
                <label className="label">
                  <span className="label-text font-medium">Tool Access Policies</span>
                </label>
                <div className="grid md:grid-cols-2 gap-3">
                  {AVAILABLE_TOOLS.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
                    >
                      <span className="font-medium text-sm">{tool}</span>
                      <select
                        value={createConfig.toolPolicies?.[tool] || 'require-approval'}
                        onChange={(e) =>
                          handleCreateToolPolicyChange(
                            tool,
                            e.target.value as 'allow' | 'require-approval' | 'deny'
                          )
                        }
                        className="select select-bordered select-sm w-40"
                      >
                        <option value="allow">Allow</option>
                        <option value="require-approval">Require Approval</option>
                        <option value="deny">Deny</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Actions (Advanced mode only) */}
        {!isSimplifiedMode && (
          <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
            <button type="button" onClick={handleClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="create-project-submit"
              disabled={!createName.trim() || !createWorkingDirectory.trim() || loading}
            >
              {loading ? (
                <>
                  <div className="loading loading-spinner loading-sm"></div>
                  Creating...
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
