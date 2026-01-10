# TUI UX Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Transform lace-tui from utilitarian debug aesthetic to polished,
Claude Code-inspired conversation-first interface.

**Architecture:** Replace border-based layouts with background-based regions.
Introduce semantic color token system. Consolidate panes into single
conversation view with full-screen overlays. Inline tool calls and permissions.

**Tech Stack:** Rust, ratatui 0.29, crossterm 0.28

---

## Phase 1: Semantic Color Token System

### Task 1.1: Create Theme Module

**Files:**

- Create: `src/ui/theme.rs`
- Modify: `src/ui/mod.rs:1-10` (add module declaration)

**Step 1: Write the failing test**

In `src/ui/theme.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_theme_has_expected_base_colors() {
        let theme = ThemeColors::dark();
        // Dark theme should have dark backgrounds
        assert!(matches!(theme.bg_base, Color::Rgb(r, _, _) if r < 50));
    }

    #[test]
    fn light_theme_has_expected_base_colors() {
        let theme = ThemeColors::light();
        // Light theme should have light backgrounds
        assert!(matches!(theme.bg_base, Color::Rgb(r, _, _) if r > 200));
    }

    #[test]
    fn theme_from_preference_returns_correct_variant() {
        use crate::app::prefs::Theme;
        let dark = ThemeColors::from_pref(Theme::Dark);
        let light = ThemeColors::from_pref(Theme::Light);
        assert_ne!(dark.bg_base, light.bg_base);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test theme::tests --no-run`

Expected: Compilation error - module doesn't exist

**Step 3: Write minimal implementation**

Create `src/ui/theme.rs`:

```rust
// ABOUTME: Semantic color token system for theming. Defines color tokens by
// purpose (bg_base, fg_primary, accent, etc.) rather than raw colors.

use crate::app::prefs::Theme as ThemePref;
use ratatui::style::Color;

/// Semantic color tokens for the UI theme.
/// Each token represents a purpose, not a specific color.
#[derive(Debug, Clone, Copy)]
pub struct ThemeColors {
    // Backgrounds
    pub bg_base: Color,       // Main conversation background
    pub bg_elevated: Color,   // User messages, HUD overlay
    pub bg_surface: Color,    // Inputs, selected items
    pub bg_dim: Color,        // Dimmed background behind overlays

    // Foregrounds
    pub fg_primary: Color,    // Main text
    pub fg_secondary: Color,  // Less prominent text
    pub fg_muted: Color,      // Hints, timestamps, dimmed content

    // Semantic colors
    pub accent: Color,        // Focus, links, active state
    pub success: Color,       // Completed, approved
    pub error: Color,         // Failed, denied
    pub warning: Color,       // Caution, pending

    // Special
    pub spinner: Color,       // Thinking indicator
    pub border_subtle: Color, // Rare borders (HUD edge)
}

impl ThemeColors {
    pub fn dark() -> Self {
        Self {
            bg_base: Color::Rgb(26, 26, 46),       // #1a1a2e
            bg_elevated: Color::Rgb(37, 37, 66),  // #252542
            bg_surface: Color::Rgb(45, 45, 74),   // #2d2d4a
            bg_dim: Color::Rgb(15, 15, 25),       // dimmed overlay bg

            fg_primary: Color::Rgb(224, 224, 224),   // #e0e0e0
            fg_secondary: Color::Rgb(180, 180, 190), // slightly dimmer
            fg_muted: Color::Rgb(136, 136, 153),     // #888899

            accent: Color::Rgb(108, 155, 255),    // #6c9bff
            success: Color::Rgb(107, 204, 138),   // #6bcc8a
            error: Color::Rgb(224, 96, 112),      // #e06070
            warning: Color::Rgb(212, 160, 84),    // #d4a054

            spinner: Color::Rgb(108, 155, 255),   // same as accent
            border_subtle: Color::Rgb(60, 60, 90),
        }
    }

    pub fn light() -> Self {
        Self {
            bg_base: Color::Rgb(250, 250, 252),   // near white
            bg_elevated: Color::Rgb(255, 255, 255), // white
            bg_surface: Color::Rgb(240, 240, 245),
            bg_dim: Color::Rgb(200, 200, 210),

            fg_primary: Color::Rgb(30, 30, 40),
            fg_secondary: Color::Rgb(60, 60, 70),
            fg_muted: Color::Rgb(120, 120, 130),

            accent: Color::Rgb(50, 100, 200),
            success: Color::Rgb(40, 160, 80),
            error: Color::Rgb(200, 60, 70),
            warning: Color::Rgb(180, 120, 40),

            spinner: Color::Rgb(50, 100, 200),
            border_subtle: Color::Rgb(200, 200, 210),
        }
    }

    pub fn high_contrast() -> Self {
        Self {
            bg_base: Color::Rgb(0, 0, 0),
            bg_elevated: Color::Rgb(20, 20, 20),
            bg_surface: Color::Rgb(40, 40, 40),
            bg_dim: Color::Rgb(0, 0, 0),

            fg_primary: Color::Rgb(255, 255, 255),
            fg_secondary: Color::Rgb(230, 230, 230),
            fg_muted: Color::Rgb(180, 180, 180),

            accent: Color::Rgb(255, 255, 0),      // bright yellow
            success: Color::Rgb(0, 255, 0),       // bright green
            error: Color::Rgb(255, 0, 0),         // bright red
            warning: Color::Rgb(255, 165, 0),     // orange

            spinner: Color::Rgb(255, 255, 0),
            border_subtle: Color::Rgb(100, 100, 100),
        }
    }

    pub fn from_pref(pref: ThemePref) -> Self {
        match pref {
            ThemePref::Dark => Self::dark(),
            ThemePref::Light => Self::light(),
            ThemePref::HighContrast => Self::high_contrast(),
        }
    }
}
```

