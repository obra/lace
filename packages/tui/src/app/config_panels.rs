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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelItem {
    pub model_id: String,
    pub name: String,
    pub disabled: bool,
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

    let mut seen = false;
    if let Some(obj) = result.as_ref().and_then(|v| v.as_object()) {
        if let Some(arr) = obj.get("connections").and_then(|v| v.as_array()) {
            for c in arr {
                if let Some(cobj) = c.as_object() {
                    let cid = cobj
                        .get("connectionId")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    if cid == conn {
                        seen = true;
                        break;
                    }
                }
            }
        }
    }

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
                    let disabled = o.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    Some(ModelItem {
                        model_id,
                        name,
                        disabled,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    state.models_panel.models = models;
    state.models_panel.selected = 0;
}

pub fn toggle_selected_model(state: &mut AppState) -> Vec<Outbound> {
    if !state.models_panel.open {
        return Vec::new();
    }
    let Some(provider_id) = state.models_panel.provider_id.clone() else {
        state.models_panel.error = Some("Missing providerId".to_string());
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

    let method = if model.disabled {
        "ent/models/enable"
    } else {
        "ent/models/disable"
    };
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: method.to_string(),
        params: Some(json!({ "providerId": provider_id, "modelIds": [model.model_id] })),
    }]
}

pub fn apply_model_toggle_result(state: &mut AppState, result: &Option<serde_json::Value>) {
    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        return;
    };
    let disabled = obj
        .get("disabled")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let disabled_set: std::collections::HashSet<String> = disabled.into_iter().collect();
    for m in &mut state.models_panel.models {
        m.disabled = disabled_set.contains(&m.model_id);
    }
}

pub fn refresh_provider_catalog(state: &mut AppState) -> Vec<Outbound> {
    let id = state.next_client_id();
    let params = if let Some(provider_id) = state.models_panel.provider_id.clone() {
        json!({ "providerId": provider_id })
    } else {
        json!({})
    };
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/providers/refresh".to_string(),
        params: Some(params),
    }]
}
