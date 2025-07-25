// ABOUTME: Tests for SettingsModal component covering open/close behavior and keyboard navigation
// ABOUTME: Ensures modal renders correctly with proper ARIA attributes and accessibility features

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SettingsModal } from './SettingsModal';

describe('SettingsModal', () => {
  it('renders modal when open', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<SettingsModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const mockOnClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
    
    const backdrop = screen.getByRole('dialog').parentElement?.firstChild;
    fireEvent.click(backdrop as Element);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const mockOnClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
    
    fireEvent.click(screen.getByText('✕'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when escape key is pressed', () => {
    const mockOnClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);
    
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders children content when provided', () => {
    render(
      <SettingsModal isOpen={true} onClose={() => {}}>
        <div>Test Content</div>
      </SettingsModal>
    );
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });
});