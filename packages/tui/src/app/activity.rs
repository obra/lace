use super::AppState;
use serde_json::{Map, Value};

const MAX_ACTIVITY: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityKind {
    Log,
    RpcSent,
    RpcError,
    ToolUse,
    Permission,
    JobStarted,
    JobFinished,
    TurnEnd,
    Timeout,
}

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

    /// Compact result preview for folded display (e.g., first line of tool output)
    pub result_preview: Option<String>,
}

/// Extracts a useful summary from tool input based on tool type.
/// Returns a human-readable description of what the tool is doing.
fn extract_tool_summary(tool_name: Option<&str>, input: &Value) -> String {
    let tool = tool_name.unwrap_or("unknown");

    match tool {
        // File operations - show path
        "file_read" | "file_write" | "file_find" => {
            if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                path.to_string()
            } else if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                pattern.to_string()
            } else {
                String::new()
            }
        }
        "file_edit" => {
            if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                let edit_count = input
                    .get("edits")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if edit_count > 1 {
                    format!("{} ({} edits)", path, edit_count)
                } else {
                    path.to_string()
                }
            } else {
                String::new()
            }
        }
        // Shell commands - show command (truncated)
        "bash" | "shell" | "shell.exec" => {
            if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
                // Truncate long commands
                if cmd.len() > 60 {
                    format!("{}...", &cmd[..57])
                } else {
                    cmd.to_string()
                }
            } else {
                String::new()
            }
        }
        // Search - show pattern
        "ripgrep_search" | "grep" | "search" => {
            if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                format!("/{}/", pattern)
            } else {
                String::new()
            }
        }
        // Delegation - show description
        "delegate" | "task" => {
            if let Some(desc) = input
                .get("description")
                .or_else(|| input.get("prompt"))
                .and_then(|v| v.as_str())
            {
                if desc.len() > 60 {
                    format!("{}...", &desc[..57])
                } else {
                    desc.to_string()
                }
            } else {
                String::new()
            }
        }
        // URL fetch - show URL
        "url_fetch" | "web_fetch" => {
            if let Some(url) = input.get("url").and_then(|v| v.as_str()) {
                url.to_string()
            } else {
                String::new()
            }
        }
        // Todo operations have special handling in render
        "todo_read" | "todo_write" => String::new(),
        // Default - try common field names
        _ => {
            // Try path, command, query, url in order
            for field in ["path", "command", "query", "url", "pattern", "name"] {
                if let Some(val) = input.get(field).and_then(|v| v.as_str()) {
                    if val.len() > 60 {
                        return format!("{}...", &val[..57]);
                    } else {
                        return val.to_string();
                    }
                }
            }
            String::new()
        }
    }
}

pub fn push_log_line(state: &mut AppState, summary: String) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::Log,
            summary,
            expanded: false,
            details: None,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: None,
            turn_id: None,
            turn_seq: None,
            result_preview: None,
        },
    );
}

pub fn push_rpc_sent(state: &mut AppState, method: String) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::RpcSent,
            summary: format!("{method}: sent"),
            expanded: false,
            details: None,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: None,
            turn_id: None,
            turn_seq: None,
            result_preview: None,
        },
    );
}

pub fn push_rpc_error(state: &mut AppState, message: String, details: Option<Value>) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::RpcError,
            summary: format!("error: {message}"),
            expanded: true,
            details,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: None,
            turn_id: None,
            turn_seq: None,
            result_preview: None,
        },
    );
}

pub fn push_timeout(state: &mut AppState, id: String, method: String) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::Timeout,
            summary: format!("timeout: {id} ({method})"),
            expanded: false,
            details: None,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: None,
            turn_id: None,
            turn_seq: None,
            result_preview: None,
        },
    );
}

pub fn push_job_started(state: &mut AppState, job_id: String, job_type: Option<String>) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::JobStarted,
            summary: format!(
                "job_started {} ({job_id})",
                job_type.unwrap_or_else(|| "?".to_string())
            ),
            expanded: false,
            details: None,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: Some(job_id),
            turn_id: None,
            turn_seq: None,
            result_preview: None,
        },
    );
}

pub fn push_job_finished(state: &mut AppState, job_id: String, outcome: Option<String>) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::JobFinished,
            summary: format!(
                "job_finished {} ({job_id})",
                outcome.unwrap_or_else(|| "?".to_string())
            ),
            expanded: false,
            details: None,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: Some(job_id),
            turn_id: None,
            turn_seq: None,
            result_preview: None,
        },
    );
}

