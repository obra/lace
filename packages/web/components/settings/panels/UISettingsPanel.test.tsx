// ABOUTME: Tests for UISettingsPanel component covering theme selector integration
// ABOUTME: Ensures proper theme selection functionality and integration with existing ThemeSelector

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, describe, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { UISettingsPanel } from './UISettingsPanel';

describe('UISettingsPanel', () => {
  it('renders theme selector', () => {
    render(<UISettingsPanel />);
    expect(screen.getByText('UI Settings')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();
    // Default theme is 'dark', so it appears in header and as button
    expect(screen.getAllByText('dark')).toHaveLength(2); // One in header, one as button
    expect(screen.getAllByText('light')).toHaveLength(1); // Only as button since not current
  });

  it('renders with current theme selected', () => {
    render(<UISettingsPanel currentTheme="light" />);
    expect(screen.getByText('UI Settings')).toBeInTheDocument();
    // Check that light appears in the current theme indicator and as button
    const lightElements = screen.getAllByText('light');
    expect(lightElements).toHaveLength(2); // One in header, one as button
    // Check that the light theme button is selected (has primary border)
    const lightButton = screen.getByRole('button', { name: /light/i });
    expect(lightButton).toHaveClass('border-primary');
  });

  it('calls onThemeChange when theme selected', () => {
    const mockOnThemeChange = vi.fn();
    render(<UISettingsPanel onThemeChange={mockOnThemeChange} />);

    // Click on the light theme button (not the header text)
    const lightButtons = screen.getAllByText('light');
    const lightButton = lightButtons.find((el) => el.closest('button'));
    expect(lightButton).toBeDefined();
    fireEvent.click(lightButton!);
    expect(mockOnThemeChange).toHaveBeenCalledWith('light');
  });

  it('displays theme selector properly', () => {
    render(<UISettingsPanel />);
    // ThemeSelector handles its own labeling and description
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getAllByText('dark')).toHaveLength(2); // Header and button
  });

  it('renders all available themes from ThemeSelector', () => {
    render(<UISettingsPanel />);

    // Check for some of the theme names from ThemeSelector (as buttons)
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
  });

  it('integrates properly with SettingsPanel structure', () => {
    render(<UISettingsPanel />);

    // Should have the panel title as heading
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('UI Settings');
  });

  it('uses SettingField for consistent layout', () => {
    render(<UISettingsPanel />);

    // The Theme label should be present from ThemeSelector
    expect(screen.getByText('Theme')).toBeInTheDocument();
    // ThemeSelector is wrapped in SettingField for consistent layout
    expect(screen.getByText('UI Settings')).toBeInTheDocument();
  });
});
