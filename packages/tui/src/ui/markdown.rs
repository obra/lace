/// Style hint for a markdown span. The caller applies actual terminal styles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkdownStyle {
    /// Normal text
    Normal,
    /// Bold text (between ** or __)
    Bold,
    /// Inline code (between backticks)
    InlineCode,
    /// Header line (starts with # through ######)
    Header(u8), // 1-6 for h1-h6
    /// Bullet list item marker
    BulletMarker,
    /// Content after bullet marker
    BulletContent,
    /// Code block content
    CodeBlock,
    /// Code block fence/border characters
    CodeBorder,
}

/// A span of text with a style hint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownSpan {
    pub text: String,
    pub style: MarkdownStyle,
}

/// A rendered markdown line containing styled spans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownLine {
    pub spans: Vec<MarkdownSpan>,
    /// Whether this line is inside a code block (for background styling)
    pub is_code_block: bool,
}

impl MarkdownLine {
    fn new(spans: Vec<MarkdownSpan>, is_code_block: bool) -> Self {
        Self { spans, is_code_block }
    }

    fn single(text: String, style: MarkdownStyle, is_code_block: bool) -> Self {
        Self {
            spans: vec![MarkdownSpan { text, style }],
            is_code_block,
        }
    }

    /// Returns the concatenated text of all spans (for compatibility/testing).
    #[allow(dead_code)]
    pub fn text(&self) -> String {
        self.spans.iter().map(|s| s.text.as_str()).collect()
    }
}

pub fn render_markdownish_lines(input: &str) -> Vec<MarkdownLine> {
    let mut out: Vec<MarkdownLine> = Vec::new();
    let mut in_code = false;

    for raw_line in input.lines() {
        let trimmed = raw_line.trim_start();

        // Handle code fence toggles
        if let Some(rest) = trimmed.strip_prefix("```") {
            if in_code {
                out.push(MarkdownLine::single(
                    "└─".to_string(),
                    MarkdownStyle::CodeBorder,
                    true,
                ));
                in_code = false;
            } else {
                let label = rest.trim();
                let title = if label.is_empty() { "code" } else { label };
                out.push(MarkdownLine::single(
                    format!("┌─ {title} ─"),
                    MarkdownStyle::CodeBorder,
                    true,
                ));
                in_code = true;
            }
            continue;
        }

        if in_code {
            out.push(MarkdownLine::new(
                vec![
                    MarkdownSpan {
                        text: "│ ".to_string(),
                        style: MarkdownStyle::CodeBorder,
                    },
                    MarkdownSpan {
                        text: raw_line.to_string(),
                        style: MarkdownStyle::CodeBlock,
                    },
                ],
                true,
            ));
        } else {
            out.push(parse_prose_line(raw_line));
        }
    }

    if in_code {
        out.push(MarkdownLine::single(
            "└─".to_string(),
            MarkdownStyle::CodeBorder,
            true,
        ));
    }

    out
}

/// Parse a non-code-block line for headers, bullets, and inline formatting.
fn parse_prose_line(line: &str) -> MarkdownLine {
    let trimmed = line.trim_start();

    // Check for headers (# through ######)
    if let Some(header_level) = detect_header(trimmed) {
        let content = trimmed[header_level as usize..].trim_start_matches('#').trim_start();
        return MarkdownLine::single(
            format!("{} {}", "#".repeat(header_level as usize), content),
            MarkdownStyle::Header(header_level),
            false,
        );
    }

    // Check for bullet lists (-, *, or numbered like "1.")
    if let Some((marker, rest)) = detect_bullet(trimmed) {
        let indent = &line[..line.len() - trimmed.len()];
        let content_spans = parse_inline_formatting(rest);
        let mut spans = vec![
            MarkdownSpan {
                text: indent.to_string(),
                style: MarkdownStyle::Normal,
            },
            MarkdownSpan {
                text: marker,
                style: MarkdownStyle::BulletMarker,
            },
        ];
        for s in content_spans {
            spans.push(MarkdownSpan {
                text: s.text,
                // Keep inline styles, but mark as bullet content
                style: if s.style == MarkdownStyle::Normal {
                    MarkdownStyle::BulletContent
                } else {
                    s.style
                },
            });
        }
        return MarkdownLine::new(spans, false);
    }

    // Regular prose line with inline formatting
    let spans = parse_inline_formatting(line);
    MarkdownLine::new(spans, false)
}

/// Detect header level (1-6) or None if not a header.
fn detect_header(line: &str) -> Option<u8> {
    let mut level = 0u8;
    for ch in line.chars() {
        if ch == '#' {
            level += 1;
            if level > 6 {
                return None; // More than 6 # is not a header
            }
        } else if ch == ' ' && level > 0 {
            return Some(level);
        } else {
            return None;
        }
    }
    None
}

/// Detect bullet marker and return (marker_with_space, rest).
fn detect_bullet(line: &str) -> Option<(String, &str)> {
    // Unordered: "- ", "* ", "+ "
    if let Some(rest) = line.strip_prefix("- ") {
        return Some(("- ".to_string(), rest));
    }
    if let Some(rest) = line.strip_prefix("* ") {
        return Some(("* ".to_string(), rest));
    }
    if let Some(rest) = line.strip_prefix("+ ") {
        return Some(("+ ".to_string(), rest));
    }

    // Ordered: "1. ", "2. ", etc.
    let mut chars = line.chars().peekable();
    let mut num = String::new();
    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_digit() {
            num.push(ch);
            chars.next();
        } else {
            break;
        }
    }
    if !num.is_empty() && chars.next() == Some('.') && chars.next() == Some(' ') {
        let marker = format!("{}. ", num);
        let rest_start = marker.len();
        if rest_start <= line.len() {
            return Some((marker, &line[rest_start..]));
        }
    }

    None
}

