use crate::app::reducer::Outbound;
use crate::app::AppState;
use serde_json::json;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvEditorState {
    pub open: bool,
    pub input: String,
    pub selected: usize,
    pub error: Option<String>,
}

impl Default for EnvEditorState {
    fn default() -> Self {
        Self {
            open: false,
            input: String::new(),
            selected: 0,
            error: None,
        }
    }
}

/// Auto-configure session using last-known connection/model prefs once we know a ready connection exists.
/// This should be called after receiving `ent/connections/list` so we don't spam the agent with stale IDs.
pub fn maybe_autoconfigure_from_connections(
    state: &mut AppState,
    result: &Option<serde_json::Value>,
) -> Vec<Outbound> {
    if state.connection_id.is_some() {
        return Vec::new();
    }

    let Some(conn) = state
        .prefs
        .last_connection_id
        .clone()
        .filter(|s| !s.is_empty())
    else {
        return Vec::new();
    };
    let Some(model) = state.prefs.last_model_id.clone().filter(|s| !s.is_empty()) else {
        return Vec::new();
    };

    let seen = connection_exists_in_list(result, &conn);

    if !seen {
        return Vec::new();
    }

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/session/configure".to_string(),
        params: Some(json!({
            "connectionId": conn,
            "modelId": model,
            "environment": state.environment,
        })),
    }]
}

pub fn connection_exists_in_list(result: &Option<serde_json::Value>, conn: &str) -> bool {
    if conn.is_empty() {
        return false;
    }

    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        return false;
    };
    let Some(arr) = obj.get("connections").and_then(|v| v.as_array()) else {
        return false;
    };

    for c in arr {
        let Some(cobj) = c.as_object() else {
            continue;
        };
        let cid = cobj
            .get("connectionId")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if cid == conn {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn connection_exists_in_list_handles_missing_or_invalid() {
        assert!(!connection_exists_in_list(&None, "c1"));
        assert!(!connection_exists_in_list(&Some(json!({})), "c1"));
        assert!(!connection_exists_in_list(&Some(json!({"connections": []})), "c1"));
        assert!(!connection_exists_in_list(&Some(json!({"connections": [{"connectionId":"c2"}]})), "c1"));
    }

    #[test]
    fn connection_exists_in_list_detects_match() {
        let result = Some(json!({"connections":[{"connectionId":"c1"},{"connectionId":"c2"}]}));
        assert!(connection_exists_in_list(&result, "c1"));
        assert!(connection_exists_in_list(&result, "c2"));
    }
}

pub fn open_env_editor(state: &mut AppState) {
    state.env_editor.open = true;
    state.env_editor.error = None;
    state.env_editor.input.clear();
    state.env_editor.selected = 0;

    if state.environment.is_empty() {
        if let Some(saved) = state.prefs.environment.clone() {
            state.environment = saved;
        }
    }
}

pub fn close_env_editor(state: &mut AppState) {
    state.env_editor.open = false;
    state.env_editor.error = None;
    state.env_editor.input.clear();
}

pub fn env_input_backspace(state: &mut AppState) {
    state.env_editor.input.pop();
}

pub fn env_input_char(state: &mut AppState, ch: char) {
    state.env_editor.input.push(ch);
}

pub fn env_save_entry(state: &mut AppState) {
    let line = state.env_editor.input.trim();
    if line.is_empty() {
        return;
    }
    if let Some((k, v)) = line.split_once('=') {
        let key = k.trim();
        let val = v.trim();
        if key.is_empty() {
            state.env_editor.error = Some("Key cannot be empty".to_string());
            return;
        }
        state.environment.insert(key.to_string(), val.to_string());
        state.env_editor.input.clear();
        state.env_editor.error = None;
    } else {
        state.env_editor.error = Some("Use KEY=VALUE format".to_string());
    }
}

pub fn env_delete_selected(state: &mut AppState) {
    if state.environment.is_empty() {
        return;
    }
    let idx = state
        .env_editor
        .selected
        .min(state.environment.len().saturating_sub(1));
    if let Some((k, _)) = state.environment.iter().nth(idx) {
        let key = k.clone();
        state.environment.remove(&key);
    }
    if state.env_editor.selected >= state.environment.len() {
        state.env_editor.selected = state.environment.len().saturating_sub(1);
    }
}

pub fn env_next(state: &mut AppState) {
    let max = state.environment.len().saturating_sub(1);
    state.env_editor.selected = (state.env_editor.selected + 1).min(max);
}

pub fn env_prev(state: &mut AppState) {
    state.env_editor.selected = state.env_editor.selected.saturating_sub(1);
}

pub fn env_apply(state: &mut AppState) -> Vec<Outbound> {
    let id = state.next_client_id();
    let env = state.environment.clone();
    state.prefs.environment = Some(env.clone());
    let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/session/configure".to_string(),
        params: Some(json!({ "environment": env })),
    }]
}
