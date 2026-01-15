# Permission Dialog Rich Diff View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show syntax-highlighted unified diffs in the permission dialog for file_edit tools, expanded by default.

**Architecture:** Tool-specific rendering in the permission bar - detect tool type and render appropriate preview (diff for file_edit, content for file_write, command for bash). Use the `similar` crate for diff generation. Diff colors (red/green) provide immediate value; syntax highlighting can be added later with `syntect`.

**Tech Stack:** Rust, ratatui, similar (diff crate)

---

## Task 1: Add `similar` dependency

**Files:**
- Modify: `packages/tui/Cargo.toml`

**Step 1: Add the dependency**

Edit `packages/tui/Cargo.toml` to add `similar` under `[dependencies]`:

```toml
[dependencies]
base64 = "0.22"
crossterm = "0.28"
ratatui = "0.29"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
similar = "2.6"
tui-textarea = { version = "0.7", default-features = false, features = ["ratatui", "crossterm"] }
strsim = "0.11"
```

**Step 2: Verify it compiles**

Run: `cd packages/tui && cargo check`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add packages/tui/Cargo.toml
git commit -m "chore(tui): add similar crate for diff generation"
```

---

## Task 2: Default permission_details_expanded to true

**Files:**
- Modify: `packages/tui/src/app/mod.rs:237`
- Modify: `packages/tui/src/ui/mod.rs` (tests)

**Step 1: Find and update the test that will fail**

In `packages/tui/src/app/ui.rs`, find the test `permission_toggle_details_works`:

```rust
#[test]
fn permission_toggle_details_works() {
    let mut state = AppState::new();
    assert!(!state.permission_details_expanded);  // This will fail after our change

    // Toggle on
    apply_ui_action(&mut state, UiAction::PermissionToggleDetails);
    assert!(state.permission_details_expanded);

    // Toggle off
    apply_ui_action(&mut state, UiAction::PermissionToggleDetails);
    assert!(!state.permission_details_expanded);
}
```

**Step 2: Update test to expect true by default**

Change the test in `packages/tui/src/app/ui.rs`:

```rust
#[test]
fn permission_toggle_details_works() {
    let mut state = AppState::new();
    assert!(state.permission_details_expanded);  // Now defaults to true

    // Toggle off
    apply_ui_action(&mut state, UiAction::PermissionToggleDetails);
    assert!(!state.permission_details_expanded);

    // Toggle on
    apply_ui_action(&mut state, UiAction::PermissionToggleDetails);
    assert!(state.permission_details_expanded);
}
```

**Step 3: Run test to verify it fails**

Run: `cd packages/tui && cargo test permission_toggle_details_works`
Expected: FAIL - assertion failed: `state.permission_details_expanded` expected true, got false

**Step 4: Change the default in AppState::new()**

In `packages/tui/src/app/mod.rs`, find the `impl AppState` block and change line ~237:

```rust
// Before:
permission_details_expanded: false,

// After:
permission_details_expanded: true,
```

**Step 5: Run test to verify it passes**

Run: `cd packages/tui && cargo test permission_toggle_details_works`
Expected: PASS

**Step 6: Run all tests to check for other failures**

Run: `cd packages/tui && cargo test --lib`
Expected: All tests pass (or note any that need updating)

**Step 7: Commit**

```bash
git add packages/tui/src/app/mod.rs packages/tui/src/app/ui.rs
git commit -m "feat(tui): expand permission details by default"
```

---

## Task 3: Add diff scroll state to AppState

**Files:**
- Modify: `packages/tui/src/app/mod.rs`

**Step 1: Add the field to AppState struct**

In `packages/tui/src/app/mod.rs`, find the `AppState` struct (around line 80-170) and add after `permission_details_expanded`:

```rust
pub permission_details_expanded: bool,
/// Scroll position within the permission details/diff view
pub permission_details_scroll: u16,
```

**Step 2: Initialize in AppState::new()**

In the `AppState::new()` function, add after `permission_details_expanded: true,`:

```rust
permission_details_expanded: true,
permission_details_scroll: 0,
```

**Step 3: Verify it compiles**

Run: `cd packages/tui && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add packages/tui/src/app/mod.rs
git commit -m "feat(tui): add permission_details_scroll state"
```

---

## Task 4: Create diff rendering module

**Files:**
- Create: `packages/tui/src/ui/diff.rs`
- Modify: `packages/tui/src/ui/mod.rs` (add module)

**Step 1: Create the diff module with test**

Create `packages/tui/src/ui/diff.rs`:

```rust
// ABOUTME: Generates unified diff output for file edit operations
// ABOUTME: Used by permission bar to show proposed changes

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use similar::{ChangeTag, TextDiff};

