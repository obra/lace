use crate::app::reducer::Outbound;
use crate::app::AppState;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigWizardState {
    pub open: bool,
    pub step: ConfigWizardStep,
    pub selected: usize,
    pub connections: Vec<ConnectionItem>,
    pub providers: Vec<ProviderItem>,
    pub models: Vec<String>,
    pub connection_id: Option<String>,
    pub model_id: Option<String>,
    pub credential_fields: Vec<CredentialField>,
    pub credential_field_index: usize,
    pub credential_input: String,
    pub credential_values: std::collections::BTreeMap<String, String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigWizardStep {
    Closed,
    LoadingConnections,
    SelectConnection,
    LoadingProviders,
    SelectProvider,
    UpsertingConnection,
    CheckingCredentials,
    EnterCredential,
    SubmittingCredentials,
    LoadingModels,
    SelectModel,
    Applying,
    Done,
    NotSupported,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionItem {
    pub connection_id: String,
    pub name: Option<String>,
    pub credential_state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderItem {
    pub provider_id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialField {
    pub name: String,
    pub label: Option<String>,
    pub secret: bool,
}

impl ConfigWizardState {
    pub fn new() -> Self {
        Self {
            open: false,
            step: ConfigWizardStep::Closed,
            selected: 0,
            connections: Vec::new(),
            providers: Vec::new(),
            models: Vec::new(),
            connection_id: None,
            model_id: None,
            credential_fields: Vec::new(),
            credential_field_index: 0,
            credential_input: String::new(),
            credential_values: std::collections::BTreeMap::new(),
            error_message: None,
        }
    }
}

pub fn open(state: &mut AppState) -> Vec<Outbound> {
    state.palette_open = false;
    state.help_open = false;
    state.config_wizard.open = true;
    state.config_wizard.step = ConfigWizardStep::LoadingConnections;
    state.config_wizard.selected = 0;
    state.config_wizard.connections.clear();
    state.config_wizard.providers.clear();
    state.config_wizard.models.clear();
    state.config_wizard.connection_id = None;
    state.config_wizard.model_id = None;
    state.config_wizard.credential_fields.clear();
    state.config_wizard.credential_field_index = 0;
    state.config_wizard.credential_input.clear();
    state.config_wizard.credential_values.clear();
    state.config_wizard.error_message = None;

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/list".to_string(),
        params: Some(json!({})),
    }]
}

pub fn close(state: &mut AppState) {
    state.config_wizard.open = false;
    state.config_wizard.step = ConfigWizardStep::Closed;
    state.config_wizard.error_message = None;
    state.config_wizard.credential_input.clear();
}

pub fn prev(state: &mut AppState) {
    state.config_wizard.selected = state.config_wizard.selected.saturating_sub(1);
}

pub fn next(state: &mut AppState) {
    let max = match state.config_wizard.step {
        ConfigWizardStep::SelectConnection => {
            state.config_wizard.connections.len().saturating_sub(1)
        }
        ConfigWizardStep::SelectProvider => state.config_wizard.providers.len().saturating_sub(1),
        ConfigWizardStep::SelectModel => state.config_wizard.models.len().saturating_sub(1),
        _ => 0,
    };
    state.config_wizard.selected = (state.config_wizard.selected + 1).min(max);
}

pub fn input_char(state: &mut AppState, ch: char) {
    if state.config_wizard.step == ConfigWizardStep::EnterCredential {
        state.config_wizard.credential_input.push(ch);
    }
}

pub fn backspace(state: &mut AppState) {
    if state.config_wizard.step == ConfigWizardStep::EnterCredential {
        state.config_wizard.credential_input.pop();
    }
}

pub fn submit(state: &mut AppState) -> Vec<Outbound> {
    match state.config_wizard.step {
        ConfigWizardStep::SelectConnection => submit_connection(state),
        ConfigWizardStep::SelectProvider => submit_provider(state),
        ConfigWizardStep::SelectModel => submit_model(state),
        ConfigWizardStep::EnterCredential => submit_credential_value(state),
        ConfigWizardStep::Done | ConfigWizardStep::NotSupported | ConfigWizardStep::Error => {
            close(state);
            Vec::new()
        }
        _ => Vec::new(),
    }
}

pub fn handle_response(
    state: &mut AppState,
    method: &str,
    result: &Option<Value>,
    error_message: Option<&str>,
) -> Vec<Outbound> {
    if let Some(err) = error_message {
        if is_method_not_found(err) {
            state.config_wizard.step = ConfigWizardStep::NotSupported;
            state.config_wizard.error_message =
                Some("configuration not supported by this agent".to_string());
            return Vec::new();
        }
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some(err.to_string());
        return Vec::new();
    }

    match method {
        "ent/connections/list" => on_connections_list(state, result),
        "ent/providers/list" => on_providers_list(state, result),
        "ent/connections/upsert" => on_connections_upsert(state, result),
        "ent/connections/credentials/start" => on_credentials_start(state, result),
        "ent/connections/credentials/submit" => on_credentials_submit(state, result),
        "ent/models/list" => on_models_list(state, result),
        "ent/session/configure" => on_session_configure(state, result),
        _ => Vec::new(),
    }
}

fn on_connections_list(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let mut connections: Vec<ConnectionItem> = Vec::new();
    if let Some(Value::Object(obj)) = result {
        if let Some(Value::Array(arr)) = obj.get("connections") {
            for c in arr {
                let Some(cobj) = c.as_object() else { continue };
                let Some(connection_id) = cobj.get("connectionId").and_then(|v| v.as_str()) else {
                    continue;
                };
                let name = cobj
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let credential_state = cobj
                    .get("credentialState")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                connections.push(ConnectionItem {
                    connection_id: connection_id.to_string(),
                    name,
                    credential_state,
                });
            }
        }
    }

    state.config_wizard.connections = connections;
    if let Some(last) = &state.prefs.last_connection_id {
        if let Some(pos) = state
            .config_wizard
            .connections
            .iter()
            .position(|c| &c.connection_id == last)
        {
            state.config_wizard.selected = pos;
        }
    }

    let ready: Vec<&ConnectionItem> = state
        .config_wizard
        .connections
        .iter()
        .filter(|c| c.credential_state.as_deref() == Some("ready"))
        .collect();

    if ready.len() == 1 {
        state.config_wizard.selected = state
            .config_wizard
            .connections
            .iter()
            .position(|c| c.connection_id == ready[0].connection_id)
            .unwrap_or(0);
        return submit_connection(state);
    }

    if state.config_wizard.connections.len() == 1 {
        state.config_wizard.selected = 0;
        return submit_connection(state);
    }

    if state.config_wizard.connections.is_empty() {
        state.config_wizard.step = ConfigWizardStep::LoadingProviders;
        let id = state.next_client_id();
        return vec![Outbound::JsonRpcRequest {
            id,
            method: "ent/providers/list".to_string(),
            params: Some(json!({})),
        }];
    }

    state.config_wizard.step = ConfigWizardStep::SelectConnection;
    Vec::new()
}

fn submit_connection(state: &mut AppState) -> Vec<Outbound> {
    let idx = state
        .config_wizard
        .selected
        .min(state.config_wizard.connections.len().saturating_sub(1));
    let Some(conn) = state.config_wizard.connections.get(idx) else {
        return Vec::new();
    };
    let connection_id = conn.connection_id.clone();
    state.config_wizard.connection_id = Some(connection_id.clone());
    state.config_wizard.step = ConfigWizardStep::CheckingCredentials;

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/start".to_string(),
        params: Some(json!({ "connectionId": connection_id })),
    }]
}

