import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ProviderModelGroup } from './ProviderModelGroup';

describe('ProviderModelGroup', () => {
  const mockModels = [
    {
      id: 'openai/gpt-4',
      name: 'GPT-4',
      context_window: 8192,
      cost_per_1m_in: 30,
      cost_per_1m_out: 60,
      supports_attachments: false,
    },
    {
      id: 'openai/gpt-3.5',
      name: 'GPT-3.5',
      context_window: 4096,
      cost_per_1m_in: 0.5,
      cost_per_1m_out: 1.5,
      supports_attachments: false,
    },
  ];

  const defaultProps = {
    providerName: 'OpenAI',
    models: mockModels,
    enabledModels: ['openai/gpt-4'],
    onToggleProvider: vi.fn(),
    onToggleModel: vi.fn(),
  };

  it('should show enabled count', () => {
    render(<ProviderModelGroup {...defaultProps} />);
    expect(screen.getByText('1/2 enabled')).toBeInTheDocument();
  });

  it('should call onToggleProvider when provider checkbox clicked', () => {
    const onToggleProvider = vi.fn();
    render(<ProviderModelGroup {...defaultProps} onToggleProvider={onToggleProvider} />);

    const checkbox = screen.getByRole('checkbox', { name: /OpenAI provider toggle/i });
    fireEvent.click(checkbox);

    expect(onToggleProvider).toHaveBeenCalledWith('OpenAI', expect.any(Boolean));
  });

  it('should expand/collapse on click', () => {
    render(<ProviderModelGroup {...defaultProps} />);

    // Should start collapsed (content not visible)
    expect(screen.queryByText('GPT-4')).not.toBeInTheDocument();

    // Click summary to expand
    const summary = screen.getByText('OpenAI').closest('summary');
    fireEvent.click(summary!);

    expect(screen.getByText('GPT-4')).toBeInTheDocument();
  });

  it('should format context size correctly', () => {
    render(<ProviderModelGroup {...defaultProps} />);

    // Expand the group
    const summary = screen.getByText('OpenAI').closest('summary');
    fireEvent.click(summary!);

    expect(screen.getByText(/8k context/)).toBeInTheDocument();
    expect(screen.getByText(/4k context/)).toBeInTheDocument();
  });

  it('should format pricing correctly', () => {
    render(<ProviderModelGroup {...defaultProps} />);

    // Expand the group
    const summary = screen.getByText('OpenAI').closest('summary');
    fireEvent.click(summary!);

    expect(screen.getByText(/\$30\.00 input/)).toBeInTheDocument();
    expect(screen.getByText(/\$60\.00 output/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.50 input/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.50 output/)).toBeInTheDocument();
  });

  it('should show FREE badge for free models', () => {
    const freeModels = [
      {
        id: 'provider/free-model',
        name: 'Free Model',
        context_window: 4096,
        cost_per_1m_in: 0,
        cost_per_1m_out: 0,
        supports_attachments: false,
      },
    ];

    render(
      <ProviderModelGroup
        {...defaultProps}
        models={freeModels}
        enabledModels={['provider/free-model']}
      />
    );

    // Expand the group
    const summary = screen.getByText('OpenAI').closest('summary');
    fireEvent.click(summary!);

    expect(screen.getByText('FREE')).toBeInTheDocument();
  });

  it('should show capability badges', () => {
    const modelsWithCapabilities = [
      {
        id: 'provider/model',
        name: 'Model with Vision',
        context_window: 4096,
        cost_per_1m_in: 1,
        cost_per_1m_out: 2,
        supports_attachments: true,
        can_reason: true,
        supported_parameters: ['tools'],
      },
    ];

    render(
      <ProviderModelGroup
        {...defaultProps}
        models={modelsWithCapabilities}
        enabledModels={['provider/model']}
      />
    );

    // Expand the group
    const summary = screen.getByText('OpenAI').closest('summary');
    fireEvent.click(summary!);

    expect(screen.getByText('vision')).toBeInTheDocument();
    expect(screen.getByText('reasoning')).toBeInTheDocument();
    expect(screen.getByText('tools')).toBeInTheDocument();
  });

  it('should call onToggleModel when model checkbox clicked', () => {
    const onToggleModel = vi.fn();
    render(<ProviderModelGroup {...defaultProps} onToggleModel={onToggleModel} />);

    // Expand the group
    const summary = screen.getByText('OpenAI').closest('summary');
    fireEvent.click(summary!);

    // Find the model checkbox (not the provider checkbox)
    const modelCheckboxes = screen
      .getAllByRole('checkbox')
      .filter((cb) => !cb.getAttribute('aria-label')?.includes('provider toggle'));
    const gpt4Checkbox = modelCheckboxes.find((cb) =>
      cb.closest('label')?.textContent?.includes('GPT-4')
    );

    fireEvent.click(gpt4Checkbox!);

    expect(onToggleModel).toHaveBeenCalledWith('openai/gpt-4', false); // Should disable since it was enabled
  });

  it('should show provider as enabled when some models are enabled', () => {
    render(<ProviderModelGroup {...defaultProps} />);

    const providerCheckbox = screen.getByRole('checkbox', { name: /OpenAI provider toggle/i });
    expect(providerCheckbox).toBeChecked();
  });

  it('should show provider as disabled when no models are enabled', () => {
    render(<ProviderModelGroup {...defaultProps} enabledModels={[]} />);

    const providerCheckbox = screen.getByRole('checkbox', { name: /OpenAI provider toggle/i });
    expect(providerCheckbox).not.toBeChecked();
  });
});
