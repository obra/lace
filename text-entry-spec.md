# Text Entry Specification

## Overview

The text entry system should provide a **shell-native experience with editor ergonomics** - combining the power of modern shells (fish, zsh) with the editing comfort of code editors. The goal is to make text input a joy to use for both simple commands and complex multi-line prompts.

## Core Behaviors

### Single-Line Mode (Default)
- **Enter**: Submit the command/prompt
- **Visible cursor**: Blinking cursor showing insertion point
- **Standard navigation**: Arrow keys, Home/End, Ctrl+A/E (beginning/end of line)
- **Word navigation**: Ctrl+Left/Right to jump by words
- **History navigation**: Up/Down arrows cycle through command history

### Multi-Line Mode
**Entry methods:**
- `\` at end of line + Enter → continues to next line
- `Shift+Enter` → enters multi-line mode
- Pasted multi-line content → automatically enters multi-line mode

**Multi-line behavior:**
- **Visual indicator**: Show `>` prompt for continuation lines
- **Enter**: Adds new line (does not submit)
- **Submit**: Ctrl+Enter or Empty line + Enter
- **Navigation**: Arrow keys work across lines
- **Exit**: Escape returns to single-line, preserving content on one line

```
lace> explain this code \
    > and show me how to optimize it \
    > for better performance
    > [Ctrl+Enter to submit]

# OR
lace> explain this code [Shift+Enter]
    > and show me alternatives
    > [Ctrl+Enter to submit]
```

## Text Editing

### Cursor and Selection
- **Visible blinking cursor** at insertion point
- **Text selection** with Shift+Arrow keys
- **Word selection** with Ctrl+Shift+Arrow keys
- **Select all** with Ctrl+A
- **Line selection** with Triple-click (if possible in terminal)

### Clipboard Integration
- **Paste**: Ctrl+V inserts clipboard content
- **Copy**: Ctrl+C copies selected text
- **Cut**: Ctrl+X cuts selected text
- **Smart paste**: Multi-line clipboard automatically enters multi-line mode

### Advanced Editing
- **Delete operations**:
  - Backspace: Delete character before cursor
  - Delete: Delete character after cursor
  - Ctrl+Backspace: Delete word before cursor
  - Ctrl+Delete: Delete word after cursor
- **Undo/Redo**: Ctrl+Z/Ctrl+Y for edit history
- **Insert/Overwrite**: Insert key toggles between modes (visual indicator)

## Completion System

### Command Completion
**Trigger**: Tab key or automatic after `/`

```
/mem[TAB] → /memory
/h[TAB] → /help
/q[TAB] → /quit
```

**Features:**
- Show all available commands starting with prefix
- Include descriptions in completion popup
- Support partial matching anywhere in command name

### File Path Completion
**Trigger**: Tab key when typing paths

```
src/ui/A[TAB] → src/ui/App.tsx
/usr/local/b[TAB] → /usr/local/bin/
./docs/arch[TAB] → ./docs/architecture.md
```

**Features:**
- Real-time directory traversal
- Show files and directories
- Auto-quote paths with spaces
- Support relative and absolute paths
- Work in middle of line: `read /path/to/f[TAB]ile.txt and analyze`

### Context-Aware Completion
- **Command context**: After `/` show commands
- **File context**: In file operations, prioritize relevant file types
- **History context**: Suggest recently used patterns
- **Smart quotes**: Automatically quote paths with spaces

### Completion UI
- **Popup window**: Appears below/above current line
- **Keyboard navigation**: Up/Down to select, Tab/Enter to complete
- **Descriptions**: Show brief descriptions for commands
- **Multiple matches**: Handle ambiguous completions gracefully
- **Escape**: Cancel completion, return to normal editing

## Command History

### Navigation
- **Up/Down arrows**: Navigate through history (single-line mode only)
- **History search**: Ctrl+R for reverse incremental search
- **Forward search**: Ctrl+S for forward search
- **Clear search**: Escape to exit search mode

### History Management
- **Persistent**: Save history across sessions (in ~/.lace_history or similar)
- **Deduplication**: Don't repeat identical consecutive commands
- **Size limit**: Keep last N commands (configurable, default 1000)
- **Session awareness**: Mark which session commands came from

### Search Interface
```
(reverse-i-search)`read`: read /path/to/file.txt
```
- **Incremental**: Update results as you type
- **Highlighting**: Show matched portion
- **Navigation**: Ctrl+R again for next match

## Visual Feedback

### Mode Indicators
- **Single-line**: `lace> ` prompt
- **Multi-line**: `lace> ` for first line, `    > ` for continuation
- **Search mode**: `(reverse-i-search)\`term\`: command`
- **Insert/Overwrite**: Cursor style change (if possible)