pub fn push_turn_end(
    state: &mut AppState,
    stop_reason: Option<String>,
    turn_id: Option<String>,
    turn_seq: Option<i64>,
) {
    let seq = next_seq(state);
    push_item(
        state,
        ActivityItem {
            seq,
            kind: ActivityKind::TurnEnd,
            summary: format!(
                "turn_end {}",
                stop_reason.unwrap_or_else(|| "?".to_string())
            ),
            expanded: false,
            details: None,
            tool_call_id: None,
            tool_name: None,
            status: None,
            job_id: None,
            turn_id,
            turn_seq,
            result_preview: None,
        },
    );
}

pub fn upsert_tool_use(
    state: &mut AppState,
    tool_call_id: String,
    name: Option<String>,
    status: Option<String>,
    input: Value,
    result: Option<Value>,
    job_id: Option<String>,
    turn_id: Option<String>,
    turn_seq: Option<i64>,
) {
    let idx = state.activity.iter().position(|i| {
        i.kind == ActivityKind::ToolUse && i.tool_call_id.as_deref() == Some(&tool_call_id)
    });

    // Generate useful summary from input based on tool type
    let summary = extract_tool_summary(name.as_deref(), &input);

    let details = Some({
        let mut map: Map<String, Value> = Map::new();
        map.insert(
            "toolCallId".to_string(),
            Value::String(tool_call_id.clone()),
        );
        if let Some(job_id) = &job_id {
            map.insert("jobId".to_string(), Value::String(job_id.clone()));
        }
        if let Some(turn_id) = &turn_id {
            map.insert("turnId".to_string(), Value::String(turn_id.clone()));
        }
        if let Some(turn_seq) = turn_seq {
            map.insert("turnSeq".to_string(), Value::Number(turn_seq.into()));
        }
        map.insert("input".to_string(), input);
        if let Some(result) = result {
            map.insert("result".to_string(), result);
        }
        Value::Object(map)
    });

    match idx {
        Some(i) => {
            if let Some(item) = state.activity.get_mut(i) {
                item.summary = summary;
                item.tool_name = name;
                item.status = status;
                item.details = merge_details(item.details.take(), details);
                item.job_id = job_id.or_else(|| item.job_id.clone());
                // Preserve existing turn_id/turn_seq if new value is None
                item.turn_id = turn_id.or_else(|| item.turn_id.clone());
                item.turn_seq = turn_seq.or(item.turn_seq);
            }
        }
        None => {
            let seq = next_seq(state);
            push_item(
                state,
                ActivityItem {
                    seq,
                    kind: ActivityKind::ToolUse,
                    summary,
                    expanded: false,
                    details,
                    tool_call_id: Some(tool_call_id),
                    tool_name: name,
                    status,
                    job_id,
                    turn_id,
                    turn_seq,
                    result_preview: None,
                },
            );
        }
    }
}

pub fn attach_permission_details(
    state: &mut AppState,
    tool_call_id: String,
    tool: Option<String>,
    kind: Option<String>,
    resource: Option<String>,
    decision: Option<String>,
) {
    let idx = state
        .activity
        .iter()
        .position(|i| i.tool_call_id.as_deref() == Some(&tool_call_id));

    let details = Some({
        let mut map: Map<String, Value> = Map::new();
        if let Some(tool) = tool {
            map.insert("tool".to_string(), Value::String(tool));
        }
        if let Some(kind) = kind {
            map.insert("kind".to_string(), Value::String(kind));
        }
        if let Some(resource) = resource {
            map.insert("resource".to_string(), Value::String(resource));
        }
        if let Some(decision) = decision {
            map.insert("decision".to_string(), Value::String(decision));
        }
        Value::Object(map)
    });

    match idx {
        Some(i) => {
            if let Some(item) = state.activity.get_mut(i) {
                item.details = merge_details(item.details.take(), details);
            }
        }
        None => {
            let seq = next_seq(state);
            push_item(
                state,
                ActivityItem {
                    seq,
                    kind: ActivityKind::Permission,
                    summary: format!("permission ({tool_call_id})"),
                    expanded: true,
                    details,
                    tool_call_id: Some(tool_call_id),
                    tool_name: None,
                    status: None,
                    job_id: None,
                    turn_id: None,
                    turn_seq: None,
                    result_preview: None,
                },
            );
        }
    }
}