/// Generates styled diff lines from old and new text.
/// Returns Vec<Line> suitable for ratatui rendering.
pub fn generate_diff_lines(
    file_path: &str,
    old_text: &str,
    new_text: &str,
    added_color: Color,
    removed_color: Color,
    context_color: Color,
    header_color: Color,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    // File header
    lines.push(Line::from(vec![
        Span::styled(
            format!("--- a/{}", file_path),
            Style::default().fg(header_color),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::styled(
            format!("+++ b/{}", file_path),
            Style::default().fg(header_color),
        ),
    ]));

    // Generate diff
    let diff = TextDiff::from_lines(old_text, new_text);

    for hunk in diff.unified_diff().iter_hunks() {
        // Hunk header (e.g., @@ -1,3 +1,4 @@)
        lines.push(Line::from(vec![
            Span::styled(
                format!("{}", hunk.header()),
                Style::default().fg(header_color).add_modifier(Modifier::DIM),
            ),
        ]));

        for change in hunk.iter_changes() {
            let (sign, style) = match change.tag() {
                ChangeTag::Delete => ("-", Style::default().fg(removed_color)),
                ChangeTag::Insert => ("+", Style::default().fg(added_color)),
                ChangeTag::Equal => (" ", Style::default().fg(context_color)),
            };

            let line_content = change.value().trim_end_matches('\n');
            lines.push(Line::from(vec![
                Span::styled(sign.to_string(), style),
                Span::styled(line_content.to_string(), style),
            ]));
        }
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_diff_for_simple_change() {
        let old = "line1\nline2\nline3\n";
        let new = "line1\nmodified\nline3\n";

        let lines = generate_diff_lines(
            "test.txt",
            old,
            new,
            Color::Green,
            Color::Red,
            Color::White,
            Color::Cyan,
        );

        // Should have header lines
        assert!(lines.len() >= 2);
        assert!(lines[0].to_string().contains("--- a/test.txt"));
        assert!(lines[1].to_string().contains("+++ b/test.txt"));

        // Should have removed and added lines
        let text: String = lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n");
        assert!(text.contains("-line2"), "Should show removed line");
        assert!(text.contains("+modified"), "Should show added line");
    }

    #[test]
    fn handles_empty_old_text_as_insertion() {
        let old = "";
        let new = "new content\n";

        let lines = generate_diff_lines(
            "new.txt",
            old,
            new,
            Color::Green,
            Color::Red,
            Color::White,
            Color::Cyan,
        );

        let text: String = lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n");
        assert!(text.contains("+new content"), "Should show insertion");
    }

    #[test]
    fn handles_multiline_changes() {
        let old = "function foo() {\n  return 1;\n}\n";
        let new = "function foo() {\n  return 2;\n  // added comment\n}\n";

        let lines = generate_diff_lines(
            "code.js",
            old,
            new,
            Color::Green,
            Color::Red,
            Color::White,
            Color::Cyan,
        );

        let text: String = lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n");
        assert!(text.contains("-  return 1;"), "Should show removed return");
        assert!(text.contains("+  return 2;"), "Should show added return");
        assert!(text.contains("+  // added comment"), "Should show added comment");
    }
}
```

**Step 2: Add module to mod.rs**

In `packages/tui/src/ui/mod.rs`, add near the top with other module declarations:

```rust
pub mod markdown;
pub mod diff;
```

**Step 3: Run tests to verify**

Run: `cd packages/tui && cargo test diff::`
Expected: All 3 tests pass

**Step 4: Commit**

```bash
git add packages/tui/src/ui/diff.rs packages/tui/src/ui/mod.rs
git commit -m "feat(tui): add diff rendering module"
```

---

## Task 5: Create file_edit input parser

**Files:**
- Modify: `packages/tui/src/ui/diff.rs`

**Step 1: Add test for parsing file_edit input**

Add to `packages/tui/src/ui/diff.rs`:

```rust
use serde_json::Value;

/// Parsed file_edit tool input
#[derive(Debug, Clone)]
pub struct FileEditInput {
    pub path: String,
    pub edits: Vec<EditOperation>,
}

#[derive(Debug, Clone)]
pub struct EditOperation {
    pub old_text: String,
    pub new_text: String,
}

/// Parse file_edit tool input JSON into structured form.
/// Returns None if the input doesn't match expected format.
pub fn parse_file_edit_input(input: &Value) -> Option<FileEditInput> {
    let path = input.get("path")?.as_str()?.to_string();
    let edits_array = input.get("edits")?.as_array()?;

    let edits: Vec<EditOperation> = edits_array
        .iter()
        .filter_map(|edit| {
            Some(EditOperation {
                old_text: edit.get("old_text")?.as_str()?.to_string(),
                new_text: edit.get("new_text")?.as_str()?.to_string(),
            })
        })
        .collect();

    if edits.is_empty() {
        return None;
    }

    Some(FileEditInput { path, edits })
}
```

**Step 2: Add tests**

Add to the tests module in `packages/tui/src/ui/diff.rs`:

```rust
use serde_json::json;

#[test]
fn parses_file_edit_input() {
    let input = json!({
        "path": "src/main.rs",
        "edits": [
            {"old_text": "foo", "new_text": "bar"},
            {"old_text": "baz", "new_text": "qux"}
        ]
    });

    let parsed = parse_file_edit_input(&input).unwrap();
    assert_eq!(parsed.path, "src/main.rs");
    assert_eq!(parsed.edits.len(), 2);
    assert_eq!(parsed.edits[0].old_text, "foo");
    assert_eq!(parsed.edits[0].new_text, "bar");
}

#[test]
fn returns_none_for_invalid_input() {
    let input = json!({"command": "echo hi"});
    assert!(parse_file_edit_input(&input).is_none());

    let input = json!({"path": "foo.txt"}); // missing edits
    assert!(parse_file_edit_input(&input).is_none());

    let input = json!({"path": "foo.txt", "edits": []}); // empty edits
    assert!(parse_file_edit_input(&input).is_none());
}
```

**Step 3: Run tests**

Run: `cd packages/tui && cargo test diff::`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/tui/src/ui/diff.rs
git commit -m "feat(tui): add file_edit input parser"
```

---

## Task 6: Create render_file_edit_diff function

**Files:**
- Modify: `packages/tui/src/ui/diff.rs`

**Step 1: Add the rendering function**

Add to `packages/tui/src/ui/diff.rs`:

```rust
use crate::ui::theme::ThemeColors;

/// Renders a file_edit tool input as a unified diff view.
/// Returns styled lines ready for ratatui, or None if input is not a file_edit.
pub fn render_file_edit_diff(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let parsed = parse_file_edit_input(input)?;

    let mut all_lines = Vec::new();

    for (i, edit) in parsed.edits.iter().enumerate() {
        if i > 0 {
            // Separator between multiple edits
            all_lines.push(Line::from(""));
        }

        let diff_lines = generate_diff_lines(
            &parsed.path,
            &edit.old_text,
            &edit.new_text,
            colors.success,      // green for additions
            colors.error,        // red for deletions
            colors.fg_muted,     // muted for context
            colors.fg_secondary, // header color
        );

        all_lines.extend(diff_lines);
    }

    Some(all_lines)
}
```

**Step 2: Add test**

Add to tests module:

```rust
use crate::ui::theme::{ThemeColors, ThemePreference};

#[test]
fn render_file_edit_diff_produces_lines() {
    let colors = ThemeColors::from_preference(ThemePreference::Dark);
    let input = json!({
        "path": "test.rs",
        "edits": [{"old_text": "old", "new_text": "new"}]
    });

    let lines = render_file_edit_diff(&input, &colors).unwrap();
    assert!(!lines.is_empty());

    let text: String = lines.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("\n");
    assert!(text.contains("test.rs"));
    assert!(text.contains("-old"));
    assert!(text.contains("+new"));
}

#[test]
fn render_file_edit_diff_returns_none_for_non_edit() {
    let colors = ThemeColors::from_preference(ThemePreference::Dark);
    let input = json!({"command": "ls"});

    assert!(render_file_edit_diff(&input, &colors).is_none());
}
```

**Step 3: Run tests**

Run: `cd packages/tui && cargo test diff::`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/tui/src/ui/diff.rs
git commit -m "feat(tui): add render_file_edit_diff function"
```

---

## Task 7: Integrate diff view into permission bar

**Files:**
- Modify: `packages/tui/src/ui/mod.rs`

**Step 1: Add test for diff rendering in permission bar**

Find the test `permission_bar_expanded_shows_details` in `packages/tui/src/ui/mod.rs` and add a new test after it:

```rust
#[test]
fn permission_bar_shows_diff_for_file_edit() {
    use crate::app::{PermissionOption, PermissionRequest};

    let mut state = AppState::new();
    state.active_permission = Some(PermissionRequest {
        id: json!("req_1"),
        tool: Some("file_edit".to_string()),
        kind: Some("write".to_string()),
        resource: Some("src/main.rs".to_string()),
        tool_call_id: Some("tool_456".to_string()),
        turn_id: None,
        turn_seq: None,
        job_id: None,
        options: vec![PermissionOption {
            id: "allow".to_string(),
            label: "Allow".to_string(),
        }],
    });

    state.tool_inputs_by_tool_call_id.insert(
        "tool_456".to_string(),
        json!({
            "path": "src/main.rs",
            "edits": [{"old_text": "return 1;", "new_text": "return 2;"}]
        }),
    );

    state.permission_details_expanded = true;

    let widget = render_permission_bar(&state);

    // Render to test backend
    let backend = TestBackend::new(80, 20);
    let mut terminal = Terminal::new(backend).unwrap();
    terminal
        .draw(|f| {
            f.render_widget(widget, Rect::new(0, 0, 80, 20));
        })
        .unwrap();

    let buffer = terminal.backend().buffer().clone();
    let content: String = (0..20)
        .map(|y| {
            (0..80)
                .map(|x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n");

    // Should show diff markers
    assert!(
        content.contains("---") || content.contains("-return 1;"),
        "Should show diff with removed line. Got:\n{}",
        content
    );
}
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tui && cargo test permission_bar_shows_diff_for_file_edit`
Expected: FAIL - diff markers not found (currently shows raw JSON)

**Step 3: Modify render_permission_bar to use diff view**

In `packages/tui/src/ui/mod.rs`, find the `render_permission_bar` function. Locate the section that renders tool input JSON when expanded (around line 2711-2741). Replace it with tool-specific rendering:

```rust
// When expanded, show resource and tool input details
if state.permission_details_expanded {
    // Resource line (full, not truncated)
    lines.push(Line::from(vec![
        Span::styled("  ", Style::default()),
        Span::styled("Resource: ", Style::default().fg(colors.fg_secondary)),
        Span::styled(resource, Style::default().fg(colors.fg_primary)),
    ]));

    // Tool-specific rendering
    if let Some(tool_call_id) = &req.tool_call_id {
        if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
            // Try file_edit diff rendering first
            if tool == "file_edit" {
                if let Some(diff_lines) = diff::render_file_edit_diff(input, colors) {
                    lines.push(Line::from("")); // spacing
                    for diff_line in diff_lines {
                        lines.push(diff_line);
                    }
                } else {
                    // Fallback to JSON if parsing fails
                    render_json_input(&mut lines, input, colors);
                }
            } else {
                // Default: show JSON for other tools
                render_json_input(&mut lines, input, colors);
            }
        }
    }
}
```

**Step 4: Extract JSON rendering helper**

Add a helper function before `render_permission_bar`:

```rust
/// Renders tool input as formatted JSON lines
fn render_json_input(lines: &mut Vec<Line<'static>>, input: &Value, colors: &ThemeColors) {
    let pretty = serde_json::to_string_pretty(input).unwrap_or_default();
    let input_lines: Vec<&str> = pretty.lines().collect();
    let max_lines = 8;
    let show_truncation = input_lines.len() > max_lines;

    for (i, line) in input_lines.iter().take(max_lines).enumerate() {
        let prefix = if i == 0 { "Input: " } else { "       " };
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(prefix, Style::default().fg(colors.fg_secondary)),
            Span::styled(
                (*line).to_string(),
                Style::default().fg(colors.fg_muted),
            ),
        ]));
    }

    if show_truncation {
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                "       ... (truncated)",
                Style::default().fg(colors.fg_muted),
            ),
        ]));
    }
}
```

**Step 5: Run test to verify it passes**

Run: `cd packages/tui && cargo test permission_bar_shows_diff_for_file_edit`
Expected: PASS

**Step 6: Run all permission bar tests**

Run: `cd packages/tui && cargo test permission_bar`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "feat(tui): show diff view for file_edit in permission bar"
```

