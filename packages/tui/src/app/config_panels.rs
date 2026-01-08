use crate::app::reducer::Outbound;
use crate::app::AppState;
use serde_json::{json, Value};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelItem {
    pub model_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelsPanelState {
    pub open: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub provider_id: Option<String>,
    pub connection_id: Option<String>,
    pub models: Vec<ModelItem>,
    pub selected: usize,
}

impl Default for ModelsPanelState {
    fn default() -> Self {
        Self {
            open: false,
            loading: false,
            error: None,
            provider_id: None,
            connection_id: None,
            models: Vec::new(),
            selected: 0,
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

    #[test]
    fn handle_models_list_filters_disabled_state() {
        let mut state = AppState::new_with_paths(None, None);
        state.models_panel.open = true;
        state.connection_id = Some("c1".to_string());

        handle_models_list(
            &mut state,
            &Some(json!({
              "providerId":"p1",
              "connectionId":"c1",
              "models":[
                {"modelId":"m1","name":"m1","disabledState":"disabled"},
                {"modelId":"m2","name":"m2","disabledState":"enabled"}
              ]
            })),
            None,
        );

        assert_eq!(state.models_panel.models.len(), 1);
        assert_eq!(state.models_panel.models[0].model_id, "m2");
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

pub fn open_models_panel(state: &mut AppState) -> Vec<Outbound> {
    state.models_panel = ModelsPanelState {
        open: true,
        loading: true,
        error: None,
        provider_id: None,
        connection_id: state.connection_id.clone(),
        models: Vec::new(),
        selected: 0,
    };

    request_models_list(state)
}

pub fn close_models_panel(state: &mut AppState) {
    state.models_panel = ModelsPanelState::default();
}

pub fn request_models_list(state: &mut AppState) -> Vec<Outbound> {
    let Some(conn) = state.connection_id.clone() else {
        state.models_panel.loading = false;
        state.models_panel.error = Some("No active connection".to_string());
        return Vec::new();
    };
    state.models_panel.loading = true;
    let list_id = state.next_client_id();
    vec![
        Outbound::JsonRpcRequest {
            id: list_id,
            method: "ent/models/list".to_string(),
            params: Some(json!({ "connectionId": conn })),
        },
    ]
}

pub fn handle_models_list(
    state: &mut AppState,
    result: &Option<serde_json::Value>,
    error_message: Option<&str>,
) {
    state.models_panel.loading = false;
    if let Some(err) = error_message {
        state.models_panel.error = Some(err.to_string());
        return;
    }
    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        state.models_panel.error = Some("Invalid models response".to_string());
        return;
    };
    state.models_panel.provider_id = obj
        .get("providerId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    state.models_panel.connection_id = obj
        .get("connectionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    state.models_panel.error = None;
    let models = obj
        .get("models")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let o = m.as_object()?;
                    let model_id = o.get("modelId")?.as_str()?.to_string();
                    let name = o
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(model_id.as_str())
                        .to_string();
                    if model_disabled(o) {
                        return None;
                    }
                    Some(ModelItem { model_id, name })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    state.models_panel.models = models;
    state.models_panel.selected = 0;
}

fn model_disabled(o: &serde_json::Map<String, Value>) -> bool {
    if o.get("disabled").and_then(|v| v.as_bool()) == Some(true) {
        return true;
    }

    o.get("disabledState")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s == "disabled")
}

pub fn select_model_for_session(state: &mut AppState) -> Vec<Outbound> {
    if !state.models_panel.open {
        return Vec::new();
    }
    let Some(conn) = state.connection_id.clone().filter(|s| !s.is_empty()) else {
        state.models_panel.error = Some("No active connection".to_string());
        return Vec::new();
    };
    let Some(model) = state
        .models_panel
        .models
        .get(state.models_panel.selected)
        .cloned()
    else {
        return Vec::new();
    };

    state.models_panel.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/session/configure".to_string(),
        params: Some(json!({
            "connectionId": conn,
            "modelId": model.model_id,
            "environment": state.environment,
        })),
    }]
}

pub fn request_models_refresh(state: &mut AppState) -> Vec<Outbound> {
    let Some(conn) = state.models_panel.connection_id.clone().filter(|s| !s.is_empty()) else {
        state.models_panel.loading = false;
        state.models_panel.error = Some("No active connection".to_string());
        return Vec::new();
    };
    state.models_panel.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/models/refresh".to_string(),
        params: Some(json!({ "connectionId": conn })),
    }]
}
