use crate::app::{activity, AppState, Focus, Role};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchState {
    pub open: bool,
    pub query: String,
    pub selected: usize,
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchResult {
    pub label: String,
    pub target: SearchTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchTarget {
    ChatScroll(u16),
    ActivityIndex(usize),
    DebugScroll(u16),
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            open: false,
            query: String::new(),
            selected: 0,
            results: Vec::new(),
        }
    }
}

pub fn open(state: &mut AppState) {
    state.search.open = true;
    state.search.query.clear();
    state.search.selected = 0;
    state.search.results.clear();
}

pub fn close(state: &mut AppState) {
    state.search.open = false;
    state.search.query.clear();
    state.search.results.clear();
    state.search.selected = 0;
}

pub fn input_char(state: &mut AppState, ch: char) {
    state.search.query.push(ch);
    recompute(state);
}

pub fn backspace(state: &mut AppState) {
    state.search.query.pop();
    recompute(state);
}

pub fn prev(state: &mut AppState) {
    state.search.selected = state.search.selected.saturating_sub(1);
}

pub fn next(state: &mut AppState) {
    let max = state.search.results.len().saturating_sub(1);
    state.search.selected = (state.search.selected + 1).min(max);
}

pub fn jump_selected(state: &mut AppState) {
    let Some(item) = state.search.results.get(state.search.selected) else {
        return;
    };
    match item.target {
        SearchTarget::ChatScroll(scroll) => {
            state.focus = Focus::Chat;
            state.chat_follow = false;
            state.chat_scroll = scroll;
        }
        SearchTarget::ActivityIndex(idx) => {
            state.focus = Focus::Activity;
            state.activity_selected = idx.min(state.activity.len().saturating_sub(1));
        }
        SearchTarget::DebugScroll(scroll) => {
            state.focus = Focus::Debug;
            state.debug_scroll = scroll;
        }
    }
    close(state);
}

pub fn jump_last_error(state: &mut AppState) {
    if let Some((idx, _)) = state.activity.iter().enumerate().rev().find(|(_, i)| {
        matches!(
            i.kind,
            activity::ActivityKind::RpcError | activity::ActivityKind::Timeout
        )
    }) {
        state.focus = Focus::Activity;
        state.activity_selected = idx;
    }
}

pub fn jump_last_tool_use(state: &mut AppState) {
    if let Some((idx, _)) = state
        .activity
        .iter()
        .enumerate()
        .rev()
        .find(|(_, i)| i.kind == activity::ActivityKind::ToolUse)
    {
        state.focus = Focus::Activity;
        state.activity_selected = idx;
    }
}

pub fn jump_last_turn_end(state: &mut AppState) {
    if let Some((idx, _)) = state
        .activity
        .iter()
        .enumerate()
        .rev()
        .find(|(_, i)| i.kind == activity::ActivityKind::TurnEnd)
    {
        state.focus = Focus::Activity;
        state.activity_selected = idx;
    }
}

fn recompute(state: &mut AppState) {
    let q = state.search.query.trim().to_lowercase();
    state.search.results.clear();
    state.search.selected = 0;

    if q.is_empty() {
        return;
    }

    // Chat: add assistant/user messages.
    for (idx, m) in state.messages.iter().enumerate() {
        if !m.text.to_lowercase().contains(&q) {
            continue;
        }
        let prefix = match m.role {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::System => "system",
        };
        state.search.results.push(SearchResult {
            label: format!("{prefix}: {}", first_line(&m.text)),
            target: SearchTarget::ChatScroll(chat_start_line_for_message_index(
                &state.messages,
                idx,
            )),
        });
    }

    // Activity: match summary + details string.
    for (idx, it) in state.activity.iter().enumerate() {
        let mut hit = it.summary.to_lowercase().contains(&q);
        if !hit {
            if let Some(details) = &it.details {
                hit = details.to_string().to_lowercase().contains(&q);
            }
        }
        if hit {
            state.search.results.push(SearchResult {
                label: format!("activity: {}", it.summary),
                target: SearchTarget::ActivityIndex(idx),
            });
        }
    }

    // Debug: match line text.
    let debug_lines: Vec<&String> = state.debug_lines.iter().collect();
    for (line_idx, line) in debug_lines.iter().enumerate() {
        if line.to_lowercase().contains(&q) {
            state.search.results.push(SearchResult {
                label: format!("debug: {}", first_line(line)),
                target: SearchTarget::DebugScroll(line_idx.min(u16::MAX as usize) as u16),
            });
        }
    }
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or("").to_string()
}

fn chat_start_line_for_message_index(messages: &[crate::app::ChatMessage], idx: usize) -> u16 {
    let mut lines: u64 = 0;
    for m in messages.iter().take(idx) {
        lines += 1; // prefix
        lines += m.text.lines().count() as u64;
        lines += 1; // blank line after message
    }
    lines.min(u16::MAX as u64) as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{ChatMessage, Role};

    #[test]
    fn search_finds_chat_and_activity() {
        let mut state = AppState::new();
        state.messages.push(ChatMessage {
            role: Role::User,
            text: "hello world".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });
        activity::push_log_line(&mut state, "something happened".to_string());
        activity::push_rpc_error(&mut state, "bad stuff".to_string(), None);

        open(&mut state);
        input_char(&mut state, 'w');
        assert!(!state.search.results.is_empty());

        state.search.query = "bad".to_string();
        recompute(&mut state);
        assert!(state
            .search
            .results
            .iter()
            .any(|r| r.label.contains("activity: error")));
    }
}