**Step 4: Add module to ui/mod.rs**

At top of `src/ui/mod.rs`, add:

```rust
pub mod theme;
```

**Step 5: Run tests to verify they pass**

Run: `cargo test theme::tests -v`

Expected: All 3 tests pass

**Step 6: Commit**

```bash
git add src/ui/theme.rs src/ui/mod.rs
git commit -m "feat(tui): add semantic color token system"
```

---

### Task 1.2: Migrate ThemeStyles to Use ThemeColors

**Files:**

- Modify: `src/ui/mod.rs:991-1044` (ThemeStyles struct and theme_styles fn)

**Step 1: Write the failing test**

Add to bottom of `src/ui/mod.rs` (in the existing `#[cfg(test)]` block):

```rust
#[test]
fn theme_styles_uses_semantic_colors() {
    use crate::app::prefs::Theme;
    let styles = theme_styles(Theme::Dark);
    // Should use RGB colors from theme system, not basic Color enum
    assert!(matches!(styles.user_prefix, Color::Rgb(_, _, _)));
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test theme_styles_uses_semantic_colors -v`

Expected: FAIL - currently uses `Color::Green`, not `Color::Rgb`

**Step 3: Update ThemeStyles to use ThemeColors**

Replace `ThemeStyles` struct and `theme_styles` function:

```rust
#[derive(Debug, Clone, Copy)]
struct ThemeStyles {
    colors: theme::ThemeColors,
}

impl ThemeStyles {
    fn new(theme: Theme) -> Self {
        Self {
            colors: theme::ThemeColors::from_pref(theme),
        }
    }

    // Convenience accessors for backwards compatibility during migration
    fn status_fg(&self) -> Color { self.colors.fg_primary }
    fn status_bg(&self) -> Color { self.colors.bg_surface }
    fn focused_border(&self) -> Color { self.colors.accent }
    fn user_prefix(&self) -> Color { self.colors.accent }
    fn assistant_prefix(&self) -> Color { self.colors.fg_secondary }
    fn activity_selected(&self) -> Color { self.colors.accent }
    fn activity_error(&self) -> Color { self.colors.error }
    fn dim(&self) -> Color { self.colors.fg_muted }
    fn code_fg(&self) -> Color { self.colors.fg_primary }
    fn code_bg(&self) -> Color { self.colors.bg_surface }
}

fn theme_styles(theme: Theme) -> ThemeStyles {
    ThemeStyles::new(theme)
}
```

**Step 4: Update all usages of styles.X to styles.X()**

Find-replace in `src/ui/mod.rs`:

- `styles.status_fg` → `styles.status_fg()`
- `styles.status_bg` → `styles.status_bg()`
- `styles.focused_border` → `styles.focused_border()`
- `styles.user_prefix` → `styles.user_prefix()`
- `styles.assistant_prefix` → `styles.assistant_prefix()`
- `styles.activity_selected` → `styles.activity_selected()`
- `styles.activity_error` → `styles.activity_error()`
- `styles.dim` → `styles.dim()`
- `styles.code_fg` → `styles.code_fg()`
- `styles.code_bg` → `styles.code_bg()`