fn on_providers_list(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let mut providers: Vec<ProviderItem> = Vec::new();
    if let Some(Value::Object(obj)) = result {
        if let Some(Value::Array(arr)) = obj.get("providers") {
            for p in arr {
                let Some(pobj) = p.as_object() else { continue };
                let Some(provider_id) = pobj.get("providerId").and_then(|v| v.as_str()) else {
                    continue;
                };
                let display_name = pobj
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                providers.push(ProviderItem {
                    provider_id: provider_id.to_string(),
                    display_name,
                });
            }
        }
    }

    state.config_wizard.providers = providers;
    state.config_wizard.selected = 0;

    if state.config_wizard.providers.len() == 1 {
        return submit_provider(state);
    }

    if state.config_wizard.providers.is_empty() {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("no providers available".to_string());
        return Vec::new();
    }

    state.config_wizard.step = ConfigWizardStep::SelectProvider;
    Vec::new()
}

fn submit_provider(state: &mut AppState) -> Vec<Outbound> {
    let idx = state
        .config_wizard
        .selected
        .min(state.config_wizard.providers.len().saturating_sub(1));
    let Some(p) = state.config_wizard.providers.get(idx) else {
        return Vec::new();
    };
    let provider_id = p.provider_id.clone();
    state.config_wizard.step = ConfigWizardStep::UpsertingConnection;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/upsert".to_string(),
        params: Some(
            json!({ "providerId": provider_id, "connection": { "name": "default", "config": {} } }),
        ),
    }]
}

fn on_connections_upsert(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let Some(Value::Object(obj)) = result else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("failed to create connection".to_string());
        return Vec::new();
    };
    let Some(connection_id) = obj.get("connectionId").and_then(|v| v.as_str()) else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("failed to create connection".to_string());
        return Vec::new();
    };
    state.config_wizard.connection_id = Some(connection_id.to_string());
    state.config_wizard.step = ConfigWizardStep::CheckingCredentials;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/start".to_string(),
        params: Some(json!({ "connectionId": connection_id })),
    }]
}