### Cursor Styles
- **Insert mode**: Thin blinking cursor `|`
- **Overwrite mode**: Block cursor `█`
- **Multi-line**: Show cursor position clearly across lines

### Error Feedback
- **Invalid commands**: Subtle red highlighting (don't break flow)
- **Path completion errors**: Show "No matches" briefly
- **Line too long**: Visual indicator when approaching limits

## Keyboard Shortcuts Summary

### Navigation
- `←/→`: Move cursor character by character
- `Ctrl+←/→`: Move cursor word by word
- `Home/Ctrl+A`: Move to beginning of line
- `End/Ctrl+E`: Move to end of line
- `↑/↓`: Navigate history (single-line) or lines (multi-line)

### Editing
- `Backspace`: Delete character before cursor
- `Ctrl+Backspace`: Delete word before cursor
- `Delete`: Delete character after cursor
- `Ctrl+Delete`: Delete word after cursor
- `Ctrl+Z`: Undo
- `Ctrl+Y`: Redo

### Selection
- `Shift+←/→`: Select character by character
- `Ctrl+Shift+←/→`: Select word by word
- `Ctrl+A`: Select all
- `Ctrl+C`: Copy selection
- `Ctrl+X`: Cut selection
- `Ctrl+V`: Paste

### Multi-line
- `\` + `Enter`: Continue line
- `Shift+Enter`: Enter multi-line mode
- `Ctrl+Enter`: Submit multi-line input
- `Escape`: Exit multi-line mode

### Completion & History
- `Tab`: Trigger completion
- `Ctrl+R`: Reverse history search
- `Ctrl+S`: Forward history search
- `Escape`: Cancel completion/search

## Implementation Notes

### Component Architecture
```
AdvancedTextInput
├── TextBuffer (manages content, cursor, selection)
├── CompletionEngine (handles file/command completion)
├── HistoryManager (command history and search)
├── KeyboardHandler (maps keys to actions)
└── Renderer (visual display with cursor)
```

### State Management
- **Text buffer**: Current content, cursor position, selection
- **Mode state**: Single/multi-line, insert/overwrite, search mode
- **Completion state**: Active completions, selected item
- **History state**: Current position, search term

### Performance Considerations
- **Lazy loading**: Only load completions when needed
- **Debounced completion**: Don't complete on every keystroke
- **Virtual scrolling**: For very long multi-line inputs
- **Efficient re-rendering**: Only update changed portions

### Accessibility
- **Screen reader support**: Announce mode changes and cursor position
- **High contrast**: Ensure cursor and selection are visible
- **Keyboard only**: All functionality available without mouse

## Future Enhancements

### Advanced Features
- **Syntax highlighting**: Highlight commands, paths, strings differently
- **Bracket matching**: Auto-close quotes, show matching brackets
- **Smart indentation**: Auto-indent in multi-line mode
- **Snippet expansion**: Expand common patterns
- **Collaborative editing**: Share multi-line prompts

### AI Integration
- **Smart completion**: AI-suggested command completions
- **Intent detection**: Understand what user is trying to do
- **Error correction**: Suggest fixes for typos
- **Context awareness**: Complete based on conversation history

This specification balances power-user efficiency with discoverability, making the text entry system both approachable for new users and powerful for experienced shell users.