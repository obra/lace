use crate::app::reducer::Outbound;
use crate::app::AppState;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionsState {
    pub open: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub selected: usize,
    pub items: Vec<ConnectionListItem>,
    pub renaming: bool,
    pub rename_input: String,
    pub confirm_delete: bool,
    pub confirm_clear_credentials: bool,
    pub models: ConnectionModelsState,
    pub last_test: std::collections::HashMap<String, TestResult>,
    pub credential_status: std::collections::HashMap<String, CredentialStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionListItem {
    pub connection_id: String,
    pub provider_id: String,
    pub name: String,
    pub credential_state: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestResult {
    pub ok: bool,
    pub error: Option<String>,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialStatus {
    pub state: String,
    pub account_label: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionModelsState {
    pub open: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub provider_id: Option<String>,
    pub connection_id: Option<String>,
    pub connection_name: Option<String>,
    pub selected: usize,
    pub models: Vec<ConnectionModelItem>,
    /// Tracks which models are disabled at the connection level
    pub disabled_models: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionModelItem {
    pub model_id: String,
    pub name: String,
    pub disabled: bool,
}

impl ConnectionsState {
    pub fn new() -> Self {
        Self {
            open: false,
            loading: false,
            error: None,
            selected: 0,
            items: Vec::new(),
            renaming: false,
            rename_input: String::new(),
            confirm_delete: false,
            confirm_clear_credentials: false,
            models: ConnectionModelsState::new(),
            last_test: std::collections::HashMap::new(),
            credential_status: std::collections::HashMap::new(),
        }
    }
}

impl ConnectionModelsState {
    pub fn new() -> Self {
        Self {
            open: false,
            loading: false,
            error: None,
            provider_id: None,
            connection_id: None,
            connection_name: None,
            selected: 0,
            models: Vec::new(),
            disabled_models: Vec::new(),
        }
    }
}

pub fn open_connections(state: &mut AppState) -> Vec<Outbound> {
    state.palette_open = false;
    state.help_open = false;
    state.connections.open = true;
    state.connections.loading = true;
    state.connections.error = None;
    state.connections.selected = 0;
    state.connections.renaming = false;
    state.connections.rename_input.clear();
    state.connections.confirm_delete = false;
    state.connections.confirm_clear_credentials = false;
    state.connections.models = ConnectionModelsState::new();

    request_list(state)
}

pub fn close_connections(state: &mut AppState) {
    state.connections.open = false;
    state.connections.loading = false;
    state.connections.error = None;
    state.connections.renaming = false;
    state.connections.rename_input.clear();
    state.connections.confirm_delete = false;
    state.connections.confirm_clear_credentials = false;
    state.connections.models = ConnectionModelsState::new();
}

pub fn prev(state: &mut AppState) {
    state.connections.selected = state.connections.selected.saturating_sub(1);
}

pub fn next(state: &mut AppState) {
    let max = state.connections.items.len().saturating_sub(1);
    state.connections.selected = (state.connections.selected + 1).min(max);
}

pub fn request_list(state: &mut AppState) -> Vec<Outbound> {
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/list".to_string(),
        params: Some(json!({})),
    }]
}

pub fn handle_list_response(state: &mut AppState, result: &Option<Value>, error_message: Option<&str>) {
    state.connections.loading = false;
    state.connections.renaming = false;
    state.connections.rename_input.clear();
    state.connections.confirm_delete = false;
    state.connections.confirm_clear_credentials = false;
    state.connections.models = ConnectionModelsState::new();

    if let Some(err) = error_message {
        state.connections.error = Some(err.to_string());
        return;
    }

    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        state.connections.error = Some("Invalid connections response".to_string());
        return;
    };
    let Some(arr) = obj.get("connections").and_then(|v| v.as_array()) else {
        state.connections.error = Some("Invalid connections response".to_string());
        return;
    };

    let mut items: Vec<ConnectionListItem> = Vec::new();
    for c in arr {
        let Some(cobj) = c.as_object() else { continue };
        let Some(connection_id) = cobj.get("connectionId").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(provider_id) = cobj.get("providerId").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(name) = cobj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let credential_state = cobj
            .get("credentialState")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let endpoint = cobj
            .get("endpoint")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        items.push(ConnectionListItem {
            connection_id: connection_id.to_string(),
            provider_id: provider_id.to_string(),
            name: name.to_string(),
            credential_state,
            endpoint,
        });
    }

    state.connections.items = items;
    if state.connections.selected >= state.connections.items.len() {
        state.connections.selected = state.connections.items.len().saturating_sub(1);
    }
    state.connections.error = None;
}

pub fn open_models(state: &mut AppState) -> Vec<Outbound> {
    let Some(it) = selected_item(state) else { return Vec::new() };
    state.connections.models.open = true;
    state.connections.models.loading = true;
    state.connections.models.error = None;
    state.connections.models.provider_id = None;
    state.connections.models.connection_id = Some(it.connection_id.clone());
    state.connections.models.connection_name = Some(it.name.clone());
    state.connections.models.selected = 0;
    state.connections.models.models.clear();
    state.connections.models.disabled_models.clear();

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/models/list".to_string(),
        params: Some(json!({ "connectionId": it.connection_id })),
    }]
}

