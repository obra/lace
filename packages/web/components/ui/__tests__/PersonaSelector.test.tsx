// ABOUTME: Unit tests for PersonaSelector component
// ABOUTME: Tests searchable persona dropdown with autocomplete functionality

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PersonaSelector } from '@/components/ui/PersonaSelector';

const mockPersonas = [
  { name: 'default', isUserDefined: false, path: 'default.md' },
  { name: 'code-reviewer', isUserDefined: false, path: 'code-reviewer.md' },
  { name: 'my-custom', isUserDefined: true, path: '/path/to/my-custom.md' },
];

describe('PersonaSelector', () => {
  it('should render with placeholder when no selection', () => {
    render(
      <PersonaSelector personas={mockPersonas} onChange={vi.fn()} placeholder="Choose persona" />
    );

    expect(screen.getByText('Choose persona')).toBeInTheDocument();
  });

  it('should show selected persona name when selected', () => {
    render(
      <PersonaSelector personas={mockPersonas} selectedPersona="default" onChange={vi.fn()} />
    );

    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('should open dropdown and show personas on click', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));

    expect(screen.getByTestId('persona-search-input')).toBeInTheDocument();
    expect(screen.getByTestId('persona-option-default')).toBeInTheDocument();
    expect(screen.getByTestId('persona-option-code-reviewer')).toBeInTheDocument();
    expect(screen.getByTestId('persona-option-my-custom')).toBeInTheDocument();
  });

  it('should filter personas based on search', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    fireEvent.change(screen.getByTestId('persona-search-input'), { target: { value: 'code' } });

    expect(screen.getByTestId('persona-option-code-reviewer')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-option-default')).not.toBeInTheDocument();
    expect(screen.queryByTestId('persona-option-my-custom')).not.toBeInTheDocument();
  });

  it('should show no results message when search has no matches', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    fireEvent.change(screen.getByTestId('persona-search-input'), {
      target: { value: 'nonexistent' },
    });

    expect(screen.getByText('No personas found')).toBeInTheDocument();
  });

  it('should call onChange when persona selected', () => {
    const mockOnChange = vi.fn();
    render(<PersonaSelector personas={mockPersonas} onChange={mockOnChange} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    fireEvent.click(screen.getByTestId('persona-option-code-reviewer'));

    expect(mockOnChange).toHaveBeenCalledWith('code-reviewer');
  });

  it('should close dropdown after selection', () => {
    const mockOnChange = vi.fn();
    render(<PersonaSelector personas={mockPersonas} onChange={mockOnChange} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    expect(screen.getByTestId('persona-search-input')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('persona-option-default'));

    expect(screen.queryByTestId('persona-search-input')).not.toBeInTheDocument();
  });

  it('should clear search query after selection', () => {
    const mockOnChange = vi.fn();
    render(<PersonaSelector personas={mockPersonas} onChange={mockOnChange} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    fireEvent.change(screen.getByTestId('persona-search-input'), { target: { value: 'default' } });
    fireEvent.click(screen.getByTestId('persona-option-default'));

    // Reopen dropdown and check search is cleared
    fireEvent.click(screen.getByTestId('persona-selector-trigger'));
    expect(screen.getByTestId('persona-search-input')).toHaveValue('');
  });

  it('should show user defined badge for user personas', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('persona-selector-trigger'));

    const userPersonaOption = screen.getByTestId('persona-option-my-custom');
    expect(userPersonaOption).toHaveTextContent('User Defined');

    const builtInPersonaOption = screen.getByTestId('persona-option-default');
    expect(builtInPersonaOption).toHaveTextContent('Built-in');
  });

  it('should be disabled when disabled prop is true', () => {
    render(<PersonaSelector personas={mockPersonas} onChange={vi.fn()} disabled={true} />);

    const trigger = screen.getByTestId('persona-selector-trigger');
    expect(trigger).toBeDisabled();
  });
});
