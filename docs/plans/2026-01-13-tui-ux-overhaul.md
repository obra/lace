# TUI UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform lace-tui from a workmanlike debug tool into a polished, joyful conversation interface by eliminating visual clutter and making interactions feel seamless.

**Architecture:** Replace text labels with color and line-drawing characters for visual hierarchy. Move permissions inline into the conversation flow. Group consecutive messages to reduce noise. Fold tool outputs by default. Remove redundant UI elements.

**Tech Stack:** Rust, ratatui 0.29, crossterm 0.28, Unicode box-drawing characters

---

## Visual Language Reference

### Box-Drawing Characters

```
Single line: ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼
Double line: ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬
Rounded:     ╭ ╮ ╰ ╯
Mixed:       ╞ ╡ ╥ ╨
```

### Status Indicators

```
Running:  ▶ (or spinner ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
Success:  ✓
Error:    ✗
Pending:  ◦
Approved: ●
Denied:   ○
```

### Message Visual Treatment

Instead of "you" and "assistant" text labels:

```
┃ User message uses a colored left border (accent color)
┃ with slightly elevated background
┃

  Assistant message has no border, just flows naturally
  on the base background color

▶ tool_name argument_summary
  └─ result summary (expandable)
```

---

## Phase 1: Message Visual Hierarchy

### Task 1.1: Add Message Border Rendering

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:2924-2979` (render_chat function)

**Step 1: Write the failing test**

Create test file `packages/tui/src/ui/chat_rendering_tests.rs`:

```rust
// ABOUTME: Tests for chat message rendering with visual hierarchy

#[cfg(test)]
mod tests {
    use crate::app::{AppState, ChatMessage, Role};