**Step 5: Run tests to verify they pass**

Run: `cargo test -v`

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/ui/mod.rs
git commit -m "refactor(tui): migrate ThemeStyles to use semantic ThemeColors"
```

---

## Phase 2: Layout Restructure

### Task 2.1: Move Status Bar to Bottom

**Files:**

- Modify: `src/ui/mod.rs:914-946` (draw function layout)

**Step 1: Understand current layout**

Current layout in `draw()`:

```rust
let root = Layout::default()
    .direction(Direction::Vertical)
    .constraints([
        Constraint::Length(1),        // status at TOP
        Constraint::Min(1),           // main area
        Constraint::Length(input_height), // input
    ])
    .split(f.area());
```

**Step 2: Modify layout to put status at bottom**

Change to:

```rust
let root = Layout::default()
    .direction(Direction::Vertical)
    .constraints([
        Constraint::Min(1),               // main area (now first)
        Constraint::Length(input_height), // input
        Constraint::Length(1),            // status at BOTTOM
    ])
    .split(f.area());

let main_area = root[0];
let input_area = root[1];
let status_area = root[2];
```

And update render calls:

```rust
f.render_widget(render_status(state), status_area);
```

**Step 3: Run the TUI to verify visually**

Run: `cargo run -- --workdir .`

Expected: Status bar appears at bottom

**Step 4: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): move status bar to bottom of screen"
```

---

### Task 2.2: Redesign Status Bar Content

**Files:**

- Modify: `src/ui/mod.rs:1046-1077` (render_status function)
- Modify: `src/app/mod.rs` (add token tracking if needed)

**Step 1: Write the failing test**

```rust
#[test]
fn status_bar_shows_model_and_provider() {
    let mut state = AppState::new();
    state.model_id = Some("claude-3-sonnet".to_string());
    state.connection_id = Some("anthropic-prod".to_string());
    state.workdir = "/home/user/project".to_string();

    let para = render_status(&state);
    let text = para.to_string(); // May need to extract text differently

    // Should show model, connection (as provider), and workdir
    // Should NOT show "sess=", "conn=", "last=" prefixes
    assert!(!text.contains("sess="));
    assert!(!text.contains("conn="));
}
```

**Step 2: Implement new status bar design**

Replace `render_status`:

```rust
fn render_status(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let model = state.model_id.clone().unwrap_or_else(|| "no model".to_string());
    let provider = state.connection_id.clone()
        .and_then(|c| c.split('-').next().map(|s| s.to_string()))
        .unwrap_or_else(|| "—".to_string());

    // TODO: Add token tracking to AppState
    let tokens = "—";

    let workdir = state.workdir.clone();
    let short_workdir = if workdir.len() > 30 {
        format!("…{}", &workdir[workdir.len()-28..])
    } else {
        workdir
    };

    let sep = Span::styled(" · ", Style::default().fg(colors.fg_muted));

    let text = Line::from(vec![
        Span::styled(format!(" {model}"), Style::default().fg(colors.fg_primary)),
        sep.clone(),
        Span::styled(provider, Style::default().fg(colors.fg_muted)),
        sep.clone(),
        Span::styled(format!("{tokens} tokens"), Style::default().fg(colors.fg_muted)),
        sep.clone(),
        Span::styled(short_workdir, Style::default().fg(colors.fg_muted)),
        Span::raw(" "),
    ]);

    Paragraph::new(text)
        .style(Style::default().bg(colors.bg_surface))
}
```

**Step 3: Run tests and visual check**

Run: `cargo test && cargo run -- --workdir .`

