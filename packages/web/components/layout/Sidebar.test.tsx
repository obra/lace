// ABOUTME: Tests for Sidebar component covering settings button and theme selector removal
// ABOUTME: Ensures sidebar functionality works without theme selector and with proper settings integration

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  const defaultProps = {
    open: true,
    onToggle: vi.fn(),
    children: <div>Sidebar Content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getAllByText('Sidebar Content')).toHaveLength(2); // Both mobile and desktop versions
    expect(screen.getAllByText('Lace')).toHaveLength(2); // Both mobile and desktop headers
  });

  it('renders collapsed state when closed', () => {
    render(<Sidebar {...defaultProps} open={false} />);
    // Mobile version is hidden when closed, desktop shows collapsed state without content
    expect(screen.queryByText('Sidebar Content')).not.toBeInTheDocument();
    // Desktop collapsed state doesn't show "Lace" text, mobile is hidden
    expect(screen.queryByText('Lace')).not.toBeInTheDocument();
  });

  it('calls onToggle when toggle button clicked', () => {
    const mockOnToggle = vi.fn();
    render(<Sidebar {...defaultProps} onToggle={mockOnToggle} />);

    // Use more specific query - there are two buttons, get the one without title
    const buttons = screen.getAllByRole('button');
    const toggleButton = buttons.find((button) => !button.hasAttribute('title'));
    expect(toggleButton).toBeDefined();

    fireEvent.click(toggleButton!);
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  // NEW TESTS FOR TASK 3 - These should fail initially
  it('calls onSettingsClick when settings button clicked (collapsed)', () => {
    const mockOnSettingsClick = vi.fn();
    render(<Sidebar {...defaultProps} open={false} onSettingsClick={mockOnSettingsClick} />);

    // When collapsed, only desktop collapsed settings button is visible
    const settingsButton = screen.getByLabelText('Open settings');
    fireEvent.click(settingsButton);
    expect(mockOnSettingsClick).toHaveBeenCalledTimes(1);
  });

  it('calls onSettingsClick when settings button clicked (expanded)', () => {
    const mockOnSettingsClick = vi.fn();
    render(<Sidebar {...defaultProps} open={true} onSettingsClick={mockOnSettingsClick} />);

    // When expanded, both mobile and desktop settings buttons exist, click the first one
    const settingsButtons = screen.getAllByLabelText('Open settings');
    expect(settingsButtons.length).toBeGreaterThan(0);
    fireEvent.click(settingsButtons[0]);
    expect(mockOnSettingsClick).toHaveBeenCalledTimes(1);
  });

  it('does not render theme selector in footer', () => {
    render(<Sidebar {...defaultProps} />);
    // Theme selector should not be present
    expect(screen.queryByText('Theme')).not.toBeInTheDocument();
  });

  it('does not require theme props', () => {
    // This test verifies the interface doesn't require theme props
    expect(() => {
      render(<Sidebar {...defaultProps} />);
    }).not.toThrow();
  });

  it('renders settings button in both expanded and collapsed states', () => {
    // Collapsed state
    const { rerender } = render(<Sidebar {...defaultProps} open={false} />);
    expect(screen.getByLabelText('Open settings')).toBeInTheDocument();

    // Expanded state - now has multiple settings buttons (mobile + desktop)
    rerender(<Sidebar {...defaultProps} open={true} />);
    const settingsButtons = screen.getAllByLabelText('Open settings');
    expect(settingsButtons.length).toBeGreaterThan(0);
  });

  // REGRESSION TESTS - These should still pass
  it('maintains existing functionality after theme removal', () => {
    render(<Sidebar {...defaultProps} />);

    // Should still render content area (now in both mobile and desktop versions)
    expect(screen.getAllByText('Sidebar Content')).toHaveLength(2);

    // Should still have header (now in both mobile and desktop versions)
    expect(screen.getAllByText('Lace')).toHaveLength(2);

    // Should still have toggle functionality
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});