    #[test]
    fn user_message_has_left_border_indicator() {
        let mut state = AppState::new();
        state.messages.push(ChatMessage {
            role: Role::User,
            text: "Hello".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

        let lines = render_chat_lines(&state);
        // User messages should start with "┃ " (border character + space)
        assert!(lines[0].spans[0].content.starts_with("┃"));
    }

    #[test]
    fn assistant_message_has_no_border() {
        let mut state = AppState::new();
        state.messages.push(ChatMessage {
            role: Role::Assistant,
            text: "Hi there".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

        let lines = render_chat_lines(&state);
        // Assistant messages should not start with border
        assert!(!lines[0].spans[0].content.starts_with("┃"));
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tui && cargo test chat_rendering_tests -v`

Expected: FAIL - module doesn't exist or function not found

**Step 3: Extract render_chat_lines helper**

In `packages/tui/src/ui/mod.rs`, extract the line-building logic into a testable function:

```rust
/// Renders chat messages into lines with visual hierarchy.
/// User messages get a colored left border (┃), assistant messages flow naturally.
fn render_chat_lines(state: &AppState) -> Vec<Line<'static>> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    for (i, m) in state.messages.iter().enumerate() {
        // Add spacing between messages (but not before first)
        if i > 0 {
            lines.push(Line::from(""));
        }

        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        // Render each line of the message
        let content_lines: Vec<&str> = text.lines().collect();
        let content_lines = if content_lines.is_empty() { vec![""] } else { content_lines };

        for line_text in content_lines {
            match m.role {
                Role::User => {
                    // User messages: colored left border + elevated background feel
                    lines.push(Line::from(vec![
                        Span::styled("┃ ", Style::default().fg(colors.accent)),
                        Span::styled(
                            line_text.to_string(),
                            Style::default().fg(colors.fg_primary),
                        ),
                    ]));
                }
                Role::Assistant => {
                    // Assistant messages: no border, natural flow
                    if state.prefs.render_markdown {
                        for l in markdown::render_markdownish_lines(line_text) {
                            let style = if l.is_code {
                                Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                            } else {
                                Style::default().fg(colors.fg_primary)
                            };
                            lines.push(Line::from(Span::styled(l.text, style)));
                        }
                    } else {
                        lines.push(Line::from(Span::styled(
                            line_text.to_string(),
                            Style::default().fg(colors.fg_primary),
                        )));
                    }
                }
            }
        }
    }

    lines
}
```

**Step 4: Update render_chat to use the helper**

```rust
fn render_chat(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let mut lines = render_chat_lines(state);

    // Show in-progress tool calls inline
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        lines.push(Line::from(""));
        for item in pending_tools {
            lines.push(render_tool_call_line(item, colors));
        }
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.chat_scroll, 0))
}
```

**Step 5: Run test to verify it passes**

Run: `cd packages/tui && cargo test chat_rendering_tests -v`

Expected: PASS

**Step 6: Commit**

```bash
git add packages/tui/src/ui/mod.rs packages/tui/src/ui/chat_rendering_tests.rs
git commit -m "feat(tui): replace text labels with colored border for user messages"
```

---

### Task 1.2: Remove "you" and "assistant" Labels

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:2924-2979`

**Step 1: Verify current state has labels**

Run TUI and confirm "you" and "assistant" labels appear before messages.

**Step 2: Remove label rendering**

The changes in Task 1.1 already remove the labels. Verify by checking the `render_chat_lines` function no longer includes:

```rust
// REMOVE these lines:
let role_text = match m.role {
    Role::User => "you",
    Role::Assistant => "assistant",
};
lines.push(Line::from(Span::styled(role_text, prefix_style)));
```

**Step 3: Visual verification**

Run: `cd packages/tui && cargo run -- --workdir .`

Verify: Messages no longer show "you" or "assistant" labels. User messages have a colored `┃` border instead.

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "refactor(tui): remove you/assistant text labels, use visual distinction"
```

---

### Task 1.3: Message Grouping for Consecutive Same-Role Messages

**Files:**
- Modify: `packages/tui/src/ui/mod.rs` (render_chat_lines)

**Step 1: Write the failing test**

Add to `packages/tui/src/ui/chat_rendering_tests.rs`:

```rust
#[test]
fn consecutive_user_messages_grouped_visually() {
    let mut state = AppState::new();
    state.messages.push(ChatMessage {
        role: Role::User,
        text: "First message".to_string(),
        streaming: false,
        turn_id: None,
        turn_seq: None,
    });
    state.messages.push(ChatMessage {
        role: Role::User,
        text: "Second message".to_string(),
        streaming: false,
        turn_id: None,
        turn_seq: None,
    });

    let lines = render_chat_lines(&state);

    // Both messages should have border, but no blank line between them
    // when they're from the same role
    let line_count = lines.len();
    // Should be: line1, line2 (no blank separator for same role)
    assert_eq!(line_count, 2);
}

#[test]
fn different_role_messages_have_separator() {
    let mut state = AppState::new();
    state.messages.push(ChatMessage {
        role: Role::User,
        text: "User message".to_string(),
        streaming: false,
        turn_id: None,
        turn_seq: None,
    });
    state.messages.push(ChatMessage {
        role: Role::Assistant,
        text: "Assistant message".to_string(),
        streaming: false,
        turn_id: None,
        turn_seq: None,
    });

    let lines = render_chat_lines(&state);

    // Should have blank line between different roles
    // line1 (user), blank, line2 (assistant) = 3 lines
    assert_eq!(lines.len(), 3);
}
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tui && cargo test consecutive_user_messages -v`

Expected: FAIL - currently adds blank line between all messages

**Step 3: Update render_chat_lines with grouping logic**

```rust
fn render_chat_lines(state: &AppState) -> Vec<Line<'static>> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();
    let mut prev_role: Option<Role> = None;

    for m in &state.messages {
        // Add spacing only between different roles
        let same_role = prev_role.as_ref() == Some(&m.role);
        if !lines.is_empty() && !same_role {
            lines.push(Line::from(""));
        }
        prev_role = Some(m.role.clone());

        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        let content_lines: Vec<&str> = text.lines().collect();
        let content_lines = if content_lines.is_empty() { vec![""] } else { content_lines };

        for line_text in content_lines {
            match m.role {
                Role::User => {
                    lines.push(Line::from(vec![
                        Span::styled("┃ ", Style::default().fg(colors.accent)),
                        Span::styled(
                            line_text.to_string(),
                            Style::default().fg(colors.fg_primary),
                        ),
                    ]));
                }
                Role::Assistant => {
                    if state.prefs.render_markdown {
                        for l in markdown::render_markdownish_lines(line_text) {
                            let style = if l.is_code {
                                Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                            } else {
                                Style::default().fg(colors.fg_primary)
                            };
                            lines.push(Line::from(Span::styled(l.text, style)));
                        }
                    } else {
                        lines.push(Line::from(Span::styled(
                            line_text.to_string(),
                            Style::default().fg(colors.fg_primary),
                        )));
                    }
                }
            }
        }
    }

    lines
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/tui && cargo test chat_rendering_tests -v`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/tui/src/ui/mod.rs packages/tui/src/ui/chat_rendering_tests.rs
git commit -m "feat(tui): group consecutive same-role messages without separator"
```

---

## Phase 2: Inline Permissions

### Task 2.1: Create Inline Permission Renderer

**Files:**
- Create: `packages/tui/src/ui/permission.rs`
- Modify: `packages/tui/src/ui/mod.rs` (add module, integrate)

**Step 1: Write the failing test**

Create `packages/tui/src/ui/permission.rs`:

```rust
// ABOUTME: Inline permission UI rendering - shows permission requests
// within the conversation flow instead of blocking modals.

use crate::app::{AppState, PermissionRequest};
use crate::ui::theme::ThemeColors;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

/// Renders a permission request as lines to be inserted into the conversation.
/// Returns empty vec if no active permission.
pub fn render_permission_inline(state: &AppState) -> Vec<Line<'static>> {
    let Some(req) = &state.active_permission else {
        return Vec::new();
    };

    let colors = crate::ui::theme::ThemeColors::from_pref(state.prefs.theme);
    render_permission_lines(req, state, &colors)
}

fn render_permission_lines(
    req: &PermissionRequest,
    state: &AppState,
    colors: &ThemeColors,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    // Tool info line with visual indicator
    let tool = req.tool.clone().unwrap_or_else(|| "unknown".to_string());
    lines.push(Line::from(vec![
        Span::styled("▶ ", Style::default().fg(colors.warning)),
        Span::styled(
            tool,
            Style::default().fg(colors.fg_primary).add_modifier(Modifier::BOLD),
        ),
    ]));

    // Resource/command preview
    if let Some(resource) = &req.resource {
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(resource.clone(), Style::default().fg(colors.fg_secondary)),
        ]));
    }

    // Tool input preview (truncated)
    if let Some(tool_call_id) = &req.tool_call_id {
        if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
            let preview = serde_json::to_string(input)
                .unwrap_or_else(|_| input.to_string());
            let truncated = if preview.len() > 60 {
                format!("{}...", &preview[..57])
            } else {
                preview
            };
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(truncated, Style::default().fg(colors.fg_muted)),
            ]));
        }
    }

    // Compact approval line with keyboard shortcuts
    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("  ╭─ ", Style::default().fg(colors.border_subtle)),
        Span::styled("[Y]", Style::default().fg(colors.success)),
        Span::styled(" Allow  ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[S]", Style::default().fg(colors.accent)),
        Span::styled(" Session  ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[N]", Style::default().fg(colors.error)),
        Span::styled(" Deny  ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[?]", Style::default().fg(colors.fg_muted)),
        Span::styled(" Details", Style::default().fg(colors.fg_muted)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("  ╰─────────────────────────────────────────╯",
            Style::default().fg(colors.border_subtle)),
    ]));

    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{AppState, PermissionOption, PermissionRequest};
    use serde_json::json;

    #[test]
    fn renders_empty_when_no_permission() {
        let state = AppState::new();
        let lines = render_permission_inline(&state);
        assert!(lines.is_empty());
    }

    #[test]
    fn renders_tool_name_with_indicator() {
        let mut state = AppState::new();
        state.active_permission = Some(PermissionRequest {
            id: json!("test"),
            tool: Some("bash".to_string()),
            kind: None,
            resource: Some("npm test".to_string()),
            tool_call_id: None,
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![],
        });

        let lines = render_permission_inline(&state);

        // Should have tool line, resource line, blank, shortcut line, close line
        assert!(lines.len() >= 4);

        // First line should contain tool name
        let first_line_text: String = lines[0].spans.iter()
            .map(|s| s.content.to_string())
            .collect();
        assert!(first_line_text.contains("bash"));
    }

    #[test]
    fn shows_keyboard_shortcuts() {
        let mut state = AppState::new();
        state.active_permission = Some(PermissionRequest {
            id: json!("test"),
            tool: Some("file_read".to_string()),
            kind: None,
            resource: None,
            tool_call_id: None,
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![],
        });

        let lines = render_permission_inline(&state);

        // Should contain Y, S, N shortcuts
        let all_text: String = lines.iter()
            .flat_map(|l| l.spans.iter())
            .map(|s| s.content.to_string())
            .collect();
        assert!(all_text.contains("[Y]"));
        assert!(all_text.contains("[S]"));
        assert!(all_text.contains("[N]"));
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tui && cargo test permission::tests -v`

Expected: FAIL - module doesn't exist

**Step 3: Add module to ui/mod.rs**

At top of `packages/tui/src/ui/mod.rs`:

```rust
mod markdown;
mod permission;
pub mod theme;
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/tui && cargo test permission::tests -v`

Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add packages/tui/src/ui/permission.rs packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add inline permission renderer with keyboard shortcuts"
```

---

### Task 2.2: Integrate Inline Permission into Conversation

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:2924-2979` (render_chat)
- Modify: `packages/tui/src/ui/mod.rs:1441-1444` (remove modal rendering)

**Step 1: Update render_chat to include permission inline**

In the `render_chat` function, after tool calls and before creating the Paragraph:

```rust
fn render_chat(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let mut lines = render_chat_lines(state);

    // Show in-progress tool calls inline
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        lines.push(Line::from(""));
        for item in pending_tools {
            lines.push(render_tool_call_line(item, colors));
        }
    }

    // Show active permission inline (not as modal)
    let permission_lines = permission::render_permission_inline(state);
    if !permission_lines.is_empty() {
        lines.push(Line::from(""));
        lines.extend(permission_lines);
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.chat_scroll, 0))
}
```

**Step 2: Remove modal permission rendering from draw()**

In `packages/tui/src/ui/mod.rs`, in the `draw()` function around line 1441, remove or comment out:

```rust
// REMOVE these lines from the modal chain:
} else if state.active_permission.is_some() {
    let area = centered_rect(80, 70, f.area());
    f.render_widget(Clear, area);
    f.render_widget(render_permission_modal(state), area);
}
```

**Step 3: Visual verification**

Run: `cd packages/tui && cargo run -- --workdir .`

Test: Send a message that triggers a tool requiring permission. Verify it appears inline in the conversation, not as a centered modal.

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): show permissions inline in conversation, remove modal"
```

---

### Task 2.3: Add Single-Key Permission Shortcuts

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:278-307` (permission key handling)
- Modify: `packages/tui/src/app/ui.rs` (add new UiAction variants if needed)

**Step 1: Update permission key handling**

In `packages/tui/src/ui/mod.rs`, replace the permission key handling block:

```rust
if let Some(req) = &state.active_permission {
    let action = match key.code {
        // Single-key shortcuts (work regardless of guidance focus)
        KeyCode::Char('y') | KeyCode::Char('Y') => {
            // Select first option (usually "Allow once")
            state.active_permission_selected = 0;
            Some(UiAction::PermissionSubmit)
        }
        KeyCode::Char('s') | KeyCode::Char('S') => {
            // Select second option (usually "Allow for session")
            if req.options.len() > 1 {
                state.active_permission_selected = 1;
            }
            Some(UiAction::PermissionSubmit)
        }
        KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
            // Deny/cancel
            Some(UiAction::PermissionCancel)
        }
        KeyCode::Char('?') => {
            // Toggle details view (future enhancement)
            // For now, just cycle to show more info
            Some(UiAction::PermissionNext)
        }
        // Arrow key navigation still works
        KeyCode::Up => Some(UiAction::PermissionPrev),
        KeyCode::Down => Some(UiAction::PermissionNext),
        KeyCode::Enter => Some(UiAction::PermissionSubmit),
        // Guidance input when in guidance mode
        KeyCode::Backspace => {
            let options_count = req.options.len();
            if state.active_permission_selected == options_count {
                Some(UiAction::PermissionGuidanceBackspace)
            } else {
                None
            }
        }
        KeyCode::Char(ch) => {
            let options_count = req.options.len();
            if state.active_permission_selected == options_count {
                Some(UiAction::PermissionGuidanceChar(ch))
            } else {
                None
            }
        }
        _ => None,
    };
    if let Some(action) = action {
        let out = apply_ui_action(state, action);
        send_outbound(transport, state, out, timeout_ms)?;
    }
    continue;
}
```

**Step 2: Test keyboard shortcuts**

Run: `cd packages/tui && cargo run -- --workdir .`

Test:
- Trigger a permission request
- Press `Y` - should approve immediately
- Trigger another, press `N` - should deny
- Trigger another, press `S` - should approve for session

**Step 3: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add Y/S/N single-key shortcuts for permissions"
```

---

## Phase 3: Tool Result Folding

### Task 3.1: Add Folded Tool Result Display

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:2897-2922` (render_tool_call_line)
- Modify: `packages/tui/src/app/activity.rs` (add result_preview field)

**Step 1: Update ActivityItem to include result preview**

In `packages/tui/src/app/activity.rs`, add field to ActivityItem:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityItem {
    pub seq: u64,
    pub kind: ActivityKind,
    pub summary: String,
    pub expanded: bool,
    pub details: Option<Value>,

    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub status: Option<String>,
    pub job_id: Option<String>,
    pub turn_id: Option<String>,
    pub turn_seq: Option<i64>,

    // New: compact result preview for folded display
    pub result_preview: Option<String>,
}
```

**Step 2: Update all ActivityItem constructors**

Search for all places creating ActivityItem and add `result_preview: None`.

**Step 3: Update render_tool_call_line for folded display**

In `packages/tui/src/ui/mod.rs`:

```rust
/// Renders a tool call with status indicator and optional folded result.
fn render_tool_call_line(item: &activity::ActivityItem, colors: &theme::ThemeColors) -> Vec<Line<'static>> {
    let status_char = match item.status.as_deref() {
        Some("completed") | Some("success") => '✓',
        Some("error") => '✗',
        _ => '▶',
    };
    let status_color = match item.status.as_deref() {
        Some("completed") | Some("success") => colors.success,
        Some("error") => colors.error,
        _ => colors.accent,
    };

