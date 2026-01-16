// ABOUTME: Tool-specific permission display renderers for the TUI
// ABOUTME: Converts tool inputs to human-readable format instead of raw JSON

use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;

use crate::ui::theme::ThemeColors;

/// Render tool input in a human-friendly format.
/// Returns None if no special rendering is available (falls back to JSON).
pub fn render_tool_input(
    tool: &str,
    input: &Value,
    colors: &ThemeColors,
) -> Option<Vec<Line<'static>>> {
    match tool {
        "bash" => render_bash_input(input, colors),
        "file_read" => render_file_read_input(input, colors),
        "file_write" => render_file_write_input(input, colors),
        "ripgrep_search" => render_ripgrep_input(input, colors),
        "file_find" => render_file_find_input(input, colors),
        "url_fetch" => render_url_fetch_input(input, colors),
        "delegate" => render_delegate_input(input, colors),
        _ => None,
    }
}

/// Render bash tool input.
/// The command is already shown in the header, so we only show extra params.
/// Returns Some (possibly empty) to suppress JSON fallback.
fn render_bash_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    // Command is already in the header, but show full command if it was truncated (>40 chars)
    if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
        if cmd.len() > 40 {
            // Show full command since header truncates at 40
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled("$ ", Style::default().fg(colors.accent)),
                Span::styled(cmd.to_string(), Style::default().fg(colors.fg_primary)),
            ]));
        }
    }

    // Show background flag if true
    if let Some(true) = obj.get("background").and_then(|v| v.as_bool()) {
        let desc = obj
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("background job");
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                format!("background: {}", desc),
                Style::default().fg(colors.warning),
            ),
        ]));
    }

    // Always return Some to suppress JSON fallback - empty vec means nothing extra to show
    Some(lines)
}

/// Render file_read tool input.
/// Path is in header. Only show line range if specified.
fn render_file_read_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    // Show line range if specified
    let start = obj.get("startLine").and_then(|v| v.as_i64());
    let end = obj.get("endLine").and_then(|v| v.as_i64());

    if start.is_some() || end.is_some() {
        let range_str = match (start, end) {
            (Some(s), Some(e)) => format!("lines {}-{}", s, e),
            (Some(s), None) => format!("from line {}", s),
            (None, Some(e)) => format!("up to line {}", e),
            (None, None) => unreachable!(),
        };

        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(range_str, Style::default().fg(colors.fg_secondary)),
        ]));
    }

    // Always return Some to suppress JSON fallback
    Some(lines)
}

/// Render file_write tool input.
/// Shows content size/line count preview.
fn render_file_write_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    if let Some(content) = obj.get("content").and_then(|v| v.as_str()) {
        let line_count = content.lines().count();
        let byte_size = content.len();

        // Format size nicely
        let size_str = if byte_size < 1024 {
            format!("{} bytes", byte_size)
        } else if byte_size < 1024 * 1024 {
            format!("{:.1} KB", byte_size as f64 / 1024.0)
        } else {
            format!("{:.1} MB", byte_size as f64 / (1024.0 * 1024.0))
        };

        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                format!("{} lines, {}", line_count, size_str),
                Style::default().fg(colors.fg_secondary),
            ),
        ]));

        // Show first few lines as preview (max 3 lines, max 60 chars each)
        let preview_lines: Vec<&str> = content.lines().take(3).collect();
        for (i, line) in preview_lines.iter().enumerate() {
            let display_line = if line.len() > 60 {
                format!("{}...", &line[..57])
            } else {
                line.to_string()
            };
            let prefix = if i == 0 { "     " } else { "     " };
            lines.push(Line::from(vec![
                Span::styled(prefix, Style::default()),
                Span::styled(display_line, Style::default().fg(colors.fg_muted)),
            ]));
        }

        if content.lines().count() > 3 {
            lines.push(Line::from(vec![
                Span::styled("     ", Style::default()),
                Span::styled(
                    format!("... ({} more lines)", content.lines().count() - 3),
                    Style::default().fg(colors.fg_muted).add_modifier(Modifier::DIM),
                ),
            ]));
        }
    }

    // Always return Some to suppress JSON fallback
    Some(lines)
}

