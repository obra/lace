# TUI UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform lace-tui from a workmanlike debug tool into a polished, joyful conversation interface by eliminating visual clutter and making interactions feel seamless.

**Architecture:** Replace text labels with color and line-drawing characters for visual hierarchy. Redesign permission modal to be bottom-anchored with single-key shortcuts (still modal, but less disruptive). Group consecutive messages to reduce noise. Fold tool outputs by default with progressive expansion. Remove redundant UI elements.

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

## Phase 2: Bottom-Anchored Permission Modal

Permissions must be modal (agent is blocked waiting for decision), but we can make the modal less disruptive by anchoring it at the bottom where it doesn't hide conversation context.

### Task 2.1: Create Bottom-Anchored Permission Bar Renderer

**Files:**
- Modify: `packages/tui/src/ui/mod.rs` (new render_permission_bar function)

**Step 1: Write the failing test**

Add to a test module in `packages/tui/src/ui/mod.rs`:

```rust
#[cfg(test)]
mod permission_bar_tests {
    use super::*;
    use crate::app::{AppState, PermissionOption, PermissionRequest};
    use serde_json::json;

    fn make_permission_request(tool: &str, resource: Option<&str>) -> PermissionRequest {
        PermissionRequest {
            id: json!("test"),
            tool: Some(tool.to_string()),
            kind: None,
            resource: resource.map(|s| s.to_string()),
            tool_call_id: None,
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![
                PermissionOption { option_id: "allow".to_string(), label: "Allow once".to_string() },
                PermissionOption { option_id: "session".to_string(), label: "Allow for session".to_string() },
                PermissionOption { option_id: "deny".to_string(), label: "Deny".to_string() },
            ],
        }
    }

    #[test]
    fn permission_bar_shows_tool_and_shortcuts() {
        let mut state = AppState::new();
        state.active_permission = Some(make_permission_request("bash", Some("npm test")));

        let widget = render_permission_bar(&state);
        // Widget should be renderable (not panic)
        assert!(true);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tui && cargo test permission_bar_tests -v`

Expected: FAIL - function doesn't exist

**Step 3: Implement render_permission_bar**

Add new function to `packages/tui/src/ui/mod.rs`:

```rust
/// Renders a compact permission bar for bottom-anchored display.
/// Shows tool name, resource preview, and keyboard shortcuts.
fn render_permission_bar(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let Some(req) = &state.active_permission else {
        return Paragraph::new(Text::from(""));
    };

    let tool = req.tool.clone().unwrap_or_else(|| "unknown".to_string());
    let resource = req.resource.clone().unwrap_or_default();
    let resource_preview = if resource.len() > 40 {
        format!("{}...", &resource[..37])
    } else {
        resource
    };

    let mut lines: Vec<Line> = Vec::new();

    // Top border with tool name
    lines.push(Line::from(vec![
        Span::styled("╞═ ", Style::default().fg(colors.warning)),
        Span::styled("Allow ", Style::default().fg(colors.fg_primary)),
        Span::styled(
            tool,
            Style::default().fg(colors.accent).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" {} ", resource_preview),
            Style::default().fg(colors.fg_muted),
        ),
        Span::styled("?", Style::default().fg(colors.fg_primary)),
        Span::styled(" ═══════════════════════════════════════════╡",
            Style::default().fg(colors.warning)),
    ]));

    // Shortcut line
    lines.push(Line::from(vec![
        Span::styled("│  ", Style::default().fg(colors.warning)),
        Span::styled("[Y]", Style::default().fg(colors.success).add_modifier(Modifier::BOLD)),
        Span::styled(" Allow   ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[S]", Style::default().fg(colors.accent).add_modifier(Modifier::BOLD)),
        Span::styled(" Session   ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[N]", Style::default().fg(colors.error).add_modifier(Modifier::BOLD)),
        Span::styled(" Deny   ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[D]", Style::default().fg(colors.fg_muted)),
        Span::styled(" Details", Style::default().fg(colors.fg_muted)),
        Span::raw("                          "),
        Span::styled("│", Style::default().fg(colors.warning)),
    ]));

    // Bottom border
    lines.push(Line::from(vec![
        Span::styled("╘═══════════════════════════════════════════════════════════════════╛",
            Style::default().fg(colors.warning)),
    ]));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tui && cargo test permission_bar_tests -v`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add bottom-anchored permission bar renderer"
