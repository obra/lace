// ABOUTME: Dropdown picker for slash commands, shown when user types "/" in chat input
// ABOUTME: Displays available commands with filtering, keyboard navigation, and source badges

'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTerminal, faUser } from '@lace/web/lib/fontawesome';

export interface SlashCommand {
  name: string;
  description: string;
  source?: 'builtin' | 'user';
}

// Built-in slash commands - these are always available
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Summarize and compress context', source: 'builtin' },
  { name: 'clear', description: 'Clear conversation, start fresh', source: 'builtin' },
  {
    name: 'mode',
    description: 'Switch approval mode (ask|approveReads|approveEdits|approve|deny)',
    source: 'builtin',
  },
  { name: 'help', description: 'Show available commands', source: 'builtin' },
];

export interface SlashCommandPickerProps {
  /** The current query after "/" (e.g., if input is "/co", query is "co") */
  query: string;
  /** Currently selected index in the filtered list */
  selectedIndex: number;
  /** Callback when selection index changes */
  onSelectionChange: (index: number) => void;
  /** Callback when a command is selected */
  onSelect: (command: SlashCommand) => void;
  /** Callback to close the picker */
  onClose: () => void;
  /** Additional commands (e.g., user-defined) to include */
  additionalCommands?: SlashCommand[];
  /** Maximum number of items to show */
  maxItems?: number;
}

export function SlashCommandPicker({
  query,
  selectedIndex,
  onSelectionChange,
  onSelect,
  onClose,
  additionalCommands = [],
  maxItems = 8,
}: SlashCommandPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Combine built-in and additional commands
  const allCommands = [...BUILTIN_SLASH_COMMANDS, ...additionalCommands];

  // Filter commands based on query
  const filteredCommands = allCommands.filter((cmd) => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    return (
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery)
    );
  });

  // Ensure selected index is within bounds
  const safeSelectedIndex = Math.min(selectedIndex, filteredCommands.length - 1);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [safeSelectedIndex]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onSelectionChange(Math.max(0, safeSelectedIndex - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          onSelectionChange(Math.min(filteredCommands.length - 1, safeSelectedIndex + 1));
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (filteredCommands[safeSelectedIndex]) {
            onSelect(filteredCommands[safeSelectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [safeSelectedIndex, filteredCommands, onSelectionChange, onSelect, onClose]
  );

  // Register keyboard handler
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (filteredCommands.length === 0) {
    return (
      <div
        ref={containerRef}
        className="absolute bottom-full left-0 right-0 mb-1 bg-base-200 rounded-lg shadow-lg border border-base-300 p-3 z-50"
      >
        <p className="text-base-content/60 text-sm">No matching commands</p>
      </div>
    );
  }

  // Limit displayed items
  const displayedCommands = filteredCommands.slice(0, maxItems);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-base-200 rounded-lg shadow-lg border border-base-300 overflow-hidden z-50"
    >
      <div className="max-h-64 overflow-y-auto">
        {displayedCommands.map((cmd, index) => {
          const isSelected = index === safeSelectedIndex;
          return (
            <div
              key={cmd.name}
              ref={isSelected ? selectedRef : null}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                isSelected ? 'bg-primary/20' : 'hover:bg-base-300/50'
              }`}
              onClick={() => onSelect(cmd)}
              onMouseEnter={() => onSelectionChange(index)}
            >
              {/* Icon based on source */}
              <div className="w-5 h-5 flex items-center justify-center text-base-content/60">
                <FontAwesomeIcon
                  icon={cmd.source === 'user' ? faUser : faTerminal}
                  className="w-3.5 h-3.5"
                />
              </div>

              {/* Command info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono font-medium ${isSelected ? 'text-primary' : 'text-base-content'}`}
                  >
                    /{cmd.name}
                  </span>
                  {cmd.source === 'user' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-info/20 text-info">user</span>
                  )}
                </div>
                <p className="text-sm text-base-content/60 truncate">{cmd.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="px-3 py-2 border-t border-base-300 text-xs text-base-content/50 flex gap-4">
        <span>
          <kbd className="kbd kbd-xs">Up</kbd>/<kbd className="kbd kbd-xs">Down</kbd> navigate
        </span>
        <span>
          <kbd className="kbd kbd-xs">Enter</kbd>/<kbd className="kbd kbd-xs">Tab</kbd> select
        </span>
        <span>
          <kbd className="kbd kbd-xs">Esc</kbd> close
        </span>
      </div>
    </div>
  );
}
