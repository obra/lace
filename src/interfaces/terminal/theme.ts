// ABOUTME: Centralized theme constants for terminal UI to avoid emoji width issues
// ABOUTME: Provides consistent, single-width Unicode symbols for all terminal components

/**
 * UI Symbols - all single-width Unicode characters to avoid terminal layout issues
 */
export const UI_SYMBOLS = {
  // Tool and execution symbols
  TOOL: '▶', // Tool execution indicator
  SUCCESS: '✔', // Successful operation
  ERROR: '✘', // Failed operation
  PENDING: '⧖', // Operation in progress

  // Navigation and expansion
  EXPANDED: '▼', // Expanded/open state
  COLLAPSED: '▶', // Collapsed/closed state
  ARROW_RIGHT: '→', // Right arrow
  ARROW_DOWN: '↓', // Down arrow
  ARROW_UP: '↑', // Up arrow
  ARROW_LEFT: '←', // Left arrow

  // Status indicators
  AGENT: '◆', // Agent/AI indicator
  USER: '●', // User indicator
  SYSTEM: '◇', // System message indicator
  THINKING: '○', // Thinking/processing indicator
  WARNING: '⚠', // Warning symbol
  INFO: 'ⓘ', // Information symbol

  // Delegation and threads
  DELEGATE: '⟐', // Delegation box indicator
  THREAD: '▬', // Thread indicator
  NESTED: '├', // Nested item indicator
  BRANCH: '└', // Branch end indicator

  // Progress and tokens
  TOKEN_IN: '↑', // Input tokens
  TOKEN_OUT: '↓', // Output tokens
  TIME: '⏱', // Time indicator
  COMPLETE: '●', // Completion indicator
  WORKING: '◐', // Work in progress

  // Brackets and containers
  BOX_OPEN: '[', // Opening bracket
  BOX_CLOSE: ']', // Closing bracket
  EXPAND_HINT: '▸', // Expansion hint
  COLLAPSE_HINT: '▾', // Collapse hint

  // Toolbox markers
  TOOLBOX_SINGLE: '⊂', // Single line toolbox marker
  TOOLBOX_SINGLE_EXPANDABLE: '⤹', // Single line expandable toolbox marker
  TOOLBOX_TOP: '╭', // Multi-line toolbox top marker
  TOOLBOX_TOP_EXPANDABLE: '⤹', // Multi-line expandable toolbox top marker
  TOOLBOX_MIDDLE: '│', // Multi-line toolbox middle marker
  TOOLBOX_BOTTOM: '╰', // Multi-line toolbox bottom marker

  // Status bar symbols
  PROVIDER: '◉', // Provider/brain indicator
  FOLDER: '▣', // Thread/folder indicator
  MESSAGE: '◈', // Message count indicator
  LIGHTNING: '.', // Processing indicator
  READY: '✓', // Ready status indicator
  RETRY: '🔄', // Retry indicator

  // Project context symbols (for double status bar)
  GIT_BRANCH: '⎇', // Git branch indicator
  GIT_MODIFIED: '±', // Modified files
  GIT_STAGED: '+', // Staged files
  GIT_DELETED: '-', // Deleted files
  GIT_UNTRACKED: '?', // Untracked files
  PATH_SEP: '•', // Path separator
  GIT_ERROR: '!', // Git error indicator
} as const;

/**
 * Color themes for different UI contexts
 */
export const UI_COLORS = {
  // Status colors
  SUCCESS: 'green',
  ERROR: 'red',
  WARNING: 'yellow',
  INFO: 'blue',
  PENDING: 'gray',

  // Component colors
  TOOL: 'yellow',
  AGENT: 'cyan',
  USER: 'white',
  SYSTEM: 'gray',
  DELEGATE: 'blue',

  // Interactive elements
  FOCUSED: 'cyan',
  UNFOCUSED: 'gray',
  EXPANDABLE: 'gray',

  // Toolbox status colors (unfocused)
  TOOLBOX_NONE: 'gray',
  TOOLBOX_PENDING: 'yellow',
  TOOLBOX_SUCCESS: 'green',
  TOOLBOX_ERROR: 'red',

  // Toolbox status colors (focused/bright)
  TOOLBOX_NONE_BRIGHT: 'white',
  TOOLBOX_PENDING_BRIGHT: 'yellowBright',
  TOOLBOX_SUCCESS_BRIGHT: 'greenBright',
  TOOLBOX_ERROR_BRIGHT: 'redBright',
} as const;