```

---

### Task 2.2: Integrate Permission Bar into Layout

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:1333-1450` (draw function)

**Step 1: Update draw() layout to include permission bar**

When permission is active, insert a 3-line permission bar between chat and input:

```rust
fn draw(f: &mut ratatui::Frame, state: &AppState) {
    // Dynamic input height
    let input_content_width = f.area().width.saturating_sub(3) as usize;
    let lines = input_lines_with_cursor(state);
    let (cursor_row, _) = state.input.cursor();
    let mut input_line_count = count_input_wrapped_lines(&lines, cursor_row, input_content_width);
    if !state.pending_images.is_empty() {
        input_line_count += 1;
    }
    let max_input_height = f.area().height / 3;
    let input_height = (input_line_count as u16).min(max_input_height).max(1);

    // Permission bar height (only when active)
    let permission_height = if state.active_permission.is_some() { 3 } else { 0 };

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),                       // main area
            Constraint::Length(permission_height),   // permission bar (0 if inactive)
            Constraint::Length(1),                   // status
            Constraint::Length(input_height),        // input
        ])
        .split(f.area());

    let main_area = root[0];
    let permission_area = root[1];
    let status_area = root[2];
    let input_area = root[3];

    // ... existing status bar rendering ...

    // Main area
    if state.debug_overlay_open {
        f.render_widget(render_debug_overlay(state), main_area);
    } else if state.activity_overlay_open {
        f.render_widget(render_activity_overlay(state), main_area);
    } else {
        render_main(f, state, main_area);
    }

    // Permission bar (only when active)
    if state.active_permission.is_some() {
        f.render_widget(render_permission_bar(state), permission_area);
    }

    render_input(f, state, input_area);

    // ... rest of modal overlays (remove permission from the modal chain) ...
}
```

**Step 2: Remove permission from centered modal chain**

In the modal overlay section of draw(), remove:

```rust
// DELETE this block:
} else if state.active_permission.is_some() {
    let area = centered_rect(80, 70, f.area());
    f.render_widget(Clear, area);
    f.render_widget(render_permission_modal(state), area);
}
```

**Step 3: Visual verification**

Run: `cd packages/tui && cargo run -- --workdir .`

