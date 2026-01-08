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
    pub last_test: std::collections::HashMap<String, TestResult>,
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
            last_test: std::collections::HashMap::new(),
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

    request_list(state)
}

pub fn close_connections(state: &mut AppState) {
    state.connections.open = false;
    state.connections.loading = false;
    state.connections.error = None;
    state.connections.renaming = false;
    state.connections.rename_input.clear();
    state.connections.confirm_delete = false;
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

pub fn handle_delete_response(state: &mut AppState, error_message: Option<&str>) -> Vec<Outbound> {
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
}