    let tool_name = item
        .tool_name
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let mut lines = Vec::new();

    // Main tool line
    lines.push(Line::from(vec![
        Span::styled(
            format!("{} ", status_char),
            Style::default().fg(status_color),
        ),
        Span::styled(tool_name, Style::default().fg(colors.fg_primary)),
        Span::styled(
            format!(" {}", item.summary),
            Style::default().fg(colors.fg_muted),
        ),
    ]));

    // Folded result preview (if completed and has preview)
    if item.status.as_deref() == Some("completed") || item.status.as_deref() == Some("success") {
        if let Some(preview) = &item.result_preview {
            lines.push(Line::from(vec![
                Span::styled("  └─ ", Style::default().fg(colors.border_subtle)),
                Span::styled(
                    truncate_preview(preview, 50),
                    Style::default().fg(colors.fg_muted),
                ),
            ]));
        }
    }

    lines
}

fn truncate_preview(s: &str, max_len: usize) -> String {
    let first_line = s.lines().next().unwrap_or(s);
    if first_line.len() > max_len {
        format!("{}...", &first_line[..max_len - 3])
    } else {
        first_line.to_string()
    }
}
```

**Step 4: Update render_chat to handle Vec<Line> from tool calls**

```rust
// In render_chat, update the pending tools section:
let pending_tools = state.pending_tool_calls();
if !pending_tools.is_empty() {
    lines.push(Line::from(""));
    for item in pending_tools {
        lines.extend(render_tool_call_line(item, colors));
    }
}
```

**Step 5: Commit**

```bash
git add packages/tui/src/app/activity.rs packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add folded tool result preview with tree connector"
```

---

## Phase 4: Input Area Cleanup

### Task 4.1: Remove Redundant Hint Line

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:3140-3239` (render_input)