Test: Trigger a permission. Verify it appears as a 3-line bar above the input, not as a centered overlay. Conversation should still be visible above.

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): render permission bar in layout instead of centered modal"
```

---

### Task 2.3: Add Single-Key Permission Shortcuts

**Files:**
- Modify: `packages/tui/src/ui/mod.rs:278-307` (permission key handling)

**Step 1: Update permission key handling with Y/S/N shortcuts**

In `packages/tui/src/ui/mod.rs`, update the permission key handling block:

```rust
if let Some(req) = &state.active_permission {
    let action = match key.code {
        // Single-key shortcuts
        KeyCode::Char('y') | KeyCode::Char('Y') => {
            // Find "allow" option (usually first)
            if let Some(idx) = req.options.iter().position(|o|
                o.option_id.contains("allow") && !o.option_id.contains("session")
            ) {
                state.active_permission_selected = idx;
            } else {
                state.active_permission_selected = 0;
            }
            Some(UiAction::PermissionSubmit)
        }
        KeyCode::Char('s') | KeyCode::Char('S') => {
            // Find "session" option
            if let Some(idx) = req.options.iter().position(|o|
                o.option_id.contains("session") || o.label.to_lowercase().contains("session")
            ) {
                state.active_permission_selected = idx;
            }
            Some(UiAction::PermissionSubmit)
        }
        KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
            Some(UiAction::PermissionCancel)
        }
        KeyCode::Char('d') | KeyCode::Char('D') => {
            // Toggle details (expand/collapse tool input view)
            Some(UiAction::PermissionToggleDetails)
        }
        // Arrow key navigation still works
        KeyCode::Up => Some(UiAction::PermissionPrev),
        KeyCode::Down => Some(UiAction::PermissionNext),
        KeyCode::Enter => Some(UiAction::PermissionSubmit),
        _ => None,
    };
    if let Some(action) = action {
        let out = apply_ui_action(state, action);
        send_outbound(transport, state, out, timeout_ms)?;
    }
    continue;
}
```

**Step 2: Add PermissionToggleDetails action**

In `packages/tui/src/app/ui.rs`, add the new action variant:

```rust
pub enum UiAction {
    // ... existing variants ...
    PermissionToggleDetails,
}
```

And handle it in `apply_ui_action`:

```rust
UiAction::PermissionToggleDetails => {
    state.permission_details_expanded = !state.permission_details_expanded;
    Vec::new()
}
```

**Step 3: Add permission_details_expanded to AppState**

In `packages/tui/src/app/mod.rs`, add:

```rust
pub permission_details_expanded: bool,
```

Initialize to `false` in `new()`.

**Step 4: Test keyboard shortcuts**

Run: `cd packages/tui && cargo run -- --workdir .`

Test:
- Trigger a permission request
- Press `Y` - should approve immediately
- Trigger another, press `N` - should deny
- Trigger another, press `S` - should approve for session
- Press `D` - should toggle details view

**Step 5: Commit**

```bash
git add packages/tui/src/app/mod.rs packages/tui/src/app/ui.rs packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add Y/S/N/D single-key shortcuts for permissions"
```

---

### Task 2.4: Permission Details Expansion

**Files:**
- Modify: `packages/tui/src/ui/mod.rs` (render_permission_bar)

**Step 1: Update render_permission_bar to handle expanded state**

```rust
fn render_permission_bar(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let Some(req) = &state.active_permission else {
        return Paragraph::new(Text::from(""));
    };

    let tool = req.tool.clone().unwrap_or_else(|| "unknown".to_string());
    let resource = req.resource.clone().unwrap_or_default();

    let mut lines: Vec<Line> = Vec::new();

    // Top border with tool name
    lines.push(Line::from(vec![
        Span::styled("╞═ ", Style::default().fg(colors.warning)),
        Span::styled("Allow ", Style::default().fg(colors.fg_primary)),
        Span::styled(
            &tool,
            Style::default().fg(colors.accent).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" ?", Style::default().fg(colors.fg_primary)),
        // Fill rest of line
        Span::styled(
            format!(" {:═<width$}╡", "", width = 50),
            Style::default().fg(colors.warning)
        ),
    ]));

    // Show details when expanded
    if state.permission_details_expanded {
        // Resource line
        if !resource.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("│  ", Style::default().fg(colors.warning)),
                Span::styled(&resource, Style::default().fg(colors.fg_secondary)),
            ]));
        }

        // Tool input preview
        if let Some(tool_call_id) = &req.tool_call_id {
            if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
                let pretty = serde_json::to_string_pretty(input)
                    .unwrap_or_else(|_| input.to_string());
                for (i, line) in pretty.lines().take(8).enumerate() {
                    lines.push(Line::from(vec![
                        Span::styled("│  ", Style::default().fg(colors.warning)),
                        Span::styled(line.to_string(), Style::default().fg(colors.fg_muted)),
                    ]));
                }
                if pretty.lines().count() > 8 {
                    lines.push(Line::from(vec![
                        Span::styled("│  ", Style::default().fg(colors.warning)),
                        Span::styled("...", Style::default().fg(colors.fg_muted)),
                    ]));
                }
            }
        }
        lines.push(Line::from(vec![
            Span::styled("│", Style::default().fg(colors.warning)),
        ]));
    }

    // Shortcut line
    lines.push(Line::from(vec![
        Span::styled("│ ", Style::default().fg(colors.warning)),
        Span::styled("[Y]", Style::default().fg(colors.success).add_modifier(Modifier::BOLD)),
        Span::styled(" Allow  ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[S]", Style::default().fg(colors.accent).add_modifier(Modifier::BOLD)),
        Span::styled(" Session  ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[N]", Style::default().fg(colors.error).add_modifier(Modifier::BOLD)),
        Span::styled(" Deny  ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[D]", Style::default().fg(colors.fg_muted)),
        Span::styled(
            if state.permission_details_expanded { " Hide" } else { " Details" },
            Style::default().fg(colors.fg_muted)
        ),
    ]));

    // Bottom border
    lines.push(Line::from(vec![
        Span::styled(
            format!("╘{:═<width$}╛", "", width = 60),
            Style::default().fg(colors.warning)
        ),
    ]));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
}