pub fn close_models(state: &mut AppState) {
    state.connections.models = ConnectionModelsState::new();
}

pub fn models_prev(state: &mut AppState) {
    state.connections.models.selected = state.connections.models.selected.saturating_sub(1);
}

pub fn models_next(state: &mut AppState) {
    let max = state.connections.models.models.len().saturating_sub(1);
    state.connections.models.selected = (state.connections.models.selected + 1).min(max);
}

pub fn request_models_refresh(state: &mut AppState) -> Vec<Outbound> {
    let Some(conn) = state.connections.models.connection_id.clone().filter(|s| !s.is_empty())
    else {
        state.connections.models.error = Some("Missing connectionId".to_string());
        return Vec::new();
    };
    state.connections.models.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/models/refresh".to_string(),
        params: Some(json!({ "connectionId": conn })),
    }]
}

pub fn handle_models_list_response(
    state: &mut AppState,
    result: &Option<Value>,
    error_message: Option<&str>,
) {
    state.connections.models.loading = false;
    if let Some(err) = error_message {
        state.connections.models.error = Some(err.to_string());
        return;
    }
    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        state.connections.models.error = Some("Invalid models response".to_string());
        return;
    };
    state.connections.models.provider_id = obj
        .get("providerId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    state.connections.models.connection_id = obj
        .get("connectionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    state.connections.models.error = None;

    let mut disabled_models: Vec<String> = Vec::new();
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
                    let disabled = model_disabled(o);
                    if disabled {
                        disabled_models.push(model_id.clone());
                    }
                    Some(ConnectionModelItem {
                        model_id,
                        name,
                        disabled,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    state.connections.models.models = models;
    state.connections.models.disabled_models = disabled_models;
    state.connections.models.selected = 0;
}

pub fn toggle_selected_model(state: &mut AppState) -> Vec<Outbound> {
    if !state.connections.models.open {
        return Vec::new();
    }
    let Some(connection_id) = state
        .connections
        .models
        .connection_id
        .clone()
        .filter(|s| !s.is_empty())
    else {
        state.connections.models.error = Some("Missing connectionId".to_string());
        return Vec::new();
    };
    let Some(connection_name) = state
        .connections
        .models
        .connection_name
        .clone()
        .filter(|s| !s.is_empty())
    else {
        state.connections.models.error = Some("Missing connection name".to_string());
        return Vec::new();
    };
    let Some(model) = state
        .connections
        .models
        .models
        .get(state.connections.models.selected)
        .cloned()
    else {
        return Vec::new();
    };

    // Update the local disabled_models list
    let mut disabled_models = state.connections.models.disabled_models.clone();
    if model.disabled {
        // Model is currently disabled, so enable it by removing from disabled list
        disabled_models.retain(|id| id != &model.model_id);
    } else {
        // Model is currently enabled, so disable it by adding to disabled list
        if !disabled_models.contains(&model.model_id) {
            disabled_models.push(model.model_id.clone());
        }
    }

    // Optimistically update local state
    if let Some(m) = state
        .connections
        .models
        .models
        .get_mut(state.connections.models.selected)
    {
        m.disabled = !m.disabled;
    }
    state.connections.models.disabled_models = disabled_models.clone();

    state.connections.models.loading = true;
    let id = state.next_client_id();

    // Use ent/connections/upsert with modelConfig to persist the change
    // This matches how the web UI handles model toggling
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/upsert".to_string(),
        params: Some(json!({
            "connection": {
                "connectionId": connection_id,
                "name": connection_name,
                "config": {
                    "modelConfig": {
                        "enableNewModels": true,
                        "disabledModels": disabled_models,
                        "disabledProviders": []
                    }
                }
            }
        })),
    }]
}

fn model_disabled(o: &serde_json::Map<String, Value>) -> bool {
    if o.get("disabled").and_then(|v| v.as_bool()) == Some(true) {
        return true;
    }

    o.get("disabledState")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s == "disabled")
}