**Step 1: Identify the hint line code**

Current code has a permanent hint line:

```rust
// Render input hint line (Alt+Enter newline, Enter/Ctrl+Enter send)
let hint = Paragraph::new(Text::from(vec![Line::from(vec![
    Span::styled(
        "Alt+Enter: newline   Enter: send   Ctrl+Enter: send",
        Style::default().fg(colors.fg_muted),
    ),
])]));
```

This duplicates info already in the status bar.

**Step 2: Remove the hint row from layout**

Change the layout constraint from:

```rust
let rows = Layout::default()
    .direction(Direction::Vertical)
    .constraints([Constraint::Min(1), Constraint::Length(1)])
    .split(input_area);
```

To:

```rust
// Single row for input, no hint line
let rows = Layout::default()
    .direction(Direction::Vertical)
    .constraints([Constraint::Min(1)])
    .split(input_area);
```

**Step 3: Remove hint rendering**

Delete the hint Paragraph and its render call.

**Step 4: Also remove duplicate hints from status bar right**

In `render_status_right`, simplify the idle state to not show hints:

```rust
} else {
    // Clean status when idle - no hints needed
    spans.push(Span::raw(""));
}
```

**Step 5: Visual verification**

Run: `cd packages/tui && cargo run -- --workdir .`

Verify: Input area is cleaner, no redundant hint line.

