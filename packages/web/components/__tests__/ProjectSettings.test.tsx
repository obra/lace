// ABOUTME: Tests for ProjectSettings component with comprehensive form validation
// ABOUTME: Tests project settings form UI, validation, and submission handling

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ProjectSettings } from '@/components/ProjectSettings';
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

const mockProject: ProjectWithConfiguration = {
  id: 'project1',
  name: 'Test Project',
  description: 'A test project',
  workingDirectory: '/project/path',
  configuration: {
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    maxTokens: 4000,
    temperature: 0.7,
    tools: ['file-read', 'file-write', 'bash'],
    toolPolicies: {
      'file-write': 'require-approval',
      'bash': 'require-approval',
    },
    environmentVariables: {
      API_KEY: 'test-key',
      NODE_ENV: 'development',
    },
  },
  isArchived: false,
  createdAt: new Date('2024-01-01'),
  lastUsedAt: new Date('2024-01-01'),
};

describe('ProjectSettings', () => {
  const mockOnSave = vi.fn();
  const mockOnCancel = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render project settings form', () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    expect(screen.getByDisplayValue('Test Project')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test project')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/project/path')).toBeInTheDocument();
    expect(screen.getByText('Project Settings')).toBeInTheDocument();
  });

  it('should render tab navigation', () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('AI Configuration')).toBeInTheDocument();
    expect(screen.getByText('Tools & Policies')).toBeInTheDocument();
    expect(screen.getByText('Environment Variables')).toBeInTheDocument();
  });

  it('should handle configuration updates', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to AI Configuration tab
    await user.click(screen.getByText('AI Configuration'));

    // Check initial values
    const providerSelect = screen.getByTestId('provider-select');
    const modelSelect = screen.getByTestId('model-select');
    expect(providerSelect.value).toBe('anthropic');
    expect(modelSelect.value).toBe('claude-3-sonnet');

    // Update model
    await user.selectOptions(modelSelect, 'claude-3-haiku');

    // Update max tokens
    const maxTokensInput = screen.getByDisplayValue('4000');
    await user.clear(maxTokensInput);
    await user.type(maxTokensInput, '8000');

    // Update temperature
    const temperatureInput = screen.getByDisplayValue('0.7');
    await user.clear(temperatureInput);
    await user.type(temperatureInput, '0.3');

    // Save changes
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        model: 'claude-3-haiku',
        maxTokens: 8000,
        temperature: 0.3,
      },
    });
  });

  it('should handle tool policy changes', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to Tools & Policies tab
    await user.click(screen.getByText('Tools & Policies'));

    // Change bash policy
    const bashPolicySelect = screen.getByTestId('tool-policy-bash');
    await user.selectOptions(bashPolicySelect, 'allow');

    // Save changes
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        toolPolicies: {
          'file-write': 'require-approval',
          'bash': 'allow',
        },
      },
    });
  });

  it('should validate form inputs', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Clear project name
    const nameInput = screen.getByDisplayValue('Test Project');
    await user.clear(nameInput);

    // Try to save
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(screen.getByText('Project name is required')).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('should validate working directory is required', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Clear working directory
    const workingDirectoryInput = screen.getByDisplayValue('/project/path');
    await user.clear(workingDirectoryInput);

    // Try to save
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(screen.getByText('Working directory is required')).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('should handle environment variable management', async () => {
    // Mock window.prompt for adding environment variables
    const promptSpy = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('NEW_VAR') // variable name
      .mockReturnValueOnce('new-value'); // variable value

    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to Environment Variables tab
    await user.click(screen.getByText('Environment Variables'));

    // Add new environment variable
    const addButton = screen.getByText('Add Variable');
    await user.click(addButton);

    // Save changes
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        environmentVariables: {
          ...mockProject.configuration.environmentVariables,
          NEW_VAR: 'new-value',
        },
      },
    });

    promptSpy.mockRestore();
  });

  it('should handle environment variable removal', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to Environment Variables tab
    await user.click(screen.getByText('Environment Variables'));

    // Remove API_KEY environment variable
    const removeButtons = screen.getAllByText('Remove');
    await user.click(removeButtons[0]); // Remove first env var (API_KEY)

    // Save changes
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        environmentVariables: {
          NODE_ENV: 'development',
        },
      },
    });
  });

  it('should handle tool selection changes', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to Tools & Policies tab
    await user.click(screen.getByText('Tools & Policies'));

    // Uncheck file-write tool
    const fileWriteCheckbox = screen.getByRole('checkbox', { name: 'file-write' });
    await user.click(fileWriteCheckbox);

    // Save changes
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith({
      ...mockProject,
      configuration: {
        ...mockProject.configuration,
        tools: ['file-read', 'bash'],
        toolPolicies: {
          'bash': 'require-approval',
        },
      },
    });
  });

  it('should handle cancel action', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('should validate temperature range', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to AI Configuration tab
    await user.click(screen.getByText('AI Configuration'));

    // Set temperature out of range
    const temperatureInput = screen.getByDisplayValue('0.7');
    await user.clear(temperatureInput);
    await user.type(temperatureInput, '3.0');

    // Try to save
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(screen.getByText(/temperature/i)).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it('should validate maxTokens is positive', async () => {
    render(<ProjectSettings project={mockProject} onSave={mockOnSave} />);

    // Switch to AI Configuration tab
    await user.click(screen.getByText('AI Configuration'));

    // Set negative maxTokens
    const maxTokensInput = screen.getByDisplayValue('4000');
    await user.clear(maxTokensInput);
    await user.type(maxTokensInput, '-100');

    // Try to save
    const saveButton = screen.getByText('Save Settings');
    await user.click(saveButton);

    expect(screen.getByText(/positive/i)).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });
});