pub fn reset_activity(state: &mut AppState) {
    state.activity.clear();
    state.activity_selected = 0;
    state.activity_scroll = 0;
    state.next_activity_seq = 1;
}

fn next_seq(state: &mut AppState) -> u64 {
    let seq = state.next_activity_seq;
    state.next_activity_seq = state.next_activity_seq.saturating_add(1);
    seq
}

fn push_item(state: &mut AppState, item: ActivityItem) {
    let follow_tail =
        !state.activity.is_empty() && state.activity_selected + 1 == state.activity.len();
    state.activity.push_back(item);

    while state.activity.len() > MAX_ACTIVITY {
        state.activity.pop_front();
        if state.activity_selected > 0 {
            state.activity_selected -= 1;
        }
    }

    if follow_tail || state.activity.len() == 1 {
        state.activity_selected = state.activity.len().saturating_sub(1);
    }
}

fn merge_details(existing: Option<Value>, incoming: Option<Value>) -> Option<Value> {
    match (existing, incoming) {
        (None, other) => other,
        (Some(existing), None) => Some(existing),
        (Some(Value::Object(mut existing)), Some(Value::Object(incoming))) => {
            for (k, v) in incoming {
                existing.insert(k, v);
            }
            Some(Value::Object(existing))
        }
        (Some(existing), Some(incoming)) => Some(Value::Array(vec![existing, incoming])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::AppState;
    use serde_json::json;

    #[test]
    fn push_item_caps_and_adjusts_selection() {
        let mut state = AppState::new();
        state.activity_selected = 0;

        for i in 0..(MAX_ACTIVITY + 5) {
            push_log_line(&mut state, format!("l{i}"));
        }

        assert_eq!(state.activity.len(), MAX_ACTIVITY);
        assert_eq!(state.activity_selected, MAX_ACTIVITY - 1);
    }

    #[test]
    fn upsert_tool_use_updates_existing_item() {
        let mut state = AppState::new();
        upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("shell.exec".to_string()),
            Some("awaiting_permission".to_string()),
            json!({"command":"echo hi"}),
            None,
            None,
            None,
            None,
        );
        upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("shell.exec".to_string()),
            Some("completed".to_string()),
            json!({"command":"echo hi"}),
            Some(json!({"ok":true})),
            None,
            None,
            None,
        );

        assert_eq!(state.activity.len(), 1);
        let item = state.activity.front().unwrap();
        // Summary now shows the command, not status
        assert!(item.summary.contains("echo hi"));
        assert_eq!(item.status.as_deref(), Some("completed"));
        let details = item.details.clone().unwrap();
        assert_eq!(details.get("result"), Some(&json!({"ok":true})));
    }

    #[test]
    fn upsert_tool_use_preserves_turn_id_on_update() {
        let mut state = AppState::new();

        // First call sets turn_id
        upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("shell.exec".to_string()),
            Some("awaiting_permission".to_string()),
            json!({"command":"echo hi"}),
            None,
            None,
            Some("turn_abc".to_string()),
            Some(1),
        );

        // Second call with None turn_id should preserve the existing one
        upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("shell.exec".to_string()),
            Some("completed".to_string()),
            json!({"command":"echo hi"}),
            Some(json!({"ok":true})),
            None,
            None, // No turn_id in update
            None, // No turn_seq in update
        );

        assert_eq!(state.activity.len(), 1);
        let item = state.activity.front().unwrap();
        assert_eq!(item.turn_id, Some("turn_abc".to_string()));
        assert_eq!(item.turn_seq, Some(1));
    }

    #[test]
    fn attach_permission_details_merges_into_tool_item() {
        let mut state = AppState::new();
        upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("shell.exec".to_string()),
            Some("awaiting_permission".to_string()),
            json!({"command":"echo hi"}),
            None,
            None,
            None,
            None,
        );
        attach_permission_details(
            &mut state,
            "tool_1".to_string(),
            Some("shell.exec".to_string()),
            Some("execute".to_string()),
            Some("echo hi".to_string()),
            Some("allow".to_string()),
        );

        assert_eq!(state.activity.len(), 1);
        let item = state.activity.front().unwrap();
        assert_eq!(
            item.details.as_ref().unwrap().get("decision"),
            Some(&json!("allow"))
        );
    }
}