/// Render ripgrep_search tool input.
/// Shows search pattern and options in a readable format.
fn render_ripgrep_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    let pattern = obj.get("pattern").and_then(|v| v.as_str())?;
    let path = obj
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or(".");

    // Build options string
    let mut opts = Vec::new();
    if obj.get("caseSensitive").and_then(|v| v.as_bool()) == Some(true) {
        opts.push("case-sensitive");
    }
    if obj.get("wholeWord").and_then(|v| v.as_bool()) == Some(true) {
        opts.push("whole-word");
    }
    if obj.get("literal").and_then(|v| v.as_bool()) == Some(false) {
        opts.push("regex");
    }

    // Main search line
    lines.push(Line::from(vec![
        Span::styled("  ", Style::default()),
        Span::styled("pattern: ", Style::default().fg(colors.fg_muted)),
        Span::styled(
            pattern.to_string(),
            Style::default().fg(colors.accent).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  path: {}", path),
            Style::default().fg(colors.fg_secondary),
        ),
    ]));

    // Options line if any
    if !opts.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("     ", Style::default()),
            Span::styled(
                opts.join(", "),
                Style::default().fg(colors.fg_muted),
            ),
        ]));
    }

    // Include/exclude patterns
    if let Some(include) = obj.get("includePattern").and_then(|v| v.as_str()) {
        lines.push(Line::from(vec![
            Span::styled("     ", Style::default()),
            Span::styled("include: ", Style::default().fg(colors.fg_muted)),
            Span::styled(include.to_string(), Style::default().fg(colors.fg_secondary)),
        ]));
    }
    if let Some(exclude) = obj.get("excludePattern").and_then(|v| v.as_str()) {
        lines.push(Line::from(vec![
            Span::styled("     ", Style::default()),
            Span::styled("exclude: ", Style::default().fg(colors.fg_muted)),
            Span::styled(exclude.to_string(), Style::default().fg(colors.fg_secondary)),
        ]));
    }

    Some(lines)
}

/// Render file_find tool input.
/// Shows search pattern and path.
fn render_file_find_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    let pattern = obj.get("pattern").and_then(|v| v.as_str())?;
    let path = obj
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or(".");

    lines.push(Line::from(vec![
        Span::styled("  ", Style::default()),
        Span::styled("pattern: ", Style::default().fg(colors.fg_muted)),
        Span::styled(
            pattern.to_string(),
            Style::default().fg(colors.accent).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  path: {}", path),
            Style::default().fg(colors.fg_secondary),
        ),
    ]));

    // Show type filter if present
    if let Some(file_type) = obj.get("type").and_then(|v| v.as_str()) {
        lines.push(Line::from(vec![
            Span::styled("     ", Style::default()),
            Span::styled(
                format!("type: {}", file_type),
                Style::default().fg(colors.fg_muted),
            ),
        ]));
    }

    Some(lines)
}

/// Render url_fetch tool input.
/// Shows URL, method, and body presence.
fn render_url_fetch_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    let url = obj.get("url").and_then(|v| v.as_str())?;
    let method = obj
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET");

    // Method and URL
    let method_color = match method {
        "GET" => colors.success,
        "POST" => colors.warning,
        _ => colors.fg_secondary,
    };

    lines.push(Line::from(vec![
        Span::styled("  ", Style::default()),
        Span::styled(
            method.to_string(),
            Style::default().fg(method_color).add_modifier(Modifier::BOLD),
        ),
        Span::styled(" ", Style::default()),
        Span::styled(url.to_string(), Style::default().fg(colors.fg_primary)),
    ]));

    // Show body info if present
    if let Some(body) = obj.get("body").and_then(|v| v.as_str()) {
        let body_preview = if body.len() > 50 {
            format!("{}...", &body[..47])
        } else {
            body.to_string()
        };
        lines.push(Line::from(vec![
            Span::styled("     ", Style::default()),
            Span::styled("body: ", Style::default().fg(colors.fg_muted)),
            Span::styled(body_preview, Style::default().fg(colors.fg_secondary)),
        ]));
    }

    // Show headers count if present
    if let Some(headers) = obj.get("headers").and_then(|v| v.as_object()) {
        if !headers.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("     ", Style::default()),
                Span::styled(
                    format!("{} custom header(s)", headers.len()),
                    Style::default().fg(colors.fg_muted),
                ),
            ]));
        }
    }

    Some(lines)
}

