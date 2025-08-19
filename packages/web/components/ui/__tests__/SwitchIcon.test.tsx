// ABOUTME: Unit tests for SwitchIcon component focusing on accessibility and props
// ABOUTME: Tests button vs static rendering, aria attributes, and proper semantic markup

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SwitchIcon } from '@/components/ui/SwitchIcon';

describe('SwitchIcon', () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Interactive Button Mode', () => {
    it('renders as button with proper accessibility attributes', () => {
      render(
        <SwitchIcon
          onClick={mockOnClick}
          title="Switch projects"
          aria-label="Switch to project selector"
          data-testid="switch-button"
        />
      );

      const button = screen.getByTestId('switch-button');
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('title', 'Switch projects');
      expect(button).toHaveAttribute('aria-label', 'Switch to project selector');
    });

    it('uses title as aria-label fallback when aria-label not provided', () => {
      render(<SwitchIcon onClick={mockOnClick} title="Switch items" />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Switch items');
    });

    it('handles click events properly', () => {
      render(<SwitchIcon onClick={mockOnClick} title="Switch" />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('respects disabled state', () => {
      render(<SwitchIcon onClick={mockOnClick} title="Switch" disabled={true} />);

      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveClass('disabled:opacity-50');

      fireEvent.click(button);
      expect(mockOnClick).not.toHaveBeenCalled();
    });

    it('has proper SVG accessibility attributes in button mode', () => {
      render(<SwitchIcon onClick={mockOnClick} title="Switch" />);

      const svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
    });
  });

  describe('Static Icon Mode', () => {
    it('renders as SVG when no onClick provided', () => {
      render(<SwitchIcon className="test-class" />);

      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('test-class');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('has proper accessibility attributes for decorative SVG', () => {
      render(<SwitchIcon />);

      const svg = document.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
    });
  });

  describe('Size Variants', () => {
    it('applies correct size classes', () => {
      const { rerender } = render(<SwitchIcon onClick={mockOnClick} size="sm" />);
      let svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toHaveClass('w-3', 'h-3');

      rerender(<SwitchIcon onClick={mockOnClick} size="md" />);
      svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toHaveClass('w-3.5', 'h-3.5');

      rerender(<SwitchIcon onClick={mockOnClick} size="lg" />);
      svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toHaveClass('w-4', 'h-4');
    });

    it('defaults to medium size', () => {
      render(<SwitchIcon onClick={mockOnClick} />);

      const svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toHaveClass('w-3.5', 'h-3.5');
    });
  });

  describe('Accessibility Warnings', () => {
    it('warns when interactive button lacks accessible name', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<SwitchIcon onClick={mockOnClick} title="" />);

      expect(consoleSpy).toHaveBeenCalledWith(
        'SwitchIcon: Interactive buttons require either title or aria-label for accessibility'
      );

      consoleSpy.mockRestore();
    });

    it('does not warn when accessible name is provided', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<SwitchIcon onClick={mockOnClick} title="Switch" />);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('CSS Classes', () => {
    it('applies custom className to button', () => {
      render(<SwitchIcon onClick={mockOnClick} className="custom-class" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('includes all base button classes', () => {
      render(<SwitchIcon onClick={mockOnClick} />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('p-1.5', 'hover:bg-base-200/80', 'rounded-lg', 'transition-all');
    });
  });
});
