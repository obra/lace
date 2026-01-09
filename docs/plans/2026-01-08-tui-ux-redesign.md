# TUI UX Redesign

## Overview

A complete reimagining of the lace-tui interface, moving from a utilitarian
debug-tool aesthetic to a polished, Claude Code-inspired experience.

**Design principles:**

- Conversation is primary - no permanent side panes
- Fewer borders, more backgrounds - color defines regions
- Cool/professional palette, themeable
- Cmd-K HUD for accessing everything else
- Smooth, responsive streaming experience

---

## Layout & Information Architecture

### Single-View Model

Abandon the three-pane layout. The TUI is a **conversation view** - full width,
full height, with a minimal status bar at the bottom.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Conversation flows here                            │
│  - Your messages                                    │
│  - Agent responses (streaming)                      │
│  - Tool calls (inline, compact)                     │
│                                                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│ > _                                                 │
├─────────────────────────────────────────────────────┤
│ claude-3.5-sonnet · anthropic · 12.4k tokens · ~/proj │
└─────────────────────────────────────────────────────┘
```

### Status Bar (Bottom)

One line showing:

- Model name
- Provider
- Token usage
- Current working directory
- Connection state indicator if issues

### Input Area

No visible border - just a prompt character and cursor. Grows upward as you
type multiple lines. Maximum ~30% of screen before internal scroll.

- **Submission**: Cmd+Enter (or Ctrl+Enter) to send
- **Newlines**: Plain Enter
- **History**: Up arrow at empty prompt cycles history

### Overlay Views

Debug/Activity/Logs accessed via Cmd-K. They appear as **full-screen takeovers**
that replace the conversation temporarily. Escape returns to conversation.

---

## Conversation Rendering

### Message Blocks

Messages are visually distinct via **subtle background color shifts**, not
borders:

- **Your messages**: Slightly elevated background
- **Agent messages**: Default background, text streams smoothly
- **System/errors**: Tinted background (subtle red for errors, blue for info)

### Thinking State

When agent is processing:

```
⠸ Thinking...
```

Animated spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ cycle), muted color. Transforms into actual
content as tokens arrive.

### Tool Calls Inline

Tool calls appear in conversation flow with minimal chrome:

```
▶ shell.exec npm test
  ⠸ Running...
```

Single character markers:

- `▶` running
- `✓` success
- `✗` error
- `⋯` pending

Tool block distinguished by background color shift, not lines or bars.
Expandable with Enter to see full input/output.

### Streaming

Tokens appear smoothly. Cursor/block at end shows streaming in progress. No
jarring redraws.

### Abort Feedback

If user hits Ctrl+C during generation:

```
Here's what I'll d—

✗ Interrupted
```

---

## The Cmd-K HUD

### Palette Design

Cmd-K opens a clean, centered overlay. Defined by distinct background floating
over dimmed conversation. No heavy borders.

```
            ╭─────────────────────────────╮
            │ > search...                 │
            │                             │
            │   Sessions                  │
            │   Settings                  │
            │   Debug Log                 │
            │   Activity                  │
            │   Search Conversation       │
            │                             │
            ╰─────────────────────────────╯
```

- Search filters the list
- Selected item has background highlight (not `>` marker)
- Arrow keys navigate, Enter selects

### Nested Navigation

Selecting an item **transitions** the same HUD to that view. Escape goes back
one level or closes entirely. Feels like navigating, not opening/closing modals.

---

## Permission Requests

### Inline Presentation

Permission requests appear **inline in the conversation** where the tool call
is, not as a modal overlay:

```
▶ shell.exec
  rm -rf node_modules && npm install

  Allow this action?

  ▸ Yes, once
    Yes, always for this tool
    No, deny
    ──────────────────────────────
    _                               ← guidance input
    ──────────────────────────────
    Show full details
```

### Interaction

- Arrow keys move selection indicator (`▸`)
- Enter submits selected option
- Guidance line is just an input field - arrow to it and type
- Show full details expands to complete tool input/metadata

### Contextual Information

Shows:

- Tool name
- The actual command/input (formatted, not raw JSON)
- Affected path if relevant

Full details available on demand, but not shown by default.

### Batch Permissions

If multiple permissions queue, show count and cycle through one at a time.

---

## Sessions & Configuration

### Session Switching (Cmd-K → Sessions)

```
  Sessions

  > filter...

  ▸ lace-tui refactor          ~/github/lace     2m ago
    api-redesign               ~/github/lace     1h ago
    debugging-auth             ~/work/auth       3d ago

  ──────────────────────────────────────────────────────
  [Enter] load  [r] rename  [n] new  [d] delete