/// Calculate permission bar height (for layout)
fn permission_bar_height(state: &AppState) -> u16 {
    if state.active_permission.is_none() {
        return 0;
    }
    if state.permission_details_expanded {
        // Base (3) + detail lines (up to 10)
        let detail_lines = state.active_permission.as_ref()
            .and_then(|req| req.tool_call_id.as_ref())
            .and_then(|id| state.tool_inputs_by_tool_call_id.get(id))
            .map(|input| {
                let pretty = serde_json::to_string_pretty(input).unwrap_or_default();
                pretty.lines().count().min(9) + 2 // +2 for resource and ... line
            })
            .unwrap_or(1) as u16;
        3 + detail_lines
    } else {
        3 // Compact: top border, shortcuts, bottom border
    }
}
```

**Step 2: Update draw() to use dynamic permission height**

Replace `let permission_height = if state.active_permission.is_some() { 3 } else { 0 };`
with `let permission_height = permission_bar_height(state);`

**Step 3: Test details toggle**

Run: `cd packages/tui && cargo run -- --workdir .`

Test: Trigger permission, press `D` to expand, verify details shown, press `D` again to collapse.

**Step 4: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add expandable details in permission bar"
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

### Task 3.2: Selectable Tool Calls in Conversation

**Files:**
- Modify: `packages/tui/src/app/mod.rs` (add chat_selected_tool_idx)
- Modify: `packages/tui/src/ui/mod.rs` (render selected state, handle keys)

**Step 1: Add tool selection state to AppState**

In `packages/tui/src/app/mod.rs`, add:

```rust
/// Index of selected tool in conversation (None = no selection)
pub chat_selected_tool_idx: Option<usize>,
```

Initialize to `None` in `new()`.

**Step 2: Track completed tools in conversation**

Create a helper that returns tools in conversation order:

```rust
impl AppState {
    /// Returns completed tool calls in conversation order for selection
    pub fn completed_tool_calls(&self) -> Vec<&activity::ActivityItem> {
        self.activity
            .iter()
            .filter(|item| {
                item.kind == activity::ActivityKind::ToolUse
                    && (item.status.as_deref() == Some("completed")
                        || item.status.as_deref() == Some("success")
                        || item.status.as_deref() == Some("error"))
            })
            .collect()
    }
}
```

**Step 3: Update render_tool_call_line to show selected state**

```rust
fn render_tool_call_line(
    item: &activity::ActivityItem,
    colors: &theme::ThemeColors,
    selected: bool,
    expanded: bool,
) -> Vec<Line<'static>> {
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

    let tool_name = item.tool_name.clone().unwrap_or_else(|| "unknown".to_string());

    let mut lines = Vec::new();

    // Selection indicator
    let prefix = if selected { "▸ " } else { "  " };
    let bg = if selected { Some(colors.bg_surface) } else { None };

    // Main tool line
    let mut spans = vec![
        Span::styled(prefix, Style::default().fg(colors.accent)),
        Span::styled(format!("{} ", status_char), Style::default().fg(status_color)),
        Span::styled(&tool_name, Style::default().fg(colors.fg_primary)),
        Span::styled(format!(" {}", item.summary), Style::default().fg(colors.fg_muted)),
    ];

    let mut style = Style::default();
    if let Some(bg_color) = bg {
        style = style.bg(bg_color);
    }
    lines.push(Line::from(spans).style(style));

    // Show expanded details when selected and expanded
    if selected && expanded {
        // Show full result
        if let Some(details) = &item.details {
            let pretty = serde_json::to_string_pretty(details)
                .unwrap_or_else(|_| details.to_string());
            for line in pretty.lines().take(15) {
                lines.push(Line::from(vec![
                    Span::styled("    ", Style::default()),
                    Span::styled(line.to_string(), Style::default().fg(colors.fg_muted)),
                ]));
            }
            if pretty.lines().count() > 15 {
                lines.push(Line::from(vec![
                    Span::styled("    ", Style::default()),
                    Span::styled("... (more)", Style::default().fg(colors.fg_muted)),
                ]));
            }
        }
    } else if !expanded {
        // Folded preview (non-selected or collapsed)
        if let Some(preview) = &item.result_preview {
            lines.push(Line::from(vec![
                Span::styled("    └─ ", Style::default().fg(colors.border_subtle)),
                Span::styled(
                    truncate_preview(preview, 50),
                    Style::default().fg(colors.fg_muted),
                ),
            ]));
        }
    }

    lines
}
```

**Step 4: Add keyboard handling for tool selection**

In `packages/tui/src/ui/mod.rs`, when focus is on Chat and no permission is active:

```rust
// Tool selection in chat (when focused on chat pane)
if state.focus == Focus::Chat {
    match key.code {
        KeyCode::Up | KeyCode::Char('k') => {
            // Move selection up through tools
            let tools = state.completed_tool_calls();
            if !tools.is_empty() {
                state.chat_selected_tool_idx = match state.chat_selected_tool_idx {
                    None => Some(tools.len() - 1),
                    Some(0) => Some(tools.len() - 1),
                    Some(i) => Some(i - 1),
                };
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            // Move selection down through tools
            let tools = state.completed_tool_calls();
            if !tools.is_empty() {
                state.chat_selected_tool_idx = match state.chat_selected_tool_idx {
                    None => Some(0),
                    Some(i) if i >= tools.len() - 1 => Some(0),
                    Some(i) => Some(i + 1),
                };
            }
        }
        KeyCode::Enter => {
            // Toggle expansion of selected tool
            if state.chat_selected_tool_idx.is_some() {
                state.chat_tool_expanded = !state.chat_tool_expanded;
            }
        }
        KeyCode::Esc => {
            // Clear selection
            state.chat_selected_tool_idx = None;
            state.chat_tool_expanded = false;
        }
        _ => {}
    }
}
```

**Step 5: Add chat_tool_expanded to AppState**

```rust
pub chat_tool_expanded: bool,
```

Initialize to `false`.

**Step 6: Update render_chat to pass selection state**

```rust
// In render_chat:
let completed_tools = state.completed_tool_calls();
for (idx, item) in completed_tools.iter().enumerate() {
    let selected = state.chat_selected_tool_idx == Some(idx);
    let expanded = selected && state.chat_tool_expanded;
    lines.extend(render_tool_call_line(item, colors, selected, expanded));
}
```

**Step 7: Visual verification**

Run: `cd packages/tui && cargo run -- --workdir .`

Test:
- Tab to focus on Chat pane
- Press j/k or arrows to select tools
- Press Enter to expand selected tool
- Press Esc to clear selection

**Step 8: Commit**

```bash
git add packages/tui/src/app/mod.rs packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add selectable and expandable tool calls in conversation"
```

---

### Task 3.3: Full-Screen Tool Details Overlay

For very long tool outputs, provide a full-screen overlay (like debug/activity).

**Files:**
- Modify: `packages/tui/src/app/mod.rs` (add tool_details_overlay state)
- Modify: `packages/tui/src/ui/mod.rs` (render overlay, handle keys)

**Step 1: Add overlay state**

In `packages/tui/src/app/mod.rs`:

```rust
pub tool_details_overlay_open: bool,
pub tool_details_overlay_scroll: u16,
```

**Step 2: Add keyboard shortcut to open overlay**

When a tool is selected, press `d` to open full details overlay:

```rust
KeyCode::Char('d') | KeyCode::Char('D') => {
    if state.chat_selected_tool_idx.is_some() {
        state.tool_details_overlay_open = true;
        state.tool_details_overlay_scroll = 0;
    }
}
```

**Step 3: Create render_tool_details_overlay**

```rust
fn render_tool_details_overlay(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(Span::styled(
        "Tool Details                                     [Esc to close]",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(""));

    let tools = state.completed_tool_calls();
    if let Some(idx) = state.chat_selected_tool_idx {
        if let Some(item) = tools.get(idx) {
            // Tool name and status
            lines.push(Line::from(vec![
                Span::styled("Tool: ", Style::default().fg(colors.fg_muted)),
                Span::styled(
                    item.tool_name.clone().unwrap_or_default(),
                    Style::default().fg(colors.accent).add_modifier(Modifier::BOLD),
                ),
            ]));

            lines.push(Line::from(vec![
                Span::styled("Status: ", Style::default().fg(colors.fg_muted)),
                Span::styled(
                    item.status.clone().unwrap_or_default(),
                    Style::default().fg(colors.fg_primary),
                ),
            ]));

            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "─── Input ───",
                Style::default().fg(colors.border_subtle),
            )));

            // Show input
            if let Some(tool_call_id) = &item.tool_call_id {
                if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
                    let pretty = serde_json::to_string_pretty(input)
                        .unwrap_or_else(|_| input.to_string());
                    for line in pretty.lines() {
                        lines.push(Line::from(Span::styled(
                            line.to_string(),
                            Style::default().fg(colors.fg_secondary),
                        )));
                    }
                }
            }

            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "─── Result ───",
                Style::default().fg(colors.border_subtle),
            )));

            // Show result
            if let Some(details) = &item.details {
                let pretty = serde_json::to_string_pretty(details)
                    .unwrap_or_else(|_| details.to_string());
                for line in pretty.lines() {
                    lines.push(Line::from(Span::styled(
                        line.to_string(),
                        Style::default().fg(colors.fg_primary),
                    )));
                }
            }
        }
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .scroll((state.tool_details_overlay_scroll, 0))
}
```

**Step 4: Add to draw() overlay chain**

```rust
if state.tool_details_overlay_open {
    f.render_widget(render_tool_details_overlay(state), main_area);
} else if state.debug_overlay_open {
    // ... rest of chain
}
```

**Step 5: Handle Esc to close overlay**

In key handling:

```rust
if state.tool_details_overlay_open {
    match key.code {
        KeyCode::Esc => {
            state.tool_details_overlay_open = false;
        }
        KeyCode::Up | KeyCode::Char('k') => {
            state.tool_details_overlay_scroll = state.tool_details_overlay_scroll.saturating_sub(1);
        }
        KeyCode::Down | KeyCode::Char('j') => {
            state.tool_details_overlay_scroll += 1;
        }
        KeyCode::PageUp => {
            state.tool_details_overlay_scroll = state.tool_details_overlay_scroll.saturating_sub(20);
        }
        KeyCode::PageDown => {
            state.tool_details_overlay_scroll += 20;
        }
        _ => {}
    }
    continue;
}
```

**Step 6: Commit**

```bash
git add packages/tui/src/app/mod.rs packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add full-screen tool details overlay"
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

**Total Tasks:** 18 tasks across 6 phases

**Key Changes:**

1. **Visual Hierarchy** - Replace "you"/"assistant" labels with colored `┃` border for user messages
2. **Message Grouping** - Consecutive same-role messages grouped without separators
3. **Bottom-Anchored Permissions** - Permission bar appears above input (still modal, less disruptive) with `Y/S/N/D` shortcuts
4. **Tool Result Folding** - Compact `└─` preview, selectable/expandable with j/k/Enter
5. **Tool Details Overlay** - Press `D` on selected tool for full-screen scrollable details
6. **Clean Input** - Remove redundant hint line, compact image indicator
7. **Status Bar** - Move to bottom, remove debug clutter

**Progressive Tool Disclosure:**

1. **Folded** (default): `✓ bash npm test` with one-line preview
2. **Selected**: Highlighted with `▸`, background tint
3. **Expanded**: Press Enter to show 15 lines inline
4. **Full overlay**: Press D for complete scrollable output

**Testing Approach:**

- Unit tests for rendering functions
- Visual verification for layout changes
- Manual testing of keyboard shortcuts
- Clippy for dead code detection
