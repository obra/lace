// ABOUTME: Tests for Sidebar component covering settings button and theme selector removal
// ABOUTME: Ensures sidebar functionality works without theme selector and with proper settings integration

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  const defaultProps = {
    isOpen: true,
    onToggle: vi.fn(),
    children: <div>Sidebar Content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Sidebar Content')).toBeInTheDocument();
    expect(screen.getByText('Lace')).toBeInTheDocument();
  });

  it('renders collapsed state when closed', () => {
    render(<Sidebar {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Sidebar Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Lace')).not.toBeInTheDocument();
  });

  it('calls onToggle when toggle button clicked', () => {
    const mockOnToggle = vi.fn();
    render(<Sidebar {...defaultProps} onToggle={mockOnToggle} />);
    
    // Use more specific query - there are two buttons, get the one without title
    const buttons = screen.getAllByRole('button');
    const toggleButton = buttons.find(button => !button.hasAttribute('title'));
    expect(toggleButton).toBeDefined();
    
    fireEvent.click(toggleButton!);
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  // NEW TESTS FOR TASK 3 - These should fail initially
  it('calls onSettingsClick when settings button clicked (collapsed)', () => {
    const mockOnSettingsClick = vi.fn();
    render(
      <Sidebar 
        {...defaultProps} 
        isOpen={false} 
        onSettingsClick={mockOnSettingsClick}
      />
    );
    
    const settingsButton = screen.getByTitle('Settings');
    fireEvent.click(settingsButton);
    expect(mockOnSettingsClick).toHaveBeenCalledTimes(1);
  });

  it('calls onSettingsClick when settings button clicked (expanded)', () => {
    const mockOnSettingsClick = vi.fn();
    render(
      <Sidebar 
        {...defaultProps} 
        isOpen={true}
        onSettingsClick={mockOnSettingsClick}
      />
    );
    
    const settingsButton = screen.getByTitle('Settings');
    fireEvent.click(settingsButton);
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
    const { rerender } = render(<Sidebar {...defaultProps} isOpen={false} />);
    expect(screen.getByTitle('Settings')).toBeInTheDocument();

    // Expanded state
    rerender(<Sidebar {...defaultProps} isOpen={true} />);
    expect(screen.getByTitle('Settings')).toBeInTheDocument();
  });

  // REGRESSION TESTS - These should still pass
  it('maintains existing functionality after theme removal', () => {
    render(<Sidebar {...defaultProps} />);
    
    // Should still render content area
    expect(screen.getByText('Sidebar Content')).toBeInTheDocument();
    
    // Should still have header
    expect(screen.getByText('Lace')).toBeInTheDocument();
    
    // Should still have toggle functionality
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});