---

## Task 8: Update permission_bar_height for diff content

**Files:**
- Modify: `packages/tui/src/ui/mod.rs`

**Step 1: Add test for height calculation with diff**

Add test in `packages/tui/src/ui/mod.rs`:

```rust
#[test]
fn permission_bar_height_accounts_for_diff_lines() {
    use crate::app::{PermissionOption, PermissionRequest};

    let mut state = AppState::new();
    state.active_permission = Some(PermissionRequest {
        id: json!("req_1"),
        tool: Some("file_edit".to_string()),
        kind: Some("write".to_string()),
        resource: Some("test.rs".to_string()),
        tool_call_id: Some("tool_789".to_string()),
        turn_id: None,
        turn_seq: None,
        job_id: None,
        options: vec![PermissionOption {
            id: "allow".to_string(),
            label: "Allow".to_string(),
        }],
    });

    state.tool_inputs_by_tool_call_id.insert(
        "tool_789".to_string(),
        json!({
            "path": "test.rs",
            "edits": [{"old_text": "a\nb\nc", "new_text": "x\ny\nz"}]
        }),
    );

    state.permission_details_expanded = true;

    let height = permission_bar_height(&state);
    // Should be > 3 (base) because diff adds multiple lines
    assert!(height > 5, "Height should include diff lines, got {}", height);
}
```

