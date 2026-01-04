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
  pub job_id: Option<String>,
  pub turn_id: Option<String>,
  pub turn_seq: Option<i64>,
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
      job_id: None,
      turn_id: None,
      turn_seq: None,
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
      job_id: None,
      turn_id: None,
      turn_seq: None,
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
      job_id: None,
      turn_id: None,
      turn_seq: None,
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
      job_id: None,
      turn_id: None,
      turn_seq: None,
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
      job_id: Some(job_id),
      turn_id: None,
      turn_seq: None,
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
      job_id: Some(job_id),
      turn_id: None,
      turn_seq: None,
    },
  );
}

pub fn push_turn_end(state: &mut AppState, stop_reason: Option<String>, turn_id: Option<String>, turn_seq: Option<i64>) {
  let seq = next_seq(state);
  push_item(
    state,
    ActivityItem {
      seq,
      kind: ActivityKind::TurnEnd,
      summary: format!("turn_end {}", stop_reason.unwrap_or_else(|| "?".to_string())),
      expanded: false,
      details: None,
      tool_call_id: None,
      job_id: None,
      turn_id,
      turn_seq,
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
  let idx = state
    .activity
    .iter()
    .position(|i| i.kind == ActivityKind::ToolUse && i.tool_call_id.as_deref() == Some(&tool_call_id));

  let summary = {
    let status = status.unwrap_or_else(|| "?".to_string());
    let name = name.unwrap_or_else(|| "?".to_string());
    format!("tool_use {status} {name} ({tool_call_id})")
  };

  let details = Some({
    let mut map: Map<String, Value> = Map::new();
    map.insert("toolCallId".to_string(), Value::String(tool_call_id.clone()));
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
        item.details = merge_details(item.details.take(), details);
        item.job_id = job_id;
        item.turn_id = turn_id;
        item.turn_seq = turn_seq;
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
          job_id,
          turn_id,
          turn_seq,
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
          job_id: None,
          turn_id: None,
          turn_seq: None,
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
  let follow_tail = !state.activity.is_empty() && state.activity_selected + 1 == state.activity.len();
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
    assert!(item.summary.contains("completed"));
    let details = item.details.clone().unwrap();
    assert_eq!(details.get("result"), Some(&json!({"ok":true})));
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
    assert_eq!(item.details.as_ref().unwrap().get("decision"), Some(&json!("allow")));
  }
}
