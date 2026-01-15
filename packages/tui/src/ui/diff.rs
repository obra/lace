// ABOUTME: Generates unified diff output for file edit operations
// ABOUTME: Used by permission bar to show proposed changes

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;
use similar::TextDiff;

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

/// Generates styled unified diff lines from old and new text.
///
/// This is intentionally minimal: it emits file headers, then a unified diff body
/// with line-level insert/delete/equal styling.
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
    lines.push(Line::from(vec![Span::styled(
        format!("--- a/{file_path}"),
        Style::default().fg(header_color),
    )]));
    lines.push(Line::from(vec![Span::styled(
        format!("+++ b/{file_path}"),
        Style::default().fg(header_color),
    )]));

    let diff = TextDiff::from_lines(old_text, new_text);

    // similar's unified diff display is already in unified format; we colorize
    // by inspecting each change line in the unified string.
    let unified = diff
        .unified_diff()
        .header("a", "b")
        .to_string();

    for raw_line in unified.lines() {
        // We already render our own file headers above.
        if raw_line.starts_with("--- ") || raw_line.starts_with("+++ ") {
            continue;
        }

        let (style, content) = if raw_line.starts_with("@@") {
            (
                Style::default().fg(header_color).add_modifier(Modifier::DIM),
                raw_line.to_string(),
            )
        } else if raw_line.starts_with('+') {
            (Style::default().fg(added_color), raw_line.to_string())
        } else if raw_line.starts_with('-') {
            (Style::default().fg(removed_color), raw_line.to_string())
        } else if raw_line.starts_with(' ') {
            (Style::default().fg(context_color), raw_line.to_string())
        } else {
            // Defensive fallback (should rarely happen)
            (Style::default().fg(context_color), raw_line.to_string())
        };

        lines.push(Line::from(vec![Span::styled(content, style)]));
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let text = lines
            .iter()
            .map(|l| l.to_string())
            .collect::<Vec<_>>()
            .join("\n");

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

        let text = lines
            .iter()
            .map(|l| l.to_string())
            .collect::<Vec<_>>()
            .join("\n");

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

        let text = lines
            .iter()
            .map(|l| l.to_string())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("-  return 1;"), "Should show removed return");
        assert!(text.contains("+  return 2;"), "Should show added return");
        assert!(
            text.contains("+  // added comment"),
            "Should show added comment"
        );
    }
}