pub fn start_rename(state: &mut AppState) {
    let Some(it) = selected_item(state) else { return };
    state.connections.renaming = true;
    state.connections.rename_input = it.name.clone();
}

pub fn rename_char(state: &mut AppState, ch: char) {
    if !state.connections.renaming {
        return;
    }
    state.connections.rename_input.push(ch);
}

pub fn rename_backspace(state: &mut AppState) {
    if !state.connections.renaming {
        return;
    }
    state.connections.rename_input.pop();
}

pub fn submit_rename(state: &mut AppState) -> Vec<Outbound> {
    if !state.connections.renaming {
        return Vec::new();
    }
    let Some(it) = selected_item(state) else { return Vec::new() };
    let name = state.connections.rename_input.trim().to_string();
    if name.is_empty() {
        state.connections.error = Some("Name cannot be empty".to_string());
        return Vec::new();
    }

    state.connections.renaming = false;
    state.connections.rename_input.clear();
    state.connections.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/upsert".to_string(),
        params: Some(json!({
            "connection": { "connectionId": it.connection_id, "name": name, "config": {} }
        })),
    }]
}

pub fn request_test_selected(state: &mut AppState) -> Vec<Outbound> {
    let Some(it) = selected_item(state) else { return Vec::new() };
    state.connections.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/test".to_string(),
        params: Some(json!({ "connectionId": it.connection_id })),
    }]
}

pub fn handle_test_response(state: &mut AppState, result: &Option<Value>, error_message: Option<&str>) {
    state.connections.loading = false;
    if let Some(it) = selected_item(state) {
        if let Some(err) = error_message {
            state.connections.last_test.insert(
                it.connection_id.clone(),
                TestResult { ok: false, error: Some(err.to_string()), latency_ms: None },
            );
            return;
        }
        let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
            return;
        };
        let ok = obj.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let error = obj.get("error").and_then(|v| v.as_str()).map(|s| s.to_string());
        let latency_ms = obj
            .get("latencyMs")
            .and_then(|v| v.as_number())
            .and_then(|n| n.as_u64());
        state.connections.last_test.insert(
            it.connection_id.clone(),
            TestResult { ok, error, latency_ms },
        );
    }
}

pub fn begin_delete_selected(state: &mut AppState) {
    if selected_item(state).is_none() {
        return;
    }
    state.connections.confirm_delete = true;
}

pub fn cancel_delete(state: &mut AppState) {
    state.connections.confirm_delete = false;
}

pub fn begin_clear_credentials(state: &mut AppState) {
    if selected_item(state).is_none() {
        return;
    }
    state.connections.confirm_clear_credentials = true;
}

pub fn cancel_clear_credentials(state: &mut AppState) {
    state.connections.confirm_clear_credentials = false;
}

pub fn confirm_delete_selected(state: &mut AppState) -> Vec<Outbound> {
    if !state.connections.confirm_delete {
        return Vec::new();
    }
    let Some(it) = selected_item(state) else { return Vec::new() };
    state.connections.confirm_delete = false;
    state.connections.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/delete".to_string(),
        params: Some(json!({ "connectionId": it.connection_id })),
    }]
}

pub fn confirm_clear_credentials(state: &mut AppState) -> Vec<Outbound> {
    if !state.connections.confirm_clear_credentials {
        return Vec::new();
    }
    let Some(it) = selected_item(state) else { return Vec::new() };
    state.connections.confirm_clear_credentials = false;
    state.connections.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/clear".to_string(),
        params: Some(json!({ "connectionId": it.connection_id })),
    }]
}