/// Render delegate tool input.
/// Shows the delegation prompt text.
fn render_delegate_input(input: &Value, colors: &ThemeColors) -> Option<Vec<Line<'static>>> {
    let obj = input.as_object()?;
    let mut lines = Vec::new();

    // Show resume info if resuming a previous job
    if let Some(resume_id) = obj.get("resume").and_then(|v| v.as_str()) {
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled("resuming: ", Style::default().fg(colors.fg_muted)),
            Span::styled(resume_id.to_string(), Style::default().fg(colors.accent)),
        ]));
    }

    // Show the prompt (the main delegation text)
    if let Some(prompt) = obj.get("prompt").and_then(|v| v.as_str()) {
        // Show prompt with word wrapping at ~70 chars per line
        let prompt_lines: Vec<&str> = prompt.lines().collect();
        let max_display_lines = 8;
        let mut displayed = 0;

        for line in &prompt_lines {
            if displayed >= max_display_lines {
                break;
            }

            // Wrap long lines
            if line.len() > 70 {
                let mut remaining = *line;
                while !remaining.is_empty() && displayed < max_display_lines {
                    let (chunk, rest) = if remaining.len() > 70 {
                        // Try to break at a space
                        let break_at = remaining[..70]
                            .rfind(' ')
                            .unwrap_or(70);
                        (&remaining[..break_at], remaining[break_at..].trim_start())
                    } else {
                        (remaining, "")
                    };

                    lines.push(Line::from(vec![
                        Span::styled("  ", Style::default()),
                        Span::styled(chunk.to_string(), Style::default().fg(colors.fg_primary)),
                    ]));
                    displayed += 1;
                    remaining = rest;
                }
            } else {
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(line.to_string(), Style::default().fg(colors.fg_primary)),
                ]));
                displayed += 1;
            }
        }

        // Show truncation indicator if needed
        let total_lines: usize = prompt_lines.iter().map(|l| (l.len() / 70) + 1).sum();
        if total_lines > max_display_lines {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(
                    format!("... ({} more lines)", total_lines - max_display_lines),
                    Style::default().fg(colors.fg_muted).add_modifier(Modifier::DIM),
                ),
            ]));
        }
    }

    // Show background flag if true
    if let Some(true) = obj.get("background").and_then(|v| v.as_bool()) {
        let desc = obj
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("background job");
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                format!("background: {}", desc),
                Style::default().fg(colors.warning),
            ),
        ]));
    }

    // Always return Some to suppress JSON fallback
    Some(lines)
}

/// Calculate the height needed for tool-specific rendering.
/// Returns None if no special rendering is available.
pub fn tool_input_height(tool: &str, input: &Value) -> Option<usize> {
    // We need to actually render to know the height
    // Use a dummy colors struct just for height calculation
    let colors = ThemeColors::dark();
    render_tool_input(tool, input, &colors).map(|lines| lines.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bash_simple_command_returns_empty() {
        let colors = ThemeColors::dark();
        let input = json!({"command": "ls"});
        // Simple command returns empty vec (suppresses JSON but nothing extra to show)
        let lines = render_bash_input(&input, &colors).unwrap();
        assert!(lines.is_empty());
    }

    #[test]
    fn bash_background_shows_flag() {
        let colors = ThemeColors::dark();
        let input = json!({
            "command": "npm run build",
            "background": true,
            "description": "build project"
        });
        let lines = render_bash_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("background"));
        assert!(text.contains("build project"));
    }

    #[test]
    fn file_read_with_range_shows_lines() {
        let colors = ThemeColors::dark();
        let input = json!({
            "path": "/some/file.txt",
            "startLine": 10,
            "endLine": 50
        });
        let lines = render_file_read_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("lines 10-50"));
    }

    #[test]
    fn file_write_shows_size() {
        let colors = ThemeColors::dark();
        let input = json!({
            "path": "/some/file.txt",
            "content": "line 1\nline 2\nline 3\nline 4\nline 5"
        });
        let lines = render_file_write_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("5 lines"));
    }

    #[test]
    fn ripgrep_shows_pattern() {
        let colors = ThemeColors::dark();
        let input = json!({
            "pattern": "TODO",
            "path": "src/",
            "caseSensitive": true
        });
        let lines = render_ripgrep_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("TODO"));
        assert!(text.contains("src/"));
        assert!(text.contains("case-sensitive"));
    }

    #[test]
    fn url_fetch_shows_method_and_url() {
        let colors = ThemeColors::dark();
        let input = json!({
            "url": "https://api.example.com/data",
            "method": "POST",
            "body": "some data"
        });
        let lines = render_url_fetch_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("POST"));
        assert!(text.contains("api.example.com"));
        assert!(text.contains("body:"));
    }

    #[test]
    fn delegate_shows_prompt() {
        let colors = ThemeColors::dark();
        let input = json!({
            "prompt": "Search for all TODO comments in the codebase"
        });
        let lines = render_delegate_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("Search for all TODO"));
    }

    #[test]
    fn delegate_shows_resume_id() {
        let colors = ThemeColors::dark();
        let input = json!({
            "prompt": "Continue the task",
            "resume": "job-123"
        });
        let lines = render_delegate_input(&input, &colors).unwrap();
        let text: String = lines.iter().map(|l| l.to_string()).collect();
        assert!(text.contains("resuming:"));
        assert!(text.contains("job-123"));
    }
}