**Step 2: Run test to see current behavior**

Run: `cd packages/tui && cargo test permission_bar_height_accounts_for_diff_lines`
Expected: May pass or fail depending on current implementation

**Step 3: Update permission_bar_height function**

Find `permission_bar_height` function in `packages/tui/src/ui/mod.rs` (around line 2600). Update the expanded height calculation:

```rust
fn permission_bar_height(state: &AppState) -> u16 {
    if state.active_permission.is_none() {
        return 0;
    }

    let base_height = 3; // border + tool line + shortcuts

    if state.permission_details_expanded {
        let detail_lines = state
            .active_permission
            .as_ref()
            .and_then(|req| {
                let tool = req.tool.as_deref().unwrap_or("");
                let tool_call_id = req.tool_call_id.as_ref()?;
                let input = state.tool_inputs_by_tool_call_id.get(tool_call_id)?;

                if tool == "file_edit" {
                    // Calculate diff line count
                    let colors = theme_styles(state.prefs.theme).colors;
                    diff::render_file_edit_diff(input, &colors)
                        .map(|lines| lines.len() + 2) // +2 for resource line and spacing
                } else {
                    // JSON line count
                    let pretty = serde_json::to_string_pretty(input).unwrap_or_default();
                    Some(pretty.lines().count().min(9) + 2)
                }
            })
            .unwrap_or(1) as u16;

        base_height + detail_lines
    } else {
        base_height
    }
}
```