pub fn request_credentials_status(state: &mut AppState) -> Vec<Outbound> {
    let Some(it) = selected_item(state) else { return Vec::new() };
    state.connections.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/status".to_string(),
        params: Some(json!({ "connectionId": it.connection_id })),
    }]
}

pub fn handle_credentials_status_response(
    state: &mut AppState,
    result: &Option<Value>,
    error_message: Option<&str>,
) {
    state.connections.loading = false;
    let Some(it) = selected_item(state) else { return };
    if let Some(err) = error_message {
        state.connections.error = Some(err.to_string());
        return;
    }
    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        return;
    };
    let state_str = obj
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let account_label = obj
        .get("accountLabel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let expires_at = obj
        .get("expiresAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    state.connections.credential_status.insert(
        it.connection_id.clone(),
        CredentialStatus {
            state: state_str,
            account_label,
            expires_at,
        },
    );
}

pub fn handle_delete_response(state: &mut AppState, error_message: Option<&str>) -> Vec<Outbound> {
    state.connections.loading = false;
    if let Some(err) = error_message {
        state.connections.error = Some(err.to_string());
        return Vec::new();
    }
    state.connections.error = None;
    request_list(state)
}

pub fn handle_clear_credentials_response(
    state: &mut AppState,
    error_message: Option<&str>,
) -> Vec<Outbound> {
    state.connections.loading = false;
    if let Some(err) = error_message {
        state.connections.error = Some(err.to_string());
        return Vec::new();
    }
    state.connections.error = None;
    request_list(state)
}

pub fn handle_upsert_response(state: &mut AppState, error_message: Option<&str>) -> Vec<Outbound> {
    state.connections.loading = false;
    if let Some(err) = error_message {
        state.connections.error = Some(err.to_string());
        return Vec::new();
    }
    state.connections.error = None;
    request_list(state)
}

