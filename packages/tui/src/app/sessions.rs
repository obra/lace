use crate::app::{activity, AppState};
use crate::app::reducer::Outbound;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionsState {
  pub open: bool,
  pub loading: bool,
  pub error: Option<String>,
  pub query: String,
  pub selected: usize,
  pub filtered: Vec<usize>,
  pub renaming: bool,
  pub rename_input: String,
  pub items: Vec<SessionListItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionListItem {
  pub session_id: String,
  pub work_dir: Option<String>,
  pub created: Option<String>,
  pub last_active: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSnapshot {
  pub messages: Vec<crate::app::ChatMessage>,
  pub activity: std::collections::VecDeque<activity::ActivityItem>,
  pub debug_lines: std::collections::VecDeque<String>,
  pub chat_scroll: u16,
  pub activity_scroll: u16,
  pub debug_scroll: u16,
}

impl SessionsState {
  pub fn new() -> Self {
    Self {
      open: false,
      loading: false,
      error: None,
      query: String::new(),
      selected: 0,
      filtered: Vec::new(),
      renaming: false,
      rename_input: String::new(),
      items: Vec::new(),
    }
  }
}

pub fn load_aliases(path: Option<&Path>) -> Result<std::collections::HashMap<String, String>, String> {
  let Some(path) = path else { return Ok(std::collections::HashMap::new()) };
  let content = match std::fs::read_to_string(path) {
    Ok(c) => c,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(std::collections::HashMap::new()),
    Err(e) => return Err(e.to_string()),
  };
  serde_json::from_str::<std::collections::HashMap<String, String>>(&content)
    .map_err(|e| e.to_string())
}

pub fn save_aliases(path: Option<&Path>, aliases: &std::collections::HashMap<String, String>) -> Result<(), String> {
  let Some(path) = path else { return Ok(()) };
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let body = serde_json::to_string_pretty(aliases).map_err(|e| e.to_string())?;
  std::fs::write(path, body).map_err(|e| e.to_string())
}

pub fn open_sessions(state: &mut AppState) -> Vec<Outbound> {
  state.palette_open = false;
  state.help_open = false;
  state.sessions.open = true;
  state.sessions.loading = true;
  state.sessions.error = None;
  state.sessions.query.clear();
  state.sessions.selected = 0;
  state.sessions.filtered.clear();
  state.sessions.renaming = false;
  state.sessions.rename_input.clear();

  let id = state.next_client_id();
  vec![Outbound::JsonRpcRequest {
    id,
    method: "session/list".to_string(),
    params: Some(serde_json::json!({ "workDir": state.workdir.clone() })),
  }]
}

pub fn close_sessions(state: &mut AppState) {
  state.sessions.open = false;
  state.sessions.loading = false;
  state.sessions.error = None;
  state.sessions.renaming = false;
  state.sessions.rename_input.clear();
}

pub fn update_query(state: &mut AppState, query: String) {
  state.sessions.query = query;
  recompute_filter(state);
}

pub fn recompute_filter(state: &mut AppState) {
  let q = state.sessions.query.trim().to_lowercase();
  state.sessions.filtered.clear();

  for (idx, it) in state.sessions.items.iter().enumerate() {
    if q.is_empty() {
      state.sessions.filtered.push(idx);
      continue;
    }
    let alias = state.session_aliases.get(&it.session_id).map(|s| s.to_lowercase());
    let hay = format!(
      "{} {} {}",
      it.session_id.to_lowercase(),
      it.work_dir.clone().unwrap_or_default().to_lowercase(),
      alias.unwrap_or_default()
    );
    if hay.contains(&q) {
      state.sessions.filtered.push(idx);
    }
  }

  if state.sessions.selected >= state.sessions.filtered.len() {
    state.sessions.selected = state.sessions.filtered.len().saturating_sub(1);
  }
}

pub fn prev(state: &mut AppState) {
  state.sessions.selected = state.sessions.selected.saturating_sub(1);
}

pub fn next(state: &mut AppState) {
  let max = state.sessions.filtered.len().saturating_sub(1);
  state.sessions.selected = (state.sessions.selected + 1).min(max);
}

pub fn start_rename(state: &mut AppState) {
  let Some(session_id) = selected_session_id(state) else { return };
  state.sessions.renaming = true;
  state.sessions.rename_input = state
    .session_aliases
    .get(&session_id)
    .cloned()
    .unwrap_or_default();
}

pub fn rename_backspace(state: &mut AppState) {
  state.sessions.rename_input.pop();
}

pub fn rename_char(state: &mut AppState, ch: char) {
  state.sessions.rename_input.push(ch);
}

pub fn submit_rename(state: &mut AppState) {
  let Some(session_id) = selected_session_id(state) else { return };
  let alias = state.sessions.rename_input.trim().to_string();
  if alias.is_empty() {
    state.session_aliases.remove(&session_id);
  } else {
    state.session_aliases.insert(session_id, alias);
  }
  let _ = save_aliases(state.aliases_path.as_deref(), &state.session_aliases);
  state.sessions.renaming = false;
  state.sessions.rename_input.clear();
  recompute_filter(state);
}

pub fn submit_load_selected(state: &mut AppState) -> Vec<Outbound> {
  let Some(session_id) = selected_session_id(state) else { return Vec::new() };
  prepare_for_session_switch(state, Some(session_id.clone()));
  close_sessions(state);

  let id = state.next_client_id();
  vec![Outbound::JsonRpcRequest {
    id,
    method: "session/load".to_string(),
    params: Some(serde_json::json!({ "sessionId": session_id })),
  }]
}

pub fn prepare_for_session_switch(state: &mut AppState, target_session_id: Option<String>) {
  if let Some(current) = state.session_id.clone() {
    state.session_snapshots.insert(
      current,
      SessionSnapshot {
        messages: state.messages.clone(),
        activity: state.activity.clone(),
        debug_lines: state.debug_lines.clone(),
        chat_scroll: state.chat_scroll,
        activity_scroll: state.activity_scroll,
        debug_scroll: state.debug_scroll,
      },
    );
  }

  state.session_switch_target = target_session_id;
  state.messages.clear();
  activity::reset_activity(state);
  state.debug_lines.clear();
  state.chat_scroll = 0;
  state.activity_scroll = 0;
  state.debug_scroll = 0;
}

pub fn on_session_activated(state: &mut AppState, session_id: &str) {
  if let Some(snapshot) = state.session_snapshots.get(session_id).cloned() {
    state.messages = snapshot.messages;
    state.activity = snapshot.activity;
    state.debug_lines = snapshot.debug_lines;
    state.chat_scroll = snapshot.chat_scroll;
    state.activity_scroll = snapshot.activity_scroll;
    state.debug_scroll = snapshot.debug_scroll;
  }
  state.session_switch_target = None;
}

pub fn handle_session_list_response(
  state: &mut AppState,
  result: &Option<Value>,
  error_message: Option<&str>,
) {
  if let Some(err) = error_message {
    state.sessions.loading = false;
    state.sessions.error = Some(err.to_string());
    return;
  }

  let mut items: Vec<SessionListItem> = Vec::new();
  if let Some(Value::Object(obj)) = result {
    if let Some(Value::Array(arr)) = obj.get("sessions") {
      for s in arr {
        let Some(sobj) = s.as_object() else { continue };
        let Some(session_id) = sobj.get("sessionId").and_then(|v| v.as_str()) else { continue };
        let work_dir = sobj.get("workDir").and_then(|v| v.as_str()).map(|s| s.to_string());
        let created = sobj.get("created").and_then(|v| v.as_str()).map(|s| s.to_string());
        let last_active = sobj
          .get("lastActive")
          .and_then(|v| v.as_str())
          .map(|s| s.to_string());
        items.push(SessionListItem {
          session_id: session_id.to_string(),
          work_dir,
          created,
          last_active,
        });
      }
    }
  }

  state.sessions.items = items;
  state.sessions.loading = false;
  state.sessions.error = None;
  recompute_filter(state);
}

fn selected_item(state: &AppState) -> Option<&SessionListItem> {
  let idx = *state.sessions.filtered.get(state.sessions.selected)?;
  state.sessions.items.get(idx)
}

fn selected_session_id(state: &AppState) -> Option<String> {
  Some(selected_item(state)?.session_id.clone())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::app::AppState;
  use serde_json::json;
  use tempfile::tempdir;

  #[test]
  fn session_list_parses_and_filters() {
    let mut state = AppState::new();
    handle_session_list_response(
      &mut state,
      &Some(json!({"sessions":[{"sessionId":"sess_1","workDir":"/a"},{"sessionId":"sess_2","workDir":"/b"}]})),
      None,
    );
    assert_eq!(state.sessions.items.len(), 2);
    assert_eq!(state.sessions.filtered, vec![0, 1]);

    state.session_aliases.insert("sess_2".to_string(), "my session".to_string());
    update_query(&mut state, "my".to_string());
    assert_eq!(state.sessions.filtered, vec![1]);
  }

  #[test]
  fn alias_save_and_load_round_trip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("aliases.json");
    let mut map = std::collections::HashMap::new();
    map.insert("sess_1".to_string(), "one".to_string());
    save_aliases(Some(&path), &map).unwrap();
    let loaded = load_aliases(Some(&path)).unwrap();
    assert_eq!(loaded.get("sess_1").map(|s| s.as_str()), Some("one"));
  }
}