```

Clean list: alias/name, directory, relative time. No raw session IDs unless
expanded. Background highlight for selection.

### Settings (Cmd-K → Settings)

Not a step-by-step wizard. A clean settings panel:

```
  Settings

  Connection    ▸ anthropic-prod          [Enter to change]
  Model         ▸ claude-3.5-sonnet       [Enter to change]
  Theme         ▸ dark                    [Enter to change]

  ──────────────────────────────────────────────────────
  Environment Variables                   [e] to edit
  Debug Logging                           [d] toggle
```

Selecting an item drills into a picker. Same HUD, just navigates deeper.

### First-Run / No Connection

Gentle inline prompt, not a blocking wizard:

```
  No connection configured.

  Press Ctrl+K → Settings to set up a provider.
```

---

## Debug/Activity/Log Overlays

### Full-Screen Takeover

When invoked from Cmd-K, the entire conversation area becomes that view. Status
bar stays visible.

### Debug Log View

```
  Debug Log                                    [Esc to close]

  14:23:01  → session/prompt id=req_003
  14:23:01  ← session/update text_delta
  14:23:02  ← session/update tool_use shell.exec
  14:23:02  → session/permission_response allow
  14:23:05  ← session/update tool_result ok
  14:23:05  ← session/update turn_end

  ──────────────────────────────────────────────────────
  > filter: _
```

Clean timestamps, direction arrows, compact summaries. Scrollable with optional
filter.

### Activity View

```
  Activity                                     [Esc to close]

  ✓ shell.exec  npm test           2.3s
  ✓ file.read   src/main.rs        0.1s
  ▶ shell.exec  cargo build        running...
```

Select item, Enter for full details.

### Quick Toggles

Direct shortcuts (Ctrl+D for debug, Ctrl+A for activity) to flip in/out without
Cmd-K.

---

## Visual Language & Theming

### Color System

Semantic color tokens that themes override:

| Token         | Purpose                    | Cool/Pro Default |
| ------------- | -------------------------- | ---------------- |
| `bg-base`     | Main background            | #1a1a2e          |
| `bg-elevated` | User messages, HUD         | #252542          |
| `bg-surface`  | Inputs, selected items     | #2d2d4a          |
| `fg-primary`  | Main text                  | #e0e0e0          |
| `fg-muted`    | Secondary text, hints      | #888899          |
| `accent`      | Focus, links, active state | #6c9bff          |
| `success`     | Completed, approved        | #6bcc8a          |
| `error`       | Failed, denied             | #e06070          |
| `warning`     | Caution, pending           | #d4a054          |

### Themes

Themes swap token values. Light theme inverts the background/foreground
relationships. High contrast theme increases contrast ratios.

### Minimal Borders

Borders only where truly needed (maybe HUD edge for visual lift). Everything
else uses background color differentiation.

---

## Error States

### Connection Errors

Inline with actionable message:

```
  ✗ Connection failed: API key invalid

    Check your credentials in Settings (Ctrl+K)
```

### Tool Failures

Inline with the tool call, collapsed by default:

```
  ✗ shell.exec npm test
    Exit code 1

    ▸ Show output
```

### Network Issues

Status bar indicator:

```
│ ⚠ Reconnecting...  sonnet · anthropic · ~/proj      │
```

---

## Implementation Priorities

### Phase 1: Core Visual Overhaul

1. Replace border-based layout with background-based regions
2. Implement semantic color token system with theme support
3. Redesign status bar (move to bottom, clean up content)
4. Redesign input area (borderless, growing)

### Phase 2: Conversation Experience

1. Redesign message rendering (background blocks)
2. Implement inline tool call display (single-char markers, background tint)
3. Polish streaming experience (spinner, smooth text flow)
4. Implement inline permission UI

### Phase 3: HUD Redesign

1. Redesign Cmd-K palette (background-based, clean typography)
2. Implement nested navigation model
3. Redesign sessions view
4. Redesign settings view
5. Implement full-screen debug/activity overlays

### Phase 4: Polish

1. Animations and transitions
2. Additional themes (light, high-contrast)
3. Keyboard shortcut refinements
4. Edge case handling

---

## Open Questions

1. **Rounded corners**: Support varies by terminal. Fallback strategy?
2. **True color support**: Assume 24-bit color or degrade gracefully?
3. **Unicode markers**: Safe to assume unicode support (✓✗▶) or need ASCII
   fallbacks?
4. **Vim mode**: Keep the j/k mapping? Expand it?
