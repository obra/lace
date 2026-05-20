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
    pub models: Vec<WizardModelItem>,
    pub connection_id: Option<String>,
    pub model_id: Option<String>,
    pub credential_fields: Vec<CredentialField>,
    pub credential_field_index: usize,
    pub credential_input: String,
    pub credential_values: std::collections::BTreeMap<String, String>,
    pub error_message: Option<String>,
    pub forced_connection_id: Option<String>,
    pub pending_connection_config: bool,
    pub pending_model_config: bool,
    /// Filter query for model selection
    pub model_filter: String,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WizardModelItem {
    pub model_id: String,
    pub name: String,
    pub disabled: bool,
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
            forced_connection_id: None,
            pending_connection_config: false,
            pending_model_config: false,
            model_filter: String::new(),
        }
    }
}

pub fn open(state: &mut AppState) -> Vec<Outbound> {
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
    state.config_wizard.forced_connection_id = None;
    state.config_wizard.pending_connection_config = false;
    state.config_wizard.pending_model_config = false;
    state.config_wizard.model_filter.clear();

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/list".to_string(),
        params: Some(json!({})),
    }]
}

pub fn open_for_connection(state: &mut AppState) -> Vec<Outbound> {
    let idx = state
        .connections
        .selected
        .min(state.connections.items.len().saturating_sub(1));
    let Some(it) = state.connections.items.get(idx) else {
        return Vec::new();
    };

    state.connections.open = false;
    state.connections.loading = false;
    state.connections.error = None;
    state.connections.renaming = false;
    state.connections.rename_input.clear();
    state.connections.confirm_delete = false;

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
    state.config_wizard.forced_connection_id = Some(it.connection_id.clone());
    state.config_wizard.pending_connection_config = false;
    state.config_wizard.pending_model_config = false;
    state.config_wizard.model_filter.clear();

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
    state.config_wizard.forced_connection_id = None;
    state.config_wizard.pending_connection_config = false;
    state.config_wizard.pending_model_config = false;
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
        ConfigWizardStep::SelectModel => {
            // Use filtered count when there's a filter query
            let query = state.config_wizard.model_filter.to_lowercase();
            if query.is_empty() {
                state.config_wizard.models.len().saturating_sub(1)
            } else {
                state
                    .config_wizard
                    .models
                    .iter()
                    .filter(|m| {
                        m.model_id.to_lowercase().contains(&query)
                            || m.name.to_lowercase().contains(&query)
                    })
                    .count()
                    .saturating_sub(1)
            }
        }
        _ => 0,
    };
    state.config_wizard.selected = (state.config_wizard.selected + 1).min(max);
}

pub fn input_char(state: &mut AppState, ch: char) {
    match state.config_wizard.step {
        ConfigWizardStep::EnterCredential => {
            state.config_wizard.credential_input.push(ch);
        }
        ConfigWizardStep::SelectModel => {
            state.config_wizard.model_filter.push(ch);
            state.config_wizard.selected = 0;
        }
        _ => {}
    }
}

pub fn backspace(state: &mut AppState) {
    match state.config_wizard.step {
        ConfigWizardStep::EnterCredential => {
            state.config_wizard.credential_input.pop();
        }
        ConfigWizardStep::SelectModel => {
            state.config_wizard.model_filter.pop();
            state.config_wizard.selected = 0;
        }
        _ => {}
    }
}