fn on_credentials_start(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let connection_id = state
        .config_wizard
        .connection_id
        .clone()
        .unwrap_or_default();
    let Some(Value::Object(obj)) = result else {
        return request_models_list(state, connection_id);
    };
    let kind = obj.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    if kind != "needs_input" {
        return request_models_list(state, connection_id);
    }
    let Some(Value::Array(fields)) = obj.get("fields") else {
        return request_models_list(state, connection_id);
    };

    state.config_wizard.credential_fields = fields
        .iter()
        .filter_map(|f| {
            let fobj = f.as_object()?;
            let name = fobj.get("name")?.as_str()?.to_string();
            let label = fobj
                .get("label")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let secret = fobj
                .get("secret")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Some(CredentialField {
                name,
                label,
                secret,
            })
        })
        .collect();

    state.config_wizard.credential_field_index = 0;
    state.config_wizard.credential_input.clear();
    state.config_wizard.credential_values.clear();
    state.config_wizard.step = ConfigWizardStep::EnterCredential;

    try_autofill_current_credential_field(state);
    maybe_submit_credentials_if_ready(state)
}

fn submit_credential_value(state: &mut AppState) -> Vec<Outbound> {
    let idx = state.config_wizard.credential_field_index;
    let Some(field) = state.config_wizard.credential_fields.get(idx) else {
        return Vec::new();
    };
    let value = state.config_wizard.credential_input.trim_end().to_string();
    if value.is_empty() {
        return Vec::new();
    }
    state
        .config_wizard
        .credential_values
        .insert(field.name.clone(), value);
    state.config_wizard.credential_input.clear();
    state.config_wizard.credential_field_index += 1;

    try_autofill_current_credential_field(state);
    maybe_submit_credentials_if_ready(state)
}

fn try_autofill_current_credential_field(state: &mut AppState) {
    let idx = state.config_wizard.credential_field_index;
    let Some(field) = state.config_wizard.credential_fields.get(idx) else {
        return;
    };
    if !field.secret {
        return;
    }
    let env_name = field.name.to_uppercase();
    let candidate = std::env::var("OPENAI_API_KEY")
        .ok()
        .or_else(|| std::env::var(env_name).ok());

    if let Some(value) = candidate {
        state
            .config_wizard
            .credential_values
            .insert(field.name.clone(), value);
        state.config_wizard.credential_field_index += 1;
    }
}

fn maybe_submit_credentials_if_ready(state: &mut AppState) -> Vec<Outbound> {
    if state.config_wizard.step != ConfigWizardStep::EnterCredential {
        return Vec::new();
    }
    if state.config_wizard.credential_fields.is_empty() {
        return Vec::new();
    }
    if state.config_wizard.credential_field_index < state.config_wizard.credential_fields.len() {
        return Vec::new();
    }

    state.config_wizard.step = ConfigWizardStep::SubmittingCredentials;
    let id = state.next_client_id();
    let connection_id = state
        .config_wizard
        .connection_id
        .clone()
        .unwrap_or_default();
    let values = state.config_wizard.credential_values.clone();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/submit".to_string(),
        params: Some(json!({ "connectionId": connection_id, "values": values })),
    }]
}

fn on_credentials_submit(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let connection_id = state
        .config_wizard
        .connection_id
        .clone()
        .unwrap_or_default();
    if let Some(Value::Object(obj)) = result {
        if obj.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            return request_models_list(state, connection_id);
        }
    }
    state.config_wizard.step = ConfigWizardStep::Error;
    state.config_wizard.error_message = Some("credential submit failed".to_string());
    Vec::new()
}

fn request_models_list(state: &mut AppState, connection_id: String) -> Vec<Outbound> {
    state.config_wizard.step = ConfigWizardStep::LoadingModels;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/models/list".to_string(),
        params: Some(json!({ "connectionId": connection_id })),
    }]
}

fn on_models_list(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let mut models: Vec<String> = Vec::new();
    if let Some(Value::Object(obj)) = result {
        if let Some(Value::Array(arr)) = obj.get("models") {
            for m in arr {
                let Some(mobj) = m.as_object() else { continue };
                if let Some(model_id) = mobj.get("modelId").and_then(|v| v.as_str()) {
                    models.push(model_id.to_string());
                }
            }
        }
    }
    state.config_wizard.models = models;
    state.config_wizard.selected = 0;
    if let Some(last) = &state.prefs.last_model_id {
        if let Some(pos) = state.config_wizard.models.iter().position(|m| m == last) {
            state.config_wizard.selected = pos;
        }
    }

    if state.config_wizard.models.len() == 1 {
        return submit_model(state);
    }

    if state.config_wizard.models.is_empty() {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("no models available for connection".to_string());
        return Vec::new();
    }

    state.config_wizard.step = ConfigWizardStep::SelectModel;
    Vec::new()
}