**Step 6: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "refactor(tui): remove redundant input hint line, cleaner input area"
```

---

### Task 4.2: Simplify Image Attachment Indicator

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:3144-3176` (image indicator in render_input)

**Step 1: Make indicator more compact**

Current: `[1 image attached]` on its own line

New: Inline indicator `📎 1` in the prompt area

```rust
fn render_input(f: &mut ratatui::Frame, state: &AppState, area: ratatui::layout::Rect) {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(2), Constraint::Min(1)])
        .split(area);

    // Render prompts with optional image count
    let mut prompt_lines: Vec<Line> = Vec::new();
    let input_lines = input_lines_with_cursor(state);
    let line_count = input_lines.len() as u16;

    for i in 0..line_count {
        let prefix = if i == 0 {
            if state.pending_images.is_empty() {
                "> ".to_string()
            } else {
                format!("{}> ", state.pending_images.len())
            }
        } else {
            "  ".to_string()
        };

        let style = if i == 0 && !state.pending_images.is_empty() {
            Style::default().fg(colors.accent)
        } else {
            Style::default().fg(colors.accent)
        };

        prompt_lines.push(Line::from(Span::styled(prefix, style)));
    }

    // ... rest of input rendering
}
```

**Step 2: Remove separate image indicator area**

Delete the separate indicator rendering block that created its own area.