/// Returns models that match the current filter query (case-insensitive).
pub fn filtered_models(state: &AppState) -> Vec<&WizardModelItem> {
    let query = state.config_wizard.model_filter.to_lowercase();
    if query.is_empty() {
        state.config_wizard.models.iter().collect()
    } else {
        state
            .config_wizard
            .models
            .iter()
            .filter(|m| {
                m.model_id.to_lowercase().contains(&query) || m.name.to_lowercase().contains(&query)
            })
            .collect()
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
            state.config_wizard.pending_connection_config = false;
            state.config_wizard.pending_model_config = false;
            return Vec::new();
        }
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some(err.to_string());
        state.config_wizard.pending_connection_config = false;
        state.config_wizard.pending_model_config = false;
        return Vec::new();
    }

    match method {
        "ent/connections/list" => on_connections_list(state, result),
        "ent/providers/catalog" => on_providers_catalog(state, result),
        "ent/connections/upsert" => on_connections_upsert(state, result),
        "ent/connections/credentials/start" => on_credentials_start(state, result),
        "ent/connections/credentials/submit" => on_credentials_submit(state, result),
        "ent/models/list" => on_models_list(state, result),
        "ent/session/configure" => on_connection_configure(state, result),
        "session/set_config_option" => on_model_config_option(state, result),
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

    let has_existing = !connections.is_empty();
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

    if let Some(forced) = state.config_wizard.forced_connection_id.clone() {
        if let Some(pos) = state
            .config_wizard
            .connections
            .iter()
            .position(|c| c.connection_id == forced)
        {
            state.config_wizard.selected = pos;
            state.config_wizard.forced_connection_id = None;
            return submit_connection(state);
        }
        state.config_wizard.forced_connection_id = None;
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
            method: "ent/providers/catalog".to_string(),
            params: Some(json!({})),
        }];
    }

    if has_existing {
        state.config_wizard.connections.push(ConnectionItem {
            connection_id: "__new__".to_string(),
            name: Some("➕ Add connection".to_string()),
            credential_state: None,
        });
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
    if connection_id == "__new__" {
        state.config_wizard.step = ConfigWizardStep::LoadingProviders;
        let id = state.next_client_id();
        return vec![Outbound::JsonRpcRequest {
            id,
            method: "ent/providers/catalog".to_string(),
            params: Some(json!({})),
        }];
    }
    state.config_wizard.connection_id = Some(connection_id.clone());
    state.config_wizard.step = ConfigWizardStep::CheckingCredentials;

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/start".to_string(),
        params: Some(json!({ "connectionId": connection_id })),
    }]
}

fn on_providers_catalog(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let mut providers: Vec<ProviderItem> = Vec::new();
    if let Some(Value::Object(obj)) = result {
        if let Some(Value::Array(arr)) = obj.get("providers") {
            for p in arr {
                let Some(pobj) = p.as_object() else { continue };
                let Some(provider_id) = pobj.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                let display_name = pobj
                    .get("name")
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
    let Some(connection_id) = state
        .config_wizard
        .connection_id
        .clone()
        .filter(|c| !c.is_empty())
    else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("missing connection id".to_string());
        return Vec::new();
    };
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
    let Some(connection_id) = state.config_wizard.connection_id.clone() else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("missing connection id".to_string());
        return Vec::new();
    };
    let values = state.config_wizard.credential_values.clone();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/connections/credentials/submit".to_string(),
        params: Some(json!({ "connectionId": connection_id, "values": values })),
    }]
}

fn on_credentials_submit(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let Some(connection_id) = state.config_wizard.connection_id.clone() else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("missing connection id".to_string());
        return Vec::new();
    };
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
    let list_id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id: list_id,
        method: "ent/models/list".to_string(),
        params: Some(json!({ "connectionId": connection_id })),
    }]
}

fn on_models_list(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    let mut models: Vec<WizardModelItem> = Vec::new();
    if let Some(Value::Object(obj)) = result {
        if let Some(Value::Array(arr)) = obj.get("models") {
            for m in arr {
                let Some(mobj) = m.as_object() else { continue };
                if let Some(model_id) = mobj.get("modelId").and_then(|v| v.as_str()) {
                    let disabled = model_disabled(mobj);
                    if disabled {
                        continue;
                    }
                    let name = mobj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(model_id)
                        .to_string();
                    models.push(WizardModelItem {
                        model_id: model_id.to_string(),
                        name,
                        disabled,
                    });
                }
            }
        }
    }
    state.config_wizard.models = models;
    state.config_wizard.selected = 0;
    if let Some(last) = &state.prefs.last_model_id {
        if let Some(pos) = state
            .config_wizard
            .models
            .iter()
            .position(|m| &m.model_id == last)
        {
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
    // Get filtered models list
    let filtered: Vec<_> = filtered_models(state);
    let idx = state
        .config_wizard
        .selected
        .min(filtered.len().saturating_sub(1));
    let Some(model) = filtered.get(idx) else {
        return Vec::new();
    };
    let model_id = model.model_id.clone();
    state.config_wizard.model_id = Some(model_id.clone());
    state.config_wizard.step = ConfigWizardStep::Applying;

    let Some(session_id) = state.session_id.clone() else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("missing session id".to_string());
        return Vec::new();
    };
    let Some(connection_id) = state
        .config_wizard
        .connection_id
        .clone()
        .filter(|c| !c.is_empty())
    else {
        state.config_wizard.step = ConfigWizardStep::Error;
        state.config_wizard.error_message = Some("missing connection id".to_string());
        return Vec::new();
    };
    state.config_wizard.pending_connection_config = true;
    state.config_wizard.pending_model_config = true;
    let configure_id = state.next_client_id();
    let model_config_id = state.next_client_id();
    vec![
        Outbound::JsonRpcRequest {
            id: configure_id,
            method: "ent/session/configure".to_string(),
            params: Some(json!({ "connectionId": connection_id })),
        },
        Outbound::JsonRpcRequest {
            id: model_config_id,
            method: "session/set_config_option".to_string(),
            params: Some(json!({
                "sessionId": session_id,
                "configId": "model",
                "value": model_id,
            })),
        },
    ]
}

fn model_disabled(o: &serde_json::Map<String, Value>) -> bool {
    if o.get("disabled").and_then(|v| v.as_bool()) == Some(true) {
        return true;
    }

    o.get("disabledState")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s == "disabled")
}

