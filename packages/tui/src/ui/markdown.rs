#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownLine {
    pub text: String,
    pub is_code: bool,
}

pub fn render_markdownish_lines(input: &str) -> Vec<MarkdownLine> {
    let mut out: Vec<MarkdownLine> = Vec::new();
    let mut in_code = false;

    for raw_line in input.lines() {
        let trimmed = raw_line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("```") {
            if in_code {
                out.push(MarkdownLine {
                    text: "└─".to_string(),
                    is_code: true,
                });
                in_code = false;
            } else {
                let label = rest.trim();
                let title = if label.is_empty() { "code" } else { label };
                out.push(MarkdownLine {
                    text: format!("┌─ {title} ─"),
                    is_code: true,
                });
                in_code = true;
            }
            continue;
        }

        if in_code {
            out.push(MarkdownLine {
                text: format!("│ {raw_line}"),
                is_code: true,
            });
        } else {
            out.push(MarkdownLine {
                text: raw_line.to_string(),
                is_code: false,
            });
        }
    }

    if in_code {
        out.push(MarkdownLine {
            text: "└─".to_string(),
            is_code: true,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_fenced_code_blocks_as_boxed_lines() {
        let input = "hello\n```js\nconsole.log(1)\n```\nbye";
        let lines = render_markdownish_lines(input);
        assert_eq!(
            lines,
            vec![
                MarkdownLine {
                    text: "hello".to_string(),
                    is_code: false
                },
                MarkdownLine {
                    text: "┌─ js ─".to_string(),
                    is_code: true
                },
                MarkdownLine {
                    text: "│ console.log(1)".to_string(),
                    is_code: true
                },
                MarkdownLine {
                    text: "└─".to_string(),
                    is_code: true
                },
                MarkdownLine {
                    text: "bye".to_string(),
                    is_code: false
                },
            ]
        );
    }

    #[test]
    fn missing_closing_fence_is_closed_at_end() {
        let input = "```sh\necho hi";
        let lines = render_markdownish_lines(input);
        assert_eq!(
            lines.last(),
            Some(&MarkdownLine {
                text: "└─".to_string(),
                is_code: true
            })
        );
    }
}