**Step 3: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "refactor(tui): compact image attachment indicator in prompt"
```

---

## Phase 5: Status Bar Polish

### Task 5.1: Move Status Bar Below Input

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:1347-1358` (draw function layout)

**Step 1: Reorder layout constraints**

Current order: main, status, input

New order: main, input, status (status at very bottom)

```rust
let root = Layout::default()
    .direction(Direction::Vertical)
    .constraints([
        Constraint::Min(1),               // main area
        Constraint::Length(input_height), // input
        Constraint::Length(1),            // status at BOTTOM
    ])
    .split(f.area());

let main_area = root[0];
let input_area = root[1];
let status_area = root[2];
```

**Step 2: Update slash picker positioning**

The slash picker appears above input. With new layout, update the y calculation:

```rust
if state.slash_picker_open {
    let picker_height = 12u16;
    // Input is now at root[1], so picker goes above it
    let picker_y = input_area.y.saturating_sub(picker_height);
    // ... rest unchanged
}
```

**Step 3: Visual verification**

Run: `cd packages/tui && cargo run -- --workdir .`

Verify: Status bar is at the very bottom of the terminal.

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): move status bar to bottom of screen"
```

---

### Task 5.2: Clean Up Status Bar Content

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:1499-1598` (render_status_left and render_status_right)

