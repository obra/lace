// ABOUTME: Modal for adding new MCP servers with command configuration and validation
// ABOUTME: Provides form inputs for server command, args, and environment with real-time validation

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faServer, faPlus } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import type { MCPServerConfig } from '@/types/core';

interface AddMCPServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddServer: (serverId: string, config: MCPServerConfig) => void;
  loading?: boolean;
}

interface NewServerData {
  id: string;
  command: string;
  args: string;
  env: string;
  cwd: string;
  enabled: boolean;
}

const commonServers = [
  {
    id: 'filesystem',
    label: 'Filesystem Server',
    command: 'npx',
    args: '@modelcontextprotocol/server-filesystem',
    description: 'Read and write files',
  },
  {
    id: 'git',
    label: 'Git Server',
    command: 'npx',
    args: '@modelcontextprotocol/server-git',
    description: 'Git operations',
  },
  {
    id: 'sqlite',
    label: 'SQLite Server',
    command: 'npx',
    args: '@modelcontextprotocol/server-sqlite',
    description: 'Database operations',
  },
];

export function AddMCPServerModal({
  isOpen,
  onClose,
  onAddServer,
  loading = false,
}: AddMCPServerModalProps) {
  const [serverData, setServerData] = useState<NewServerData>({
    id: '',
    command: '',
    args: '',
    env: '',
    cwd: '',
    enabled: true,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const idInputRef = useRef<HTMLInputElement>(null);

  // Focus the ID input when modal opens
  useEffect(() => {
    if (isOpen && idInputRef.current) {
      const timer = setTimeout(() => {
        idInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setServerData({
        id: '',
        command: '',
        args: '',
        env: '',
        cwd: '',
        enabled: true,
      });
      setErrors({});
      setSelectedPreset('');
    }
  }, [isOpen]);

  const handleInputChange = (field: keyof NewServerData, value: string | boolean) => {
    setServerData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handlePresetSelect = (presetId: string) => {
    const preset = commonServers.find((s) => s.id === presetId);
    if (preset) {
      setServerData((prev) => ({
        ...prev,
        id: preset.id,
        command: preset.command,
        args: preset.args,
      }));
      setSelectedPreset(presetId);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!serverData.id.trim()) {
      newErrors.id = 'Server ID is required';
    } else if (!/^[a-z0-9-]+$/.test(serverData.id)) {
      newErrors.id = 'Server ID can only contain lowercase letters, numbers, and hyphens';
    }

    if (!serverData.command.trim()) {
      newErrors.command = 'Command is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    // Parse args and env
    const args = serverData.args.trim() ? serverData.args.split(' ').filter(Boolean) : undefined;
    const env = serverData.env.trim()
      ? Object.fromEntries(
          serverData.env
            .split('\n')
            .filter((line) => line.includes('='))
            .map((line) => {
              const [key, ...valueParts] = line.split('=');
              return [key.trim(), valueParts.join('=').trim()];
            })
        )
      : undefined;

    const config: MCPServerConfig = {
      command: serverData.command.trim(),
      args,
      env,
      cwd: serverData.cwd.trim() || undefined,
      enabled: serverData.enabled,
      tools: {}, // Start with empty tools, discovery will populate
    };

    onAddServer(serverData.id.trim(), config);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add MCP Server" size="lg" className="max-w-2xl">
      <div className="space-y-6">
        {/* Common Servers */}
        <div>
          <label className="text-sm font-medium mb-3 block">Quick Setup</label>
          <div className="grid grid-cols-1 gap-3">
            {commonServers.map((server) => (
              <button
                key={server.id}
                type="button"
                className={`p-4 text-left rounded-lg border transition-colors ${
                  selectedPreset === server.id
                    ? 'border-primary bg-primary/5'
                    : 'border-base-300 hover:border-base-400'
                }`}
                onClick={() => handlePresetSelect(server.id)}
              >
                <div className="font-medium">{server.label}</div>
                <div className="text-sm text-base-content/70 mt-1">{server.description}</div>
                <code className="text-xs bg-base-200 px-2 py-1 rounded mt-2 inline-block">
                  {server.command} {server.args}
                </code>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Configuration */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Server ID</label>
            <input
              ref={idInputRef}
              type="text"
              className={`input input-bordered w-full ${errors.id ? 'input-error' : ''}`}
              placeholder="my-server"
              value={serverData.id}
              onChange={(e) => handleInputChange('id', e.target.value)}
            />
            {errors.id && <div className="text-error text-sm mt-1">{errors.id}</div>}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Command</label>
            <input
              type="text"
              className={`input input-bordered w-full ${errors.command ? 'input-error' : ''}`}
              placeholder="npx"
              value={serverData.command}
              onChange={(e) => handleInputChange('command', e.target.value)}
            />
            {errors.command && <div className="text-error text-sm mt-1">{errors.command}</div>}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Arguments</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="@modelcontextprotocol/server-filesystem /path/to/files"
              value={serverData.args}
              onChange={(e) => handleInputChange('args', e.target.value)}
            />
            <div className="text-xs text-base-content/60 mt-1">
              Space-separated arguments for the command
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Environment Variables</label>
            <textarea
              className="textarea textarea-bordered w-full"
              placeholder={`API_KEY=your-key\nDEBUG=true`}
              value={serverData.env}
              onChange={(e) => handleInputChange('env', e.target.value)}
              rows={3}
            />
            <div className="text-xs text-base-content/60 mt-1">
              One per line in KEY=value format
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Working Directory</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="/path/to/working/directory"
              value={serverData.cwd}
              onChange={(e) => handleInputChange('cwd', e.target.value)}
            />
            <div className="text-xs text-base-content/60 mt-1">
              Optional: Directory to run the server from
            </div>
          </div>

          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox"
                checked={serverData.enabled}
                onChange={(e) => handleInputChange('enabled', e.target.checked)}
              />
              <span className="label-text">Enable server</span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t border-base-300">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading && <span className="loading loading-spinner loading-sm"></span>}
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
            Add Server
          </button>
        </div>
      </div>
    </Modal>
  );
}