fn on_connection_configure(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    if state.config_wizard.step != ConfigWizardStep::Applying
        || !state.config_wizard.pending_connection_config
    {
        return Vec::new();
    }

    let connection_id = crate::protocol::ent::extract_session_configure_connection(result)
        .or_else(|| state.config_wizard.connection_id.clone());
    state.connection_id = connection_id.clone();
    state.config_wizard.connection_id = connection_id;
    state.config_wizard.pending_connection_config = false;

    finish_session_configure_if_ready(state)
}

fn on_model_config_option(state: &mut AppState, result: &Option<Value>) -> Vec<Outbound> {
    if state.config_wizard.step != ConfigWizardStep::Applying
        || !state.config_wizard.pending_model_config
    {
        return Vec::new();
    }

    let model_id = crate::protocol::ent::extract_session_config_option_model(result)
        .or_else(|| state.config_wizard.model_id.clone());
    state.config_wizard.model_id = model_id;
    state.config_wizard.pending_model_config = false;

    finish_session_configure_if_ready(state)
}

fn finish_session_configure_if_ready(state: &mut AppState) -> Vec<Outbound> {
    if state.config_wizard.pending_connection_config || state.config_wizard.pending_model_config {
        return Vec::new();
    }

    state.connection_id = state.config_wizard.connection_id.clone();
    state.model_id = state.config_wizard.model_id.clone();
    state.config_wizard.step = ConfigWizardStep::Done;
    state.prefs.last_connection_id = state.connection_id.clone();
    state.prefs.last_model_id = state.model_id.clone();
    let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);

    let mut out = Vec::new();
    out.extend(crate::app::connections::request_models_for_current_connection(state));
    state.models_prefetched = true;
    out
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
            Outbound::JsonRpcRequest { method, .. } => assert_eq!(method, "ent/providers/catalog"),
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
        state.config_wizard.pending_connection_config = true;

        let out = handle_response(
            &mut state,
            "ent/session/configure",
            &Some(json!({"ok":true,"config":{"connectionId":"c1"}})),
            None,
        );

        // After configuration, models are prefetched for autocomplete
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { method, params, .. } => {
                assert_eq!(method, "ent/models/list");
                let p = params.as_ref().unwrap();
                assert_eq!(p.get("connectionId").and_then(|v| v.as_str()), Some("c1"));
            }
            _ => panic!("expected models list request"),
        }
        assert_eq!(state.prefs.last_connection_id, Some("c1".to_string()));
        assert_eq!(state.prefs.last_model_id, Some("m1".to_string()));
    }

    #[test]
    fn waits_for_model_config_option_before_completing() {
        let mut state = AppState::new_with_paths(None, None);
        state.session_id = Some("sess_1".to_string());
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingModels;
        state.config_wizard.connection_id = Some("c1".to_string());

        let requests = handle_response(
            &mut state,
            "ent/models/list",
            &Some(json!({"models":[{"modelId":"m1","disabledState":"enabled"}]})),
            None,
        );
        assert_eq!(requests.len(), 2);
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Applying);
        assert_eq!(state.config_wizard.model_id, Some("m1".to_string()));

        let out = handle_response(
            &mut state,
            "ent/session/configure",
            &Some(json!({"ok":true,"config":{"connectionId":"c1"}})),
            None,
        );

        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Applying);
        assert_eq!(state.prefs.last_model_id, None);

        let out = handle_response(
            &mut state,
            "session/set_config_option",
            &Some(json!({"configOptions":[
                {
                    "id":"model",
                    "name":"Model",
                    "category":"model",
                    "type":"select",
                    "currentValue":"m1",
                    "options":[{"value":"m1","name":"m1"}]
                }
            ]})),
            None,
        );

        assert_eq!(state.config_wizard.step, ConfigWizardStep::Done);
        assert_eq!(state.prefs.last_connection_id, Some("c1".to_string()));
        assert_eq!(state.prefs.last_model_id, Some("m1".to_string()));
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn waits_for_connection_configure_before_completing() {
        let mut state = AppState::new_with_paths(None, None);
        state.session_id = Some("sess_1".to_string());
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingModels;
        state.config_wizard.connection_id = Some("c1".to_string());

        let requests = handle_response(
            &mut state,
            "ent/models/list",
            &Some(json!({"models":[{"modelId":"m1","disabledState":"enabled"}]})),
            None,
        );
        assert_eq!(requests.len(), 2);
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Applying);

        let out = handle_response(
            &mut state,
            "session/set_config_option",
            &Some(json!({"configOptions":[
                {
                    "id":"model",
                    "name":"Model",
                    "category":"model",
                    "type":"select",
                    "currentValue":"m1",
                    "options":[{"value":"m1","name":"m1"}]
                }
            ]})),
            None,
        );

        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Applying);
        assert_eq!(state.prefs.last_model_id, None);

        let out = handle_response(
            &mut state,
            "ent/session/configure",
            &Some(json!({"ok":true,"config":{"connectionId":"c1"}})),
            None,
        );

        assert_eq!(state.config_wizard.step, ConfigWizardStep::Done);
        assert_eq!(state.prefs.last_connection_id, Some("c1".to_string()));
        assert_eq!(state.prefs.last_model_id, Some("m1".to_string()));
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn model_config_error_is_not_overwritten_by_late_connection_configure() {
        let mut state = AppState::new_with_paths(None, None);
        state.session_id = Some("sess_1".to_string());
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingModels;
        state.config_wizard.connection_id = Some("c1".to_string());

        let requests = handle_response(
            &mut state,
            "ent/models/list",
            &Some(json!({"models":[{"modelId":"m1","disabledState":"enabled"}]})),
            None,
        );
        assert_eq!(requests.len(), 2);
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Applying);

        let out = handle_response(
            &mut state,
            "session/set_config_option",
            &None,
            Some("model rejected"),
        );

        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Error);
        assert_eq!(
            state.config_wizard.error_message,
            Some("model rejected".to_string())
        );

        let out = handle_response(
            &mut state,
            "ent/session/configure",
            &Some(json!({"ok":true,"config":{"connectionId":"c1"}})),
            None,
        );

        assert!(out.is_empty());
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Error);
        assert_eq!(state.prefs.last_connection_id, None);
        assert_eq!(state.prefs.last_model_id, None);
    }

    #[test]
    fn models_list_filters_disabled_state_models() {
        let mut state = AppState::new_with_paths(None, None);
        state.session_id = Some("sess_1".to_string());
        state.config_wizard.open = true;
        state.config_wizard.step = ConfigWizardStep::LoadingModels;
        state.config_wizard.connection_id = Some("c1".to_string());

        let out = handle_response(
            &mut state,
            "ent/models/list",
            &Some(json!({"models":[
              {"modelId":"m1","disabledState":"disabled"},
              {"modelId":"m2","disabledState":"enabled"}
            ]})),
            None,
        );

        assert_eq!(state.config_wizard.models.len(), 1);
        assert_eq!(state.config_wizard.models[0].model_id, "m2");
        assert_eq!(state.config_wizard.step, ConfigWizardStep::Applying);

        assert_eq!(out.len(), 2);
        match &out[0] {
            Outbound::JsonRpcRequest { method, params, .. } => {
                assert_eq!(method, "ent/session/configure");
                let Some(p) = params.as_ref().and_then(|v| v.as_object()) else {
                    panic!("expected object params");
                };
                assert_eq!(p.get("connectionId").and_then(|v| v.as_str()), Some("c1"));
                assert!(p.get("modelId").is_none());
            }
            _ => panic!("expected request"),
        }
        match &out[1] {
            Outbound::JsonRpcRequest { method, params, .. } => {
                assert_eq!(method, "session/set_config_option");
                let Some(p) = params.as_ref().and_then(|v| v.as_object()) else {
                    panic!("expected object params");
                };
                assert_eq!(p.get("configId").and_then(|v| v.as_str()), Some("model"));
                assert_eq!(p.get("value").and_then(|v| v.as_str()), Some("m2"));
            }
            _ => panic!("expected request"),
        }
    }
}