**Step 1: Simplify status_right to just show activity**

```rust
fn render_status_right(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut spans: Vec<Span> = Vec::new();

    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        if let Some(tool) = pending_tools.first() {
            let tool_name = tool
                .tool_name
                .clone()
                .unwrap_or_else(|| "working".to_string());
            spans.push(Span::styled(
                format!("{} {} ", spinning_char(), tool_name),
                Style::default().fg(colors.spinner),
            ));
        }
    } else if state.is_thinking() {
        spans.push(Span::styled(
            format!("{} ", spinning_char()),
            Style::default().fg(colors.spinner),
        ));
    }
    // No hints or key display when idle - keep it clean

    Paragraph::new(Line::from(spans)).style(Style::default().bg(colors.bg_surface))
}
```

**Step 2: Remove last_key_event display**

Delete the code that shows the last key pressed - it's debug info that clutters the UI.

**Step 3: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "refactor(tui): clean up status bar, remove debug clutter"
```

---

## Phase 6: Final Polish

### Task 6.1: Update Help Text

**Files:**
- Modify: `packages/tui/src/ui/mod.rs` (render_help_modal)

**Step 1: Find and update help modal**

Search for `render_help_modal` and update the keyboard shortcuts to reflect new behavior:

- Add: `Y/S/N` for permission shortcuts
- Remove: References to removed features
- Update: Any outdated descriptions

**Step 2: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "docs(tui): update help text with new keyboard shortcuts"
```

---

### Task 6.2: Remove Dead Code

**Files:**
- Modify: `packages/tui/src/ui/mod.rs`

**Step 1: Remove render_permission_modal function**

Since we now use inline permissions, the modal renderer is dead code.

**Step 2: Remove any `#[allow(dead_code)]` that's no longer needed**

**Step 3: Run clippy to find other dead code**

Run: `cd packages/tui && cargo clippy`

Fix any warnings about unused code.

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "chore(tui): remove dead permission modal code"
```

---

### Task 6.3: Full Visual Testing

**Steps:**

1. Run TUI: `cd packages/tui && cargo run -- --workdir .`

2. Test conversation display:
   - Send a message, verify user message has colored `┃` border
   - Verify assistant response has no label, just flows naturally
   - Send multiple messages in a row, verify they group without separators

3. Test permissions:
   - Trigger a tool that needs permission
   - Verify it appears inline in conversation
   - Press `Y` - should approve
   - Trigger another, press `N` - should deny
   - Trigger another, press `S` - should approve for session

4. Test tool display:
   - Run a command that produces output
   - Verify tool shows with `✓` status and folded preview

5. Test input area:
   - Verify no redundant hint line
   - Verify status bar is at very bottom

6. Test themes:
   - Switch to light theme, verify colors work
   - Switch to high contrast, verify accessibility

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat(tui): complete UX overhaul - visual hierarchy, inline permissions, cleaner layout"
```

---

## Summary

**Total Tasks:** 14 tasks across 6 phases

**Key Changes:**

1. **Visual Hierarchy** - Replace "you"/"assistant" labels with colored `┃` border for user messages
2. **Message Grouping** - Consecutive same-role messages grouped without separators
3. **Inline Permissions** - Permission requests appear in conversation flow with `Y/S/N` shortcuts
4. **Tool Folding** - Tool results show compact preview with `└─` connector
5. **Clean Input** - Remove redundant hint line, compact image indicator
6. **Status Bar** - Move to bottom, remove debug clutter

**Testing Approach:**

- Unit tests for rendering functions
- Visual verification for layout changes
- Manual testing of keyboard shortcuts
- Clippy for dead code detection

---

Plan complete and saved to `docs/plans/2026-01-13-tui-ux-overhaul.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session in worktree with executing-plans, batch execution with checkpoints

Which approach?