**Step 4: Run test to verify**

Run: `cd packages/tui && cargo test permission_bar_height`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/tui/src/ui/mod.rs
git commit -m "fix(tui): calculate permission bar height correctly for diff view"
```

---

## Task 9: Add scroll support for diff view

**Files:**
- Modify: `packages/tui/src/app/ui.rs`
- Modify: `packages/tui/src/ui/mod.rs`

**Step 1: Add UiAction variants for scroll**

In `packages/tui/src/app/ui.rs`, find the `UiAction` enum and add:

```rust
pub enum UiAction {
    // ... existing variants ...
    PermissionScrollUp,
    PermissionScrollDown,
}
```

**Step 2: Handle scroll actions**

In `apply_ui_action` function in `packages/tui/src/app/ui.rs`, add handlers:

```rust
UiAction::PermissionScrollUp => {
    if state.permission_details_expanded {
        state.permission_details_scroll = state.permission_details_scroll.saturating_sub(1);
    }
    Vec::new()
}
UiAction::PermissionScrollDown => {
    if state.permission_details_expanded {
        state.permission_details_scroll = state.permission_details_scroll.saturating_add(1);
    }
    Vec::new()
}
```

**Step 3: Map keys to scroll actions**

Find the key handling section that processes permission-related keys (where Y/N/S/D are handled). Add scroll key mappings when permission is active and expanded:

```rust
// In the permission key handling section, add:
KeyCode::Up | KeyCode::Char('k') if state.active_permission.is_some() && state.permission_details_expanded => {
    Some(UiAction::PermissionScrollUp)
}
KeyCode::Down | KeyCode::Char('j') if state.active_permission.is_some() && state.permission_details_expanded => {
    Some(UiAction::PermissionScrollDown)
}
```

**Step 4: Apply scroll offset in render_permission_bar**

In `packages/tui/src/ui/mod.rs`, modify the diff rendering section to apply scroll:

```rust
if tool == "file_edit" {
    if let Some(diff_lines) = diff::render_file_edit_diff(input, colors) {
        lines.push(Line::from("")); // spacing
        let scroll = state.permission_details_scroll as usize;
        for diff_line in diff_lines.into_iter().skip(scroll) {
            lines.push(diff_line);
        }
    } else {
        render_json_input(&mut lines, input, colors);
    }
}
```

**Step 5: Reset scroll when permission changes**

In `packages/tui/src/app/reducer.rs`, find where `active_permission` is set and reset scroll:

```rust
// When setting new permission request:
state.permission_details_scroll = 0;
```

**Step 6: Run all tests**

Run: `cd packages/tui && cargo test --lib`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/tui/src/app/ui.rs packages/tui/src/ui/mod.rs packages/tui/src/app/reducer.rs
git commit -m "feat(tui): add scroll support for permission diff view"
```

---

## Task 10: Manual testing and polish

**Step 1: Build and run**

```bash
cd packages/tui && cargo build
```

**Step 2: Test with actual file_edit**

Run the TUI and trigger a file_edit operation. Verify:
- [ ] Permission dialog shows expanded by default
- [ ] Diff view shows with red (removed) and green (added) colors
- [ ] File path header is visible
- [ ] j/k or arrow keys scroll the diff
- [ ] D key toggles between diff and collapsed view
- [ ] Other tools (bash) still show JSON

**Step 3: Fix any visual issues**

Common issues to check:
- Line wrapping for long lines
- Color contrast in both light and dark themes
- Scroll bounds (don't scroll past content)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(tui): complete permission diff view implementation"
```

---

## Summary

This implementation adds:
1. Rich diff view for `file_edit` tool permissions
2. Permissions expanded by default
3. Scroll support for large diffs
4. Fallback to JSON for other tools
5. Proper height calculation for dynamic content

Future enhancements (not in scope):
- `file_write` content preview
- Syntax highlighting with `syntect`
- Side-by-side diff view
- Word-level inline diff highlighting