**Step 4: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): redesign status bar with clean layout"
```

---

### Task 2.3: Remove Split Panes - Conversation Only

**Files:**

- Modify: `src/ui/mod.rs:932-943` (remove debug pane split)
- Modify: `src/ui/mod.rs:1467-1491` (render_main to just render chat)
- Modify: `src/app/prefs.rs:33-35` (remove show_chat, show_activity)

**Step 1: Simplify render_main to only show conversation**

Replace `render_main`:

```rust
fn render_main(f: &mut ratatui::Frame, state: &AppState, area: ratatui::layout::Rect) {
    f.render_widget(render_conversation(state), area);
}
```

**Step 2: Rename render_chat to render_conversation**

Find-replace: `render_chat` → `render_conversation`

**Step 3: Update draw() to remove debug pane logic**

Simplify the body section in `draw()`:

```rust
render_main(f, state, main_area);
```

Remove the `if state.prefs.show_debug` branching.

**Step 4: Update Preferences struct**

In `src/app/prefs.rs`, mark deprecated or remove:

```rust
// Keep for backwards compat when loading old prefs, but ignore in rendering
pub show_chat: bool,      // deprecated, always true
pub show_activity: bool,  // deprecated, activity is overlay now
pub show_debug: bool,     // deprecated, debug is overlay now
```

**Step 5: Run tests**

Run: `cargo test -v`

**Step 6: Commit**

```bash
git add src/ui/mod.rs src/app/prefs.rs
git commit -m "refactor(tui): remove split panes, conversation is primary view"
```

---

## Phase 3: Conversation Rendering

### Task 3.1: Message Blocks with Background Colors

**Files:**

- Modify: `src/ui/mod.rs:1493-1540` (render_conversation function)

**Step 1: Redesign render_conversation with background blocks**

Replace `render_conversation` (formerly `render_chat`):

```rust
fn render_conversation(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    for m in &state.messages {
        let (bg, prefix_style) = match m.role {
            Role::User => (
                colors.bg_elevated,
                Style::default().fg(colors.accent).bold(),
            ),
            Role::Assistant => (
                colors.bg_base,
                Style::default().fg(colors.fg_secondary),
            ),
        };

        // Add spacing before message
        if !lines.is_empty() {
            lines.push(Line::from(""));
        }

        // Role indicator (subtle)
        let role_text = match m.role {
            Role::User => "you",
            Role::Assistant => "assistant",
        };
        lines.push(Line::from(Span::styled(role_text, prefix_style)));

        // Message content
        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        if state.prefs.render_markdown {
            for l in markdown::render_markdownish_lines(&text) {
                let style = if l.is_code {
                    Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                } else {
                    Style::default().fg(colors.fg_primary)
                };
                lines.push(Line::from(Span::styled(l.text, style)));
            }
        } else {
            for l in text.lines() {
                lines.push(Line::from(Span::styled(
                    l.to_string(),
                    Style::default().fg(colors.fg_primary),
                )));
            }
        }
    }

    // Show thinking indicator if awaiting response
    if state.is_thinking() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!("{} Thinking...", spinning_char()),
            Style::default().fg(colors.spinner),
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.chat_scroll, 0))
}
```

**Step 2: Add is_thinking() helper to AppState**

In `src/app/mod.rs`, add:

```rust
impl AppState {
    pub fn is_thinking(&self) -> bool {
        // Thinking if we have active prompt requests and last message is user
        !self.active_prompt_request_ids.is_empty()
            && self.messages.last().map(|m| m.role == Role::User).unwrap_or(false)
    }
}
```

**Step 3: Add spinning_char() helper**

In `src/ui/mod.rs`:

```rust
fn spinning_char() -> char {
    // Cycle through braille spinner based on time
    const SPINNER: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let idx = ((ms / 100) % SPINNER.len() as u128) as usize;
    SPINNER[idx]
}
```

**Step 4: Run and verify visually**

Run: `cargo run -- --workdir .`

**Step 5: Commit**

```bash
git add src/ui/mod.rs src/app/mod.rs
git commit -m "feat(tui): message blocks with background colors and thinking indicator"
```

---

### Task 3.2: Inline Tool Calls in Conversation

**Files:**

- Modify: `src/app/mod.rs` (add tool calls to message stream)
- Modify: `src/ui/mod.rs` (render inline tool calls)

**Step 1: Add ToolCallDisplay struct**

In `src/app/mod.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationItem {
    Message(ChatMessage),
    ToolCall(ToolCallDisplay),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCallDisplay {
    pub tool_call_id: String,
    pub name: String,
    pub input_summary: String,  // Truncated display
    pub status: ToolCallStatus,
    pub result_summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCallStatus {
    Pending,
    Running,
    Success,
    Error,
}
```

**Step 2: Build conversation items from messages + activity**

Add helper to build unified view:

```rust
impl AppState {
    pub fn conversation_items(&self) -> Vec<ConversationItem> {
        // For now, just wrap messages. Tool calls will be interleaved later.
        self.messages.iter()
            .map(|m| ConversationItem::Message(m.clone()))
            .collect()
    }
}
```

**Step 3: Update render_conversation to handle ConversationItem**

Extend to render tool calls inline:

```rust
fn render_tool_call(tc: &ToolCallDisplay, colors: &theme::ThemeColors) -> Vec<Line<'static>> {
    let status_char = match tc.status {
        ToolCallStatus::Pending => '⋯',
        ToolCallStatus::Running => '▶',
        ToolCallStatus::Success => '✓',
        ToolCallStatus::Error => '✗',
    };
    let status_color = match tc.status {
        ToolCallStatus::Pending => colors.fg_muted,
        ToolCallStatus::Running => colors.accent,
        ToolCallStatus::Success => colors.success,
        ToolCallStatus::Error => colors.error,
    };

    let mut lines = Vec::new();
    lines.push(Line::from(vec![
        Span::styled(
            format!("{} ", status_char),
            Style::default().fg(status_color),
        ),
        Span::styled(
            tc.name.clone(),
            Style::default().fg(colors.fg_primary),
        ),
        Span::styled(
            format!(" {}", tc.input_summary),
            Style::default().fg(colors.fg_muted),
        ),
    ]));

    if let Some(result) = &tc.result_summary {
        lines.push(Line::from(Span::styled(
            format!("  {result}"),
            Style::default().fg(colors.fg_muted),
        )));
    }

    lines
}
```

**Step 4: Commit**

```bash
git add src/app/mod.rs src/ui/mod.rs
git commit -m "feat(tui): inline tool call display in conversation"
```

---

## Phase 4: Borderless Input

### Task 4.1: Remove Input Border, Add Prompt Character

**Files:**

- Modify: `src/ui/mod.rs:1605-1639` (render_input function)

**Step 1: Redesign render_input**

```rust
fn render_input(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let prompt = "> ";
    let mut lines: Vec<Line> = Vec::new();

    let input_lines: Vec<&str> = state.input_buffer.lines().collect();
    let input_lines = if input_lines.is_empty() {
        vec![""]
    } else {
        input_lines
    };

    for (i, line) in input_lines.iter().enumerate() {
        let prefix = if i == 0 { prompt } else { "  " };
        lines.push(Line::from(vec![
            Span::styled(prefix, Style::default().fg(colors.accent)),
            Span::styled(line.to_string(), Style::default().fg(colors.fg_primary)),
            if i == input_lines.len() - 1 {
                Span::styled("▌", Style::default().fg(colors.accent))
            } else {
                Span::raw("")
            },
        ]));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
}
```

**Step 2: Update layout to use dynamic input height**

In `draw()`, calculate input height based on content:

```rust
let input_line_count = state.input_buffer.lines().count().max(1);
let input_height = (input_line_count as u16 + 1).min(f.area().height / 3);
```

**Step 3: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): borderless growing input with prompt character"
```

---

## Phase 5: Inline Permission UI

### Task 5.1: Replace Permission Modal with Inline UI

**Files:**

- Modify: `src/ui/mod.rs:1640-1710` (render_permission_modal →
  render_permission_inline)
- Modify: `src/ui/mod.rs:948-951` (draw function overlay logic)

**Step 1: Create inline permission renderer**

```rust
fn render_permission_inline(state: &AppState, colors: &theme::ThemeColors) -> Vec<Line<'static>> {
    let Some(perm) = &state.active_permission else {
        return Vec::new();
    };

    let mut lines = Vec::new();

    // Tool info
    let tool = perm.tool.clone().unwrap_or_else(|| "unknown".to_string());
    lines.push(Line::from(vec![
        Span::styled("▶ ", Style::default().fg(colors.accent)),
        Span::styled(tool, Style::default().fg(colors.fg_primary).bold()),
    ]));

    // Resource/input summary
    if let Some(resource) = &perm.resource {
        lines.push(Line::from(Span::styled(
            format!("  {resource}"),
            Style::default().fg(colors.fg_secondary),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "  Allow this action?",
        Style::default().fg(colors.fg_primary),
    )));
    lines.push(Line::from(""));

    // Options
    for (i, opt) in perm.options.iter().enumerate() {
        let selected = i == state.active_permission_selected;
        let marker = if selected { "▸ " } else { "  " };
        let style = if selected {
            Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
        } else {
            Style::default().fg(colors.fg_secondary)
        };
        lines.push(Line::from(Span::styled(
            format!("  {marker}{}", opt.label),
            style,
        )));
    }

    // Guidance input line
    lines.push(Line::from(Span::styled(
        "  ──────────────────────",
        Style::default().fg(colors.border_subtle),
    )));
    lines.push(Line::from(Span::styled(
        "  _ (type guidance)",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(Span::styled(
        "  ──────────────────────",
        Style::default().fg(colors.border_subtle),
    )));
    lines.push(Line::from(Span::styled(
        "  Show full details",
        Style::default().fg(colors.fg_muted),
    )));

    lines
}
```

**Step 2: Integrate into conversation view**

Modify render_conversation to append permission UI when active.

**Step 3: Remove modal rendering from draw()**

In `draw()`, remove the `if state.active_permission.is_some()` modal overlay.

**Step 4: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): inline permission UI in conversation flow"
```

---

## Phase 6: HUD Redesign

### Task 6.1: Background-Based Palette

**Files:**

- Modify: `src/ui/mod.rs:1711-1740` (render_palette_modal)

**Step 1: Redesign palette with background, no heavy border**

```rust
fn render_palette(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Search input
    lines.push(Line::from(vec![
        Span::styled("> ", Style::default().fg(colors.accent)),
        Span::styled(
            state.palette_query.clone(),
            Style::default().fg(colors.fg_primary),
        ),
        Span::styled("▌", Style::default().fg(colors.accent)),
    ]));
    lines.push(Line::from(""));

    // Filtered items
    let labels = palette_labels();
    let filtered: Vec<_> = labels
        .iter()
        .filter(|l| l.to_lowercase().contains(&state.palette_query.to_lowercase()))
        .collect();

    for (i, label) in filtered.iter().take(10).enumerate() {
        let selected = i == state.palette_selected;
        let style = if selected {
            Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
        } else {
            Style::default().fg(colors.fg_secondary)
        };
        let marker = if selected { "▸ " } else { "  " };
        lines.push(Line::from(Span::styled(
            format!("{marker}{label}"),
            style,
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(ratatui::widgets::BorderType::Rounded),
        )
}
```

**Step 2: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): redesign palette with background-based styling"
```

---

### Task 6.2: Full-Screen Debug Overlay

**Files:**

- Modify: `src/ui/mod.rs` (add full-screen debug view)
- Modify: `src/app/mod.rs` (add debug_overlay_open state)

**Step 1: Add state for full-screen overlays**

In `src/app/mod.rs`, add to AppState:

```rust
pub debug_overlay_open: bool,
pub activity_overlay_open: bool,
```

**Step 2: Create render_debug_overlay function**

```rust
fn render_debug_overlay(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(Span::styled(
        "Debug Log                                        [Esc to close]",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(""));

    for line in state.debug_lines.iter().rev().take(100) {
        lines.push(Line::from(Span::styled(
            line.clone(),
            Style::default().fg(colors.fg_secondary),
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .scroll((state.debug_scroll, 0))
}
```

**Step 3: Update draw() to render full-screen overlay**

```rust
if state.debug_overlay_open {
    f.render_widget(render_debug_overlay(state), main_area);
} else if state.activity_overlay_open {
    f.render_widget(render_activity_overlay(state), main_area);
} else {
    render_main(f, state, main_area);
}
```

**Step 4: Add keyboard handling for Ctrl+D toggle**

In the key event handler, add:

```rust
KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
    state.debug_overlay_open = !state.debug_overlay_open;
    state.activity_overlay_open = false;
}
```

**Step 5: Commit**

```bash
git add src/ui/mod.rs src/app/mod.rs
git commit -m "feat(tui): full-screen debug overlay with Ctrl+D toggle"
```

---

### Task 6.3: Full-Screen Activity Overlay

**Files:**

- Modify: `src/ui/mod.rs` (add activity overlay render)

**Step 1: Create render_activity_overlay**

Similar pattern to debug overlay, but showing activity timeline:

```rust
fn render_activity_overlay(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(Span::styled(
        "Activity                                         [Esc to close]",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(""));

    for item in state.activity.iter() {
        let status_char = match item.kind.as_str() {
            "tool_use" => match item.status.as_deref() {
                Some("complete") => '✓',
                Some("error") => '✗',
                _ => '▶',
            },
            "turn_end" => '◆',
            "job" => '●',
            _ => '·',
        };

        let status_color = match item.status.as_deref() {
            Some("complete") | Some("success") => colors.success,
            Some("error") => colors.error,
            _ => colors.fg_muted,
        };

        lines.push(Line::from(vec![
            Span::styled(format!("{} ", status_char), Style::default().fg(status_color)),
            Span::styled(&item.kind, Style::default().fg(colors.fg_primary)),
            Span::styled(
                format!("  {}", item.label),
                Style::default().fg(colors.fg_muted),
            ),
        ]));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .scroll((state.activity_scroll, 0))
}
```

**Step 2: Add Ctrl+A keyboard handling**

**Step 3: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): full-screen activity overlay with Ctrl+A toggle"
```

---

### Task 6.4: Redesign Sessions View

**Files:**

- Modify: `src/ui/mod.rs:1079-1135` (render_sessions_modal)

**Step 1: Apply same background-based styling**

Use `colors.bg_elevated`, remove heavy borders, use background highlight for
selection instead of `>` marker.

**Step 2: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): redesign sessions view with clean styling"
```

---

### Task 6.5: Redesign Settings/Config Views

**Files:**

- Modify: `src/ui/mod.rs:1166-1280` (render_config_modal)
- Modify: `src/ui/mod.rs:1282-1312` (render_env_modal)
- Modify: `src/ui/mod.rs:1314-1346` (render_models_modal)
- Modify: `src/ui/mod.rs:1348-1428` (render_connections_modal)

Apply same styling patterns to all configuration modals.

**Step 1: Update each modal with consistent styling**

**Step 2: Commit**

```bash
git add src/ui/mod.rs
git commit -m "feat(tui): redesign all config modals with consistent styling"
```

---

## Phase 7: Polish

### Task 7.1: Add Token Tracking to Status Bar

**Files:**

- Modify: `src/app/mod.rs` (add token_count field)
- Modify: `src/app/reducer.rs` (update token count from events)
- Modify: `src/ui/mod.rs` (display in status bar)

**Step 1: Add token tracking state**

**Step 2: Parse token usage from session/update events**

**Step 3: Display in status bar**

**Step 4: Commit**

```bash
git add src/app/mod.rs src/app/reducer.rs src/ui/mod.rs
git commit -m "feat(tui): track and display token usage in status bar"
```

---

### Task 7.2: Add Permission Guidance Input

**Files:**

- Modify: `src/app/mod.rs` (add permission_guidance_input field)
- Modify: `src/ui/mod.rs` (handle guidance input in permission UI)
- Modify: key handling for permission mode

**Step 1: Add guidance input state**

**Step 2: Handle typing in guidance field**

**Step 3: Submit guidance with permission response**

**Step 4: Commit**

```bash
git add src/app/mod.rs src/ui/mod.rs
git commit -m "feat(tui): add guidance input to permission UI"
```

---

### Task 7.3: Clean Up Deprecated Code

**Files:**

- Remove: old ThemeStyles (if any remnants)
- Remove: unused pane toggle logic
- Remove: Ctrl+1/2/3 pane toggle keybindings
- Update: help text

**Step 1: Remove deprecated code paths**

**Step 2: Update help overlay with new keybindings**

**Step 3: Commit**

```bash
git add -A
git commit -m "chore(tui): remove deprecated pane toggle code"
```

---

### Task 7.4: Final Visual Testing

**Steps:**

1. Run TUI: `cargo run -- --workdir .`
2. Verify dark theme looks correct
3. Switch to light theme via palette
4. Verify light theme looks correct
5. Test all overlays (debug, activity, sessions, settings)
6. Test permission flow
7. Test streaming response
8. Test tool calls appear inline

---

## Summary

**Total tasks:** ~20 bite-sized tasks across 7 phases

**Key changes:**

1. Semantic color token system (`src/ui/theme.rs`)
2. Status bar moved to bottom with clean content
3. Single conversation view (no split panes)
4. Inline tool calls and permissions
5. Borderless growing input
6. Background-based HUD overlays
7. Full-screen debug/activity views

**Testing approach:**

- Unit tests for theme color system
- Visual testing for layout changes
- E2E tests continue to work (state machine unchanged)