fn submit_model(state: &mut AppState) -> Vec<Outbound> {
    let idx = state
        .config_wizard
        .selected
        .min(state.config_wizard.models.len().saturating_sub(1));
    let Some(model_id) = state.config_wizard.models.get(idx) else {
        return Vec::new();
    };
    let model_id = model_id.clone();
    state.config_wizard.model_id = Some(model_id.clone());
    state.config_wizard.step = ConfigWizardStep::Applying;

    let connection_id = state
        .config_wizard
        .connection_id
        .clone()
        .unwrap_or_default();
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/session/configure".to_string(),
        params: Some(json!({ "connectionId": connection_id, "modelId": model_id })),
    }]
}

fn on_session_configure(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let mut connection_id = state.config_wizard.connection_id.clone();
    let mut model_id = state.config_wizard.model_id.clone();
    if let Some(Value::Object(obj)) = result {
        if let Some(Value::Object(cfg)) = obj.get("config") {
            if let Some(cid) = cfg.get("connectionId").and_then(|v| v.as_str()) {
                connection_id = Some(cid.to_string());
            }
            if let Some(mid) = cfg.get("modelId").and_then(|v| v.as_str()) {
                model_id = Some(mid.to_string());
            }
        }
    }
    state.connection_id = connection_id.clone();
    state.model_id = model_id.clone();
    state.config_wizard.connection_id = connection_id;
    state.config_wizard.model_id = model_id;
    state.config_wizard.step = ConfigWizardStep::Done;
    state.prefs.last_connection_id = state.connection_id.clone();
    state.prefs.last_model_id = state.model_id.clone();
    let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);
    Vec::new()
}

fn is_method_not_found(message: &str) -> bool {
    message.to_lowercase().contains("method not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::AppState;
    use serde_json::json;

    #[test]
    fn open_sends_connections_list_request() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 10;
        let out = open(&mut state);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { id, method, .. } => {
                assert_eq!(id, "c_10");
                assert_eq!(method, "ent/connections/list");
            }
            _ => panic!("expected request"),
        }
        assert!(state.config_wizard.open);
        assert_eq!(
            state.config_wizard.step,
            ConfigWizardStep::LoadingConnections
        );
    }

    #[test]
    fn method_not_found_sets_not_supported() {
        let mut state = AppState::new_with_paths(None, None);
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingConnections;

        let out = handle_response(
            &mut state,
            "ent/connections/list",
            &None,
            Some("Method not found"),
        );
        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::NotSupported);
    }

    #[test]
    fn empty_connections_requests_providers_list() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 3;
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingConnections;

        let out = handle_response(
            &mut state,
            "ent/connections/list",
            &Some(json!({"connections":[] })),
            None,
        );
        assert_eq!(state.config_wizard.step, ConfigWizardStep::LoadingProviders);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { method, .. } => assert_eq!(method, "ent/providers/list"),
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn connections_list_prefers_last_connection_id() {
        let mut state = AppState::new_with_paths(None, None);
        state.prefs.last_connection_id = Some("c2".to_string());
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingConnections;

        let out = handle_response(
            &mut state,
            "ent/connections/list",
            &Some(json!({"connections":[
              {"connectionId":"c1","credentialState":"not_ready"},
              {"connectionId":"c2","credentialState":"not_ready"}
            ]})),
            None,
        );

        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::SelectConnection);
        assert_eq!(state.config_wizard.selected, 1);
    }

    #[test]
    fn models_list_prefers_last_model_id() {
        let mut state = AppState::new_with_paths(None, None);
        state.prefs.last_model_id = Some("m2".to_string());
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingModels;

        let out = handle_response(
            &mut state,
            "ent/models/list",
            &Some(json!({"models":[{"modelId":"m1"},{"modelId":"m2"}]})),
            None,
        );

        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::SelectModel);
        assert_eq!(state.config_wizard.selected, 1);
    }

    #[test]
    fn session_configure_updates_last_used_prefs() {
        let mut state = AppState::new_with_paths(None, None);
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::Applying;
        state.config_wizard.connection_id = Some("c1".to_string());
        state.config_wizard.model_id = Some("m1".to_string());

        let out = handle_response(
            &mut state,
            "ent/session/configure",
            &Some(json!({"ok":true,"config":{"connectionId":"c1","modelId":"m1"}})),
            None,
        );

        assert!(out.is_empty());
        assert_eq!(state.prefs.last_connection_id, Some("c1".to_string()));
        assert_eq!(state.prefs.last_model_id, Some("m1".to_string()));
    }
}
