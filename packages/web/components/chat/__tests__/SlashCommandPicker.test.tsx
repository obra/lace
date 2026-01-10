// ABOUTME: Tests for SlashCommandPicker component - keyboard navigation, filtering, and selection

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SlashCommandPicker,
  BUILTIN_SLASH_COMMANDS,
  type SlashCommand,
} from '@lace/web/components/chat/SlashCommandPicker';

// Mock scrollIntoView which JSDOM doesn't implement
// This is needed because the SlashCommandPicker component calls scrollIntoView on selected items
Element.prototype.scrollIntoView = vi.fn();

describe('SlashCommandPicker', () => {
  const mockOnSelect = vi.fn();
  const mockOnSelectionChange = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    query: '',
    selectedIndex: 0,
    onSelectionChange: mockOnSelectionChange,
    onSelect: mockOnSelect,
    onClose: mockOnClose,
  };

  describe('rendering', () => {
    it('renders all builtin commands when query is empty', () => {
      render(<SlashCommandPicker {...defaultProps} />);

      // Check that all builtin commands are rendered
      for (const cmd of BUILTIN_SLASH_COMMANDS) {
        expect(screen.getByText(`/${cmd.name}`)).toBeInTheDocument();
      }
    });

    it('renders command descriptions', () => {
      render(<SlashCommandPicker {...defaultProps} />);

      for (const cmd of BUILTIN_SLASH_COMMANDS) {
        expect(screen.getByText(cmd.description)).toBeInTheDocument();
      }
    });

    it('shows "No matching commands" when no commands match query', () => {
      render(<SlashCommandPicker {...defaultProps} query="zzznomatch" />);

      expect(screen.getByText('No matching commands')).toBeInTheDocument();
    });

    it('renders keyboard shortcuts legend', () => {
      render(<SlashCommandPicker {...defaultProps} />);

      // The legend text includes spaces before the words due to element structure
      expect(screen.getByText(/navigate/)).toBeInTheDocument();
      expect(screen.getByText(/select/)).toBeInTheDocument();
      expect(screen.getByText(/close/)).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('filters commands by name', () => {
      render(<SlashCommandPicker {...defaultProps} query="comp" />);

      // Should show /compact
      expect(screen.getByText('/compact')).toBeInTheDocument();

      // Should not show /clear, /mode, /help
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
      expect(screen.queryByText('/mode')).not.toBeInTheDocument();
      expect(screen.queryByText('/help')).not.toBeInTheDocument();
    });

    it('filters commands by description', () => {
      render(<SlashCommandPicker {...defaultProps} query="fresh" />);

      // "Clear conversation, start fresh" matches "fresh"
      expect(screen.getByText('/clear')).toBeInTheDocument();
    });

    it('filtering is case-insensitive', () => {
      render(<SlashCommandPicker {...defaultProps} query="COMPACT" />);

      expect(screen.getByText('/compact')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('highlights the selected item', () => {
      render(<SlashCommandPicker {...defaultProps} selectedIndex={1} />);

      // The second item should have the selected styling (bg-primary/20)
      // We can check by finding the container and looking at its classes
      const items = screen
        .getAllByRole('generic')
        .filter((el) => el.className.includes('cursor-pointer'));
      expect(items[1].className).toContain('bg-primary');
    });

    it('calls onSelect when clicking a command', () => {
      render(<SlashCommandPicker {...defaultProps} />);

      fireEvent.click(screen.getByText('/compact'));

      expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'compact' }));
    });

    it('calls onSelectionChange when hovering over a command', () => {
      render(<SlashCommandPicker {...defaultProps} />);

      const clearCommand = screen.getByText('/clear').closest('div[class*="cursor-pointer"]');
      if (clearCommand) {
        fireEvent.mouseEnter(clearCommand);
      }

      // Find the index of /clear in the commands
      const clearIndex = BUILTIN_SLASH_COMMANDS.findIndex((cmd) => cmd.name === 'clear');
      expect(mockOnSelectionChange).toHaveBeenCalledWith(clearIndex);
    });
  });

  describe('keyboard navigation', () => {
    it('calls onSelectionChange on ArrowDown', () => {
      render(<SlashCommandPicker {...defaultProps} selectedIndex={0} />);

      fireEvent.keyDown(document, { key: 'ArrowDown' });

      expect(mockOnSelectionChange).toHaveBeenCalledWith(1);
    });

    it('calls onSelectionChange on ArrowUp', () => {
      render(<SlashCommandPicker {...defaultProps} selectedIndex={1} />);

      fireEvent.keyDown(document, { key: 'ArrowUp' });

      expect(mockOnSelectionChange).toHaveBeenCalledWith(0);
    });

    it('does not go below 0 on ArrowUp', () => {
      render(<SlashCommandPicker {...defaultProps} selectedIndex={0} />);

      fireEvent.keyDown(document, { key: 'ArrowUp' });

      expect(mockOnSelectionChange).toHaveBeenCalledWith(0);
    });

    it('does not exceed list length on ArrowDown', () => {
      const lastIndex = BUILTIN_SLASH_COMMANDS.length - 1;
      render(<SlashCommandPicker {...defaultProps} selectedIndex={lastIndex} />);

      fireEvent.keyDown(document, { key: 'ArrowDown' });

      expect(mockOnSelectionChange).toHaveBeenCalledWith(lastIndex);
    });

    it('calls onSelect on Enter', () => {
      render(<SlashCommandPicker {...defaultProps} selectedIndex={0} />);

      fireEvent.keyDown(document, { key: 'Enter' });

      expect(mockOnSelect).toHaveBeenCalledWith(BUILTIN_SLASH_COMMANDS[0]);
    });

    it('calls onSelect on Tab', () => {
      render(<SlashCommandPicker {...defaultProps} selectedIndex={0} />);

      fireEvent.keyDown(document, { key: 'Tab' });

      expect(mockOnSelect).toHaveBeenCalledWith(BUILTIN_SLASH_COMMANDS[0]);
    });

    it('calls onClose on Escape', () => {
      render(<SlashCommandPicker {...defaultProps} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('additional commands', () => {
    const userCommands: SlashCommand[] = [
      { name: 'deploy', description: 'Deploy to production', source: 'user' },
      { name: 'test', description: 'Run tests', source: 'user' },
    ];

    it('shows additional user commands', () => {
      render(<SlashCommandPicker {...defaultProps} additionalCommands={userCommands} />);

      expect(screen.getByText('/deploy')).toBeInTheDocument();
      expect(screen.getByText('/test')).toBeInTheDocument();
    });

    it('shows user badge for user commands', () => {
      render(<SlashCommandPicker {...defaultProps} additionalCommands={userCommands} />);

      // There should be badges for user commands
      const badges = screen.getAllByText('user');
      expect(badges.length).toBe(userCommands.length);
    });

    it('filters additional commands', () => {
      render(
        <SlashCommandPicker {...defaultProps} query="deploy" additionalCommands={userCommands} />
      );

      expect(screen.getByText('/deploy')).toBeInTheDocument();
      expect(screen.queryByText('/test')).not.toBeInTheDocument();
    });

    it('includes additional commands in keyboard selection', () => {
      render(<SlashCommandPicker {...defaultProps} additionalCommands={userCommands} />);

      // Navigate to the first user command (after all builtin commands)
      const userCommandIndex = BUILTIN_SLASH_COMMANDS.length;

      // Re-render with the correct selected index
      const { rerender } = render(
        <SlashCommandPicker
          {...defaultProps}
          selectedIndex={userCommandIndex}
          additionalCommands={userCommands}
        />
      );

      fireEvent.keyDown(document, { key: 'Enter' });

      expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'deploy' }));
    });
  });

  describe('maxItems', () => {
    it('limits displayed items', () => {
      const manyCommands: SlashCommand[] = Array.from({ length: 20 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
        source: 'user' as const,
      }));

      render(
        <SlashCommandPicker {...defaultProps} additionalCommands={manyCommands} maxItems={5} />
      );

      // Should only show 5 items total
      const items = screen
        .getAllByRole('generic')
        .filter((el) => el.className.includes('cursor-pointer'));
      expect(items.length).toBe(5);
    });
  });
});
