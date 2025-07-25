// ABOUTME: Tests for TextAreaField component covering multi-line text input functionality
// ABOUTME: Validates text area behavior, change handling, and accessibility features

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { TextAreaField } from './TextAreaField';

describe('TextAreaField', () => {
  it('renders textarea with label', () => {
    render(<TextAreaField label="Description" />);
    
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders textarea with placeholder', () => {
    render(<TextAreaField label="Description" placeholder="Enter description..." />);
    
    const textarea = screen.getByPlaceholderText('Enter description...');
    expect(textarea).toBeInTheDocument();
  });

  it('handles value changes', () => {
    const mockOnChange = vi.fn();
    render(<TextAreaField label="Description" onChange={mockOnChange} />);
    
    const textarea = screen.getByLabelText('Description');
    fireEvent.change(textarea, { target: { value: 'New text content' } });
    
    expect(mockOnChange).toHaveBeenCalledWith('New text content');
  });

  it('displays controlled value', () => {
    render(<TextAreaField label="Description" value="Test content" />);
    
    expect(screen.getByDisplayValue('Test content')).toBeInTheDocument();
  });

  it('applies custom rows attribute', () => {
    render(<TextAreaField label="Description" rows={5} />);
    
    const textarea = screen.getByLabelText('Description');
    expect(textarea).toHaveAttribute('rows', '5');
  });

  it('applies required attribute when specified', () => {
    render(<TextAreaField label="Description" required />);
    
    const textarea = screen.getByLabelText('Description');
    expect(textarea).toBeRequired();
  });

  it('applies disabled state', () => {
    render(<TextAreaField label="Description" disabled />);
    
    const textarea = screen.getByLabelText('Description');
    expect(textarea).toBeDisabled();
  });

  it('applies custom className', () => {
    render(<TextAreaField label="Description" className="custom-class" />);
    
    const textarea = screen.getByLabelText('Description');
    expect(textarea).toHaveClass('custom-class');
  });

  it('shows error state styling', () => {
    render(<TextAreaField label="Description" error />);
    
    const textarea = screen.getByLabelText('Description');
    expect(textarea).toHaveClass('textarea-error');
  });

  it('renders help text when provided', () => {
    render(<TextAreaField label="Description" helpText="Max 500 characters" />);
    
    expect(screen.getByText('Max 500 characters')).toBeInTheDocument();
  });

  it('applies maxLength attribute when specified', () => {
    render(<TextAreaField label="Description" maxLength={500} />);
    
    const textarea = screen.getByLabelText('Description');
    expect(textarea).toHaveAttribute('maxLength', '500');
  });
});