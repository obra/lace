// ABOUTME: Tests for SettingField component covering field layout and content display
// ABOUTME: Ensures proper label, description, and control area rendering with accessibility

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingField } from './SettingField';

describe('SettingField', () => {
  it('renders field with label', () => {
    render(
      <SettingField label="Theme Setting">
        <select>
          <option>Light</option>
          <option>Dark</option>
        </select>
      </SettingField>
    );
    
    expect(screen.getByText('Theme Setting')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders field without label when not provided', () => {
    render(
      <SettingField>
        <input type="text" placeholder="Enter value" />
      </SettingField>
    );
    
    expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument();
    // Should not have a label element
    expect(screen.queryByText(/label/i)).not.toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <SettingField label="Notifications" description="Control how you receive notifications">
        <input type="checkbox" />
      </SettingField>
    );
    
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Control how you receive notifications')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    const { container } = render(
      <SettingField label="Test Field" className="custom-field">
        <input type="text" />
      </SettingField>
    );
    
    expect(container.firstChild).toHaveClass('custom-field');
  });

  it('uses horizontal layout when specified', () => {
    const { container } = render(
      <SettingField label="Auto-save" layout="horizontal">
        <input type="checkbox" />
      </SettingField>
    );
    
    expect(container.firstChild).toHaveClass('flex-row');
    expect(screen.getByText('Auto-save')).toBeInTheDocument();
  });

  it('uses vertical layout by default', () => {
    const { container } = render(
      <SettingField label="Username">
        <input type="text" />
      </SettingField>
    );
    
    expect(container.firstChild).toHaveClass('flex-col');
  });

  it('renders multiple children correctly', () => {
    render(
      <SettingField label="Theme Options">
        <select>
          <option>Light</option>
          <option>Dark</option>
        </select>
        <button>Apply</button>
      </SettingField>
    );
    
    expect(screen.getByText('Theme Options')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('shows required indicator when field is required', () => {
    render(
      <SettingField label="API Key" required>
        <input type="text" />
      </SettingField>
    );
    
    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(
      <SettingField label="Email Address" description="We'll never share your email">
        <input type="email" aria-describedby="email-desc" />
      </SettingField>
    );
    
    expect(screen.getByText('Email Address')).toBeInTheDocument();
    expect(screen.getByText("We'll never share your email")).toBeInTheDocument();
  });
});