/// Parse inline formatting: **bold**, `code`.
fn parse_inline_formatting(text: &str) -> Vec<MarkdownSpan> {
    let mut spans = Vec::new();
    let mut chars = text.chars().peekable();
    let mut current = String::new();

    while let Some(ch) = chars.next() {
        match ch {
            '`' => {
                // Inline code
                if !current.is_empty() {
                    spans.push(MarkdownSpan {
                        text: std::mem::take(&mut current),
                        style: MarkdownStyle::Normal,
                    });
                }
                let mut code = String::new();
                let mut found_close = false;
                for c in chars.by_ref() {
                    if c == '`' {
                        found_close = true;
                        break;
                    }
                    code.push(c);
                }
                if found_close && !code.is_empty() {
                    spans.push(MarkdownSpan {
                        text: code,
                        style: MarkdownStyle::InlineCode,
                    });
                } else {
                    // No closing backtick, treat as literal
                    current.push('`');
                    current.push_str(&code);
                }
            }
            '*' if chars.peek() == Some(&'*') => {
                // Potential bold **text**
                chars.next(); // consume second *
                if !current.is_empty() {
                    spans.push(MarkdownSpan {
                        text: std::mem::take(&mut current),
                        style: MarkdownStyle::Normal,
                    });
                }
                let mut bold = String::new();
                let mut found_close = false;
                while let Some(c) = chars.next() {
                    if c == '*' && chars.peek() == Some(&'*') {
                        chars.next(); // consume second *
                        found_close = true;
                        break;
                    }
                    bold.push(c);
                }
                if found_close && !bold.is_empty() {
                    spans.push(MarkdownSpan {
                        text: bold,
                        style: MarkdownStyle::Bold,
                    });
                } else {
                    // No closing **, treat as literal
                    current.push_str("**");
                    current.push_str(&bold);
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }

    if !current.is_empty() {
        spans.push(MarkdownSpan {
            text: current,
            style: MarkdownStyle::Normal,
        });
    }

    if spans.is_empty() {
        spans.push(MarkdownSpan {
            text: String::new(),
            style: MarkdownStyle::Normal,
        });
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_fenced_code_blocks_as_boxed_lines() {
        let input = "hello\n```js\nconsole.log(1)\n```\nbye";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.len(), 5);

        // "hello"
        assert_eq!(lines[0].text(), "hello");
        assert!(!lines[0].is_code_block);

        // Code fence open
        assert_eq!(lines[1].text(), "┌─ js ─");
        assert!(lines[1].is_code_block);

        // Code content
        assert_eq!(lines[2].text(), "│ console.log(1)");
        assert!(lines[2].is_code_block);

        // Code fence close
        assert_eq!(lines[3].text(), "└─");
        assert!(lines[3].is_code_block);

        // "bye"
        assert_eq!(lines[4].text(), "bye");
        assert!(!lines[4].is_code_block);
    }

    #[test]
    fn missing_closing_fence_is_closed_at_end() {
        let input = "```sh\necho hi";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.last().map(|l| l.text()), Some("└─".to_string()));
        assert!(lines.last().unwrap().is_code_block);
    }

    #[test]
    fn parses_bold_text() {
        let input = "this is **bold** text";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.len(), 1);
        let spans = &lines[0].spans;
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[0].text, "this is ");
        assert_eq!(spans[0].style, MarkdownStyle::Normal);
        assert_eq!(spans[1].text, "bold");
        assert_eq!(spans[1].style, MarkdownStyle::Bold);
        assert_eq!(spans[2].text, " text");
        assert_eq!(spans[2].style, MarkdownStyle::Normal);
    }

    #[test]
    fn parses_inline_code() {
        let input = "use `cargo build` here";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.len(), 1);
        let spans = &lines[0].spans;
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[0].text, "use ");
        assert_eq!(spans[1].text, "cargo build");
        assert_eq!(spans[1].style, MarkdownStyle::InlineCode);
        assert_eq!(spans[2].text, " here");
    }

    #[test]
    fn parses_headers() {
        let input = "# Heading 1\n## Heading 2";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].spans[0].style, MarkdownStyle::Header(1));
        assert_eq!(lines[1].spans[0].style, MarkdownStyle::Header(2));
    }

    #[test]
    fn parses_bullet_lists() {
        let input = "- item one\n* item two\n1. numbered";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.len(), 3);

        // Check first bullet
        assert!(lines[0].spans.iter().any(|s| s.style == MarkdownStyle::BulletMarker));
        assert!(lines[0].spans.iter().any(|s| s.text == "- "));

        // Check asterisk bullet
        assert!(lines[1].spans.iter().any(|s| s.text == "* "));

        // Check numbered list
        assert!(lines[2].spans.iter().any(|s| s.text == "1. "));
    }

    #[test]
    fn mixed_inline_formatting() {
        let input = "**bold** and `code`";
        let lines = render_markdownish_lines(input);
        assert_eq!(lines.len(), 1);
        let spans = &lines[0].spans;
        // Should have: bold, " and ", code
        assert!(spans.iter().any(|s| s.style == MarkdownStyle::Bold && s.text == "bold"));
        assert!(spans.iter().any(|s| s.style == MarkdownStyle::InlineCode && s.text == "code"));
    }
}
