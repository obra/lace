import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ModelFilterBar } from './ModelFilterBar';

describe('ModelFilterBar', () => {
  const defaultProps = {
    filters: {
      requiredParameters: [],
      minContextLength: undefined,
      maxPromptCostPerMillion: undefined,
    },
    onChange: vi.fn(),
  };

  it('should render capability checkboxes', () => {
    render(<ModelFilterBar {...defaultProps} />);

    expect(screen.getByLabelText('Tools')).toBeInTheDocument();
    expect(screen.getByLabelText('Vision')).toBeInTheDocument();
    expect(screen.getByLabelText('Reasoning')).toBeInTheDocument();
    expect(screen.getByLabelText('Structured')).toBeInTheDocument();
    expect(screen.getByLabelText('Functions')).toBeInTheDocument();
  });

  it('should call onChange when capability is toggled', () => {
    const onChange = vi.fn();
    render(<ModelFilterBar {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Tools'));

    expect(onChange).toHaveBeenCalledWith({
      requiredParameters: ['tools'],
      minContextLength: undefined,
      maxPromptCostPerMillion: undefined,
    });
  });

  it('should update context filter', () => {
    const onChange = vi.fn();
    render(<ModelFilterBar {...defaultProps} onChange={onChange} />);

    const select = screen.getByLabelText('Context Size');
    fireEvent.change(select, { target: { value: '32000' } });

    expect(onChange).toHaveBeenCalledWith({
      requiredParameters: [],
      minContextLength: 32000,
      maxPromptCostPerMillion: undefined,
    });
  });

  it('should update price filter', () => {
    const onChange = vi.fn();
    render(<ModelFilterBar {...defaultProps} onChange={onChange} />);

    const select = screen.getByLabelText('Max Price');
    fireEvent.change(select, { target: { value: '5' } });

    expect(onChange).toHaveBeenCalledWith({
      requiredParameters: [],
      minContextLength: undefined,
      maxPromptCostPerMillion: 5,
    });
  });

  it('should handle removing capabilities', () => {
    const onChange = vi.fn();
    const propsWithCapability = {
      ...defaultProps,
      filters: {
        requiredParameters: ['tools', 'vision'],
        minContextLength: undefined,
        maxPromptCostPerMillion: undefined,
      },
      onChange,
    };

    render(<ModelFilterBar {...propsWithCapability} />);

    // Remove 'tools' capability
    fireEvent.click(screen.getByLabelText('Tools'));

    expect(onChange).toHaveBeenCalledWith({
      requiredParameters: ['vision'],
      minContextLength: undefined,
      maxPromptCostPerMillion: undefined,
    });
  });

  it('should clear filters when set to default values', () => {
    const onChange = vi.fn();
    render(<ModelFilterBar {...defaultProps} onChange={onChange} />);

    // Set context filter then clear it
    const contextSelect = screen.getByLabelText('Context Size');
    fireEvent.change(contextSelect, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({
      requiredParameters: [],
      minContextLength: undefined,
      maxPromptCostPerMillion: undefined,
    });
  });

  it('should show selected capabilities as checked', () => {
    const propsWithCapabilities = {
      ...defaultProps,
      filters: {
        requiredParameters: ['tools', 'reasoning'],
        minContextLength: undefined,
        maxPromptCostPerMillion: undefined,
      },
    };

    render(<ModelFilterBar {...propsWithCapabilities} />);

    expect(screen.getByLabelText('Tools')).toBeChecked();
    expect(screen.getByLabelText('Reasoning')).toBeChecked();
    expect(screen.getByLabelText('Vision')).not.toBeChecked();
  });
});