fn selected_item(state: &AppState) -> Option<ConnectionListItem> {
    state
        .connections
        .items
        .get(state.connections.selected)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::AppState;

    #[test]
    fn open_connections_requests_list() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 7;
        let out = open_connections(&mut state);
        assert!(state.connections.open);
        assert!(state.connections.loading);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { id, method, .. } => {
                assert_eq!(id, "c_7");
                assert_eq!(method, "ent/connections/list");
            }
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn handle_list_response_parses_items() {
        let mut state = AppState::new_with_paths(None, None);
        state.connections.open = true;
        state.connections.loading = true;
        handle_list_response(
            &mut state,
            &Some(json!({"connections":[
              {"connectionId":"c1","providerId":"p1","name":"n1","credentialState":"ready","endpoint":"https://x"},
              {"connectionId":"c2","providerId":"p2","name":"n2"}
            ]})),
            None,
        );
        assert!(!state.connections.loading);
        assert_eq!(state.connections.items.len(), 2);
        assert_eq!(state.connections.items[0].connection_id, "c1");
        assert_eq!(state.connections.items[0].endpoint.as_deref(), Some("https://x"));
        assert_eq!(state.connections.items[1].provider_id, "p2");
    }

    #[test]
    fn confirm_delete_sends_delete_request() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 3;
        state.connections.open = true;
        state.connections.items = vec![ConnectionListItem {
            connection_id: "c1".to_string(),
            provider_id: "p1".to_string(),
            name: "n1".to_string(),
            credential_state: None,
            endpoint: None,
        }];
        begin_delete_selected(&mut state);
        let out = confirm_delete_selected(&mut state);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { method, params, .. } => {
                assert_eq!(method, "ent/connections/delete");
                assert_eq!(
                    params.as_ref().and_then(|v| v.get("connectionId")).and_then(|v| v.as_str()),
                    Some("c1")
                );
            }
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn confirm_clear_credentials_sends_clear_request() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 3;
        state.connections.open = true;
        state.connections.items = vec![ConnectionListItem {
            connection_id: "c1".to_string(),
            provider_id: "p1".to_string(),
            name: "n1".to_string(),
            credential_state: None,
            endpoint: None,
        }];
        begin_clear_credentials(&mut state);
        let out = confirm_clear_credentials(&mut state);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { method, params, .. } => {
                assert_eq!(method, "ent/connections/credentials/clear");
                assert_eq!(
                    params.as_ref().and_then(|v| v.get("connectionId")).and_then(|v| v.as_str()),
                    Some("c1")
                );
            }
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn connection_models_list_parses_disabled_state() {
        let mut state = AppState::new_with_paths(None, None);
        state.connections.open = true;
        state.connections.models.open = true;
        handle_models_list_response(
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
        assert_eq!(state.connections.models.models.len(), 2);
        assert!(state.connections.models.models[0].disabled);
        assert!(!state.connections.models.models[1].disabled);

        // Also verify disabled_models list is populated
        assert_eq!(state.connections.models.disabled_models.len(), 1);
        assert!(state.connections.models.disabled_models.contains(&"m1".to_string()));
    }

    #[test]
    fn connection_models_toggle_sends_upsert_to_enable_disabled_model() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 9;
        state.connections.open = true;
        state.connections.models.open = true;
        state.connections.models.connection_id = Some("c1".to_string());
        state.connections.models.connection_name = Some("My Connection".to_string());
        state.connections.models.provider_id = Some("p1".to_string());
        state.connections.models.disabled_models = vec!["m1".to_string()];
        state.connections.models.models = vec![
            ConnectionModelItem {
                model_id: "m1".to_string(),
                name: "m1".to_string(),
                disabled: true,
            },
            ConnectionModelItem {
                model_id: "m2".to_string(),
                name: "m2".to_string(),
                disabled: false,
            },
        ];

        state.connections.models.selected = 0;
        let out = toggle_selected_model(&mut state);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { id, method, params } => {
                assert_eq!(id, "c_9");
                assert_eq!(method, "ent/connections/upsert");

                let conn = params.as_ref()
                    .and_then(|v| v.get("connection"))
                    .expect("should have connection");
                assert_eq!(
                    conn.get("connectionId").and_then(|v| v.as_str()),
                    Some("c1")
                );
                assert_eq!(
                    conn.get("name").and_then(|v| v.as_str()),
                    Some("My Connection")
                );

                let config = conn.get("config").expect("should have config");
                let model_config = config.get("modelConfig").expect("should have modelConfig");
                let disabled = model_config.get("disabledModels")
                    .and_then(|v| v.as_array())
                    .expect("should have disabledModels array");

                // Model m1 was disabled, toggling should enable it (remove from disabled list)
                assert!(!disabled.iter().any(|v| v.as_str() == Some("m1")));
            }
            _ => panic!("expected request"),
        }

        // Verify optimistic update applied
        assert!(!state.connections.models.models[0].disabled);
        assert!(state.connections.models.disabled_models.is_empty());
    }

    #[test]
    fn connection_models_toggle_sends_upsert_to_disable_enabled_model() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 5;
        state.connections.open = true;
        state.connections.models.open = true;
        state.connections.models.connection_id = Some("c1".to_string());
        state.connections.models.connection_name = Some("My Connection".to_string());
        state.connections.models.provider_id = Some("p1".to_string());
        state.connections.models.disabled_models = vec![];
        state.connections.models.models = vec![
            ConnectionModelItem {
                model_id: "m1".to_string(),
                name: "m1".to_string(),
                disabled: false,
            },
        ];

        state.connections.models.selected = 0;
        let out = toggle_selected_model(&mut state);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { method, params, .. } => {
                assert_eq!(method, "ent/connections/upsert");

                let conn = params.as_ref()
                    .and_then(|v| v.get("connection"))
                    .expect("should have connection");
                let config = conn.get("config").expect("should have config");
                let model_config = config.get("modelConfig").expect("should have modelConfig");
                let disabled = model_config.get("disabledModels")
                    .and_then(|v| v.as_array())
                    .expect("should have disabledModels array");

                // Model m1 was enabled, toggling should disable it (add to disabled list)
                assert!(disabled.iter().any(|v| v.as_str() == Some("m1")));
            }
            _ => panic!("expected request"),
        }

        // Verify optimistic update applied
        assert!(state.connections.models.models[0].disabled);
        assert!(state.connections.models.disabled_models.contains(&"m1".to_string()));
    }
}
