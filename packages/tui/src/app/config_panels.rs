use crate::app::reducer::Outbound;
use crate::app::AppState;
use serde_json::json;
use std::collections::HashMap;

/// Represents an MCP server configuration
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    pub server_id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
    pub status: McpServerStatus,
    pub tool_count: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum McpServerStatus {
    #[default]
    Unknown,
    Connecting,
    Connected,
    Disconnected,
    Error,
}

impl McpServerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            McpServerStatus::Unknown => "?",
            McpServerStatus::Connecting => "...",
            McpServerStatus::Connected => "✓",
            McpServerStatus::Disconnected => "○",
            McpServerStatus::Error => "✗",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpPanelView {
    List,
    AddEdit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpPanelState {
    pub open: bool,
    pub view: McpPanelView,
    pub servers: Vec<McpServer>,
    pub selected: usize,
    /// For add/edit form
    pub edit_server_id: Option<String>,
    pub form_id: String,
    pub form_name: String,
    pub form_command: String,
    pub form_args: String,
    pub form_env: String,
    pub form_enabled: bool,
    pub form_field: usize, // 0=id, 1=name, 2=command, 3=args, 4=env, 5=enabled
    pub form_error: Option<String>,
    pub loading: bool,
}

impl Default for McpPanelState {
    fn default() -> Self {
        Self {
            open: false,
            view: McpPanelView::List,
            servers: Vec::new(),
            selected: 0,
            edit_server_id: None,
            form_id: String::new(),
            form_name: String::new(),
            form_command: String::new(),
            form_args: String::new(),
            form_env: String::new(),
            form_enabled: true,
            form_field: 0,
            form_error: None,
            loading: false,
        }
    }
}

// === Context Viewer State ===

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextItem {
    pub name: String,
    pub tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextCategory {
    pub tokens: u64,
    pub items: Vec<ContextItem>,
}

impl Default for ContextCategory {
    fn default() -> Self {
        Self {
            tokens: 0,
            items: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMessageSubcategories {
    pub user_messages: u64,
    pub agent_messages: u64,
    pub tool_calls: u64,
    pub tool_results: u64,
}

impl Default for ContextMessageSubcategories {
    fn default() -> Self {
        Self {
            user_messages: 0,
            agent_messages: 0,
            tool_calls: 0,
            tool_results: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ContextBreakdown {
    pub model_id: String,
    pub context_limit: u64,
    pub total_used_tokens: u64,
    /// Percent used as integer (0-100)
    pub percent_used: u32,
    pub system_prompt: ContextCategory,
    pub core_tools: ContextCategory,
    pub mcp_tools: ContextCategory,
    pub messages: ContextCategory,
    pub message_subcategories: ContextMessageSubcategories,
    pub reserved_for_response: ContextCategory,
    pub free_space: ContextCategory,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ContextViewerState {
    pub open: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub breakdown: Option<ContextBreakdown>,
    pub scroll: usize,
}

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

// === MCP Panel Functions ===

pub fn mcp_open(state: &mut AppState) -> Vec<Outbound> {
    state.mcp_panel.open = true;
    state.mcp_panel.view = McpPanelView::List;
    state.mcp_panel.selected = 0;
    state.mcp_panel.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/mcp/servers/list".to_string(),
        params: Some(json!({})),
    }]
}

pub fn mcp_close(state: &mut AppState) {
    state.mcp_panel.open = false;
    state.mcp_panel.view = McpPanelView::List;
    state.mcp_panel.form_error = None;
}

pub fn mcp_handle_list_response(state: &mut AppState, result: &Option<serde_json::Value>) {
    state.mcp_panel.loading = false;

    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        return;
    };
    let Some(servers) = obj.get("servers").and_then(|v| v.as_array()) else {
        return;
    };

    state.mcp_panel.servers = servers
        .iter()
        .filter_map(|s| parse_mcp_server(s))
        .collect();
}

fn parse_mcp_server(value: &serde_json::Value) -> Option<McpServer> {
    let obj = value.as_object()?;
    let server_id = obj.get("serverId")?.as_str()?.to_string();
    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&server_id)
        .to_string();
    let command = obj.get("command").and_then(|v| v.as_str())?.to_string();
    let args = obj
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let env = obj
        .get("env")
        .and_then(|v| v.as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);

    let status = obj
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| match s {
            "connecting" => McpServerStatus::Connecting,
            "connected" => McpServerStatus::Connected,
            "disconnected" => McpServerStatus::Disconnected,
            "error" => McpServerStatus::Error,
            _ => McpServerStatus::Unknown,
        })
        .unwrap_or(McpServerStatus::Unknown);

    let tool_count = obj
        .get("toolCount")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let error = obj
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(McpServer {
        server_id,
        name,
        command,
        args,
        env,
        enabled,
        status,
        tool_count,
        error,
    })
}

pub fn mcp_next(state: &mut AppState) {
    let max = state.mcp_panel.servers.len().saturating_sub(1);
    state.mcp_panel.selected = (state.mcp_panel.selected + 1).min(max);
}

pub fn mcp_prev(state: &mut AppState) {
    state.mcp_panel.selected = state.mcp_panel.selected.saturating_sub(1);
}

pub fn mcp_open_add_form(state: &mut AppState) {
    state.mcp_panel.view = McpPanelView::AddEdit;
    state.mcp_panel.edit_server_id = None;
    state.mcp_panel.form_id.clear();
    state.mcp_panel.form_name.clear();
    state.mcp_panel.form_command.clear();
    state.mcp_panel.form_args.clear();
    state.mcp_panel.form_env.clear();
    state.mcp_panel.form_enabled = true;
    state.mcp_panel.form_field = 0;
    state.mcp_panel.form_error = None;
}

pub fn mcp_open_edit_form(state: &mut AppState) {
    let Some(server) = state.mcp_panel.servers.get(state.mcp_panel.selected) else {
        return;
    };

    state.mcp_panel.view = McpPanelView::AddEdit;
    state.mcp_panel.edit_server_id = Some(server.server_id.clone());
    state.mcp_panel.form_id = server.server_id.clone();
    state.mcp_panel.form_name = server.name.clone();
    state.mcp_panel.form_command = server.command.clone();
    state.mcp_panel.form_args = server.args.join(" ");
    state.mcp_panel.form_env = server
        .env
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("\n");
    state.mcp_panel.form_enabled = server.enabled;
    state.mcp_panel.form_field = 1; // Start at name since ID is readonly in edit
    state.mcp_panel.form_error = None;
}

pub fn mcp_form_next_field(state: &mut AppState) {
    state.mcp_panel.form_field = (state.mcp_panel.form_field + 1).min(5);
}

pub fn mcp_form_prev_field(state: &mut AppState) {
    let min_field = if state.mcp_panel.edit_server_id.is_some() {
        1
    } else {
        0
    };
    state.mcp_panel.form_field = state.mcp_panel.form_field.saturating_sub(1).max(min_field);
}

pub fn mcp_form_toggle_enabled(state: &mut AppState) {
    state.mcp_panel.form_enabled = !state.mcp_panel.form_enabled;
}

pub fn mcp_form_char(state: &mut AppState, ch: char) {
    let field = match state.mcp_panel.form_field {
        0 if state.mcp_panel.edit_server_id.is_none() => &mut state.mcp_panel.form_id,
        1 => &mut state.mcp_panel.form_name,
        2 => &mut state.mcp_panel.form_command,
        3 => &mut state.mcp_panel.form_args,
        4 => &mut state.mcp_panel.form_env,
        _ => return,
    };
    field.push(ch);
}

pub fn mcp_form_backspace(state: &mut AppState) {
    let field = match state.mcp_panel.form_field {
        0 if state.mcp_panel.edit_server_id.is_none() => &mut state.mcp_panel.form_id,
        1 => &mut state.mcp_panel.form_name,
        2 => &mut state.mcp_panel.form_command,
        3 => &mut state.mcp_panel.form_args,
        4 => &mut state.mcp_panel.form_env,
        _ => return,
    };
    field.pop();
}

pub fn mcp_form_newline(state: &mut AppState) {
    // Only env field supports newlines
    if state.mcp_panel.form_field == 4 {
        state.mcp_panel.form_env.push('\n');
    }
}

pub fn mcp_form_cancel(state: &mut AppState) {
    state.mcp_panel.view = McpPanelView::List;
    state.mcp_panel.form_error = None;
}

pub fn mcp_form_submit(state: &mut AppState) -> Vec<Outbound> {
    // Validate
    let id = state.mcp_panel.form_id.trim();
    let name = state.mcp_panel.form_name.trim();
    let command = state.mcp_panel.form_command.trim();

    if state.mcp_panel.edit_server_id.is_none() && id.is_empty() {
        state.mcp_panel.form_error = Some("Server ID is required".to_string());
        return Vec::new();
    }

    if state.mcp_panel.edit_server_id.is_none()
        && !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        state.mcp_panel.form_error =
            Some("ID: only lowercase letters, numbers, hyphens".to_string());
        return Vec::new();
    }

    if name.is_empty() {
        state.mcp_panel.form_error = Some("Name is required".to_string());
        return Vec::new();
    }

    if command.is_empty() {
        state.mcp_panel.form_error = Some("Command is required".to_string());
        return Vec::new();
    }

    // Build args array
    let args: Vec<String> = state
        .mcp_panel
        .form_args
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    // Build env map
    let env: HashMap<String, String> = state
        .mcp_panel
        .form_env
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let (k, v) = line.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect();

    let server_id = state
        .mcp_panel
        .edit_server_id
        .clone()
        .unwrap_or_else(|| id.to_string());

    let mut params = json!({
        "name": name,
        "command": command,
        "enabled": state.mcp_panel.form_enabled,
    });

    if let Some(obj) = params.as_object_mut() {
        if state.mcp_panel.edit_server_id.is_some() {
            obj.insert("serverId".to_string(), json!(server_id));
        } else {
            obj.insert("serverId".to_string(), json!(id));
        }
        if !args.is_empty() {
            obj.insert("args".to_string(), json!(args));
        }
        if !env.is_empty() {
            obj.insert("env".to_string(), json!(env));
        }
    }

    state.mcp_panel.loading = true;
    let req_id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id: req_id,
        method: "ent/mcp/servers/upsert".to_string(),
        params: Some(params),
    }]
}

pub fn mcp_handle_upsert_response(state: &mut AppState, result: &Option<serde_json::Value>) {
    state.mcp_panel.loading = false;

    if result.is_some() {
        // Success - go back to list view and refresh
        state.mcp_panel.view = McpPanelView::List;
        state.mcp_panel.form_error = None;
    }
}

pub fn mcp_delete_selected(state: &mut AppState) -> Vec<Outbound> {
    let Some(server) = state.mcp_panel.servers.get(state.mcp_panel.selected) else {
        return Vec::new();
    };

    let server_id = server.server_id.clone();
    state.mcp_panel.loading = true;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/mcp/servers/delete".to_string(),
        params: Some(json!({ "serverId": server_id })),
    }]
}

pub fn mcp_handle_delete_response(state: &mut AppState, result: &Option<serde_json::Value>) {
    state.mcp_panel.loading = false;

    if let Some(obj) = result.as_ref().and_then(|v| v.as_object()) {
        if obj.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            // Remove from local list
            if state.mcp_panel.selected < state.mcp_panel.servers.len() {
                state.mcp_panel.servers.remove(state.mcp_panel.selected);
            }
            if state.mcp_panel.selected >= state.mcp_panel.servers.len() {
                state.mcp_panel.selected = state.mcp_panel.servers.len().saturating_sub(1);
            }
        }
    }
}

pub fn mcp_test_selected(state: &mut AppState) -> Vec<Outbound> {
    let Some(server) = state.mcp_panel.servers.get(state.mcp_panel.selected) else {
        return Vec::new();
    };

    let server_id = server.server_id.clone();
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/mcp/servers/test".to_string(),
        params: Some(json!({ "serverId": server_id })),
    }]
}

pub fn mcp_handle_test_response(
    state: &mut AppState,
    server_id: &str,
    result: &Option<serde_json::Value>,
) {
    let Some(server) = state
        .mcp_panel
        .servers
        .iter_mut()
        .find(|s| s.server_id == server_id)
    else {
        return;
    };

    if let Some(obj) = result.as_ref().and_then(|v| v.as_object()) {
        let ok = obj.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if ok {
            server.status = McpServerStatus::Connected;
            server.error = None;
            server.tool_count = obj.get("toolCount").and_then(|v| v.as_u64()).map(|n| n as usize);
        } else {
            server.status = McpServerStatus::Error;
            server.error = obj.get("error").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
    }
}

// === Context Viewer Functions ===

pub fn context_open(state: &mut AppState) -> Vec<Outbound> {
    state.context_viewer.open = true;
    state.context_viewer.loading = true;
    state.context_viewer.error = None;
    state.context_viewer.scroll = 0;
    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/session/context_breakdown".to_string(),
        params: Some(json!({})),
    }]
}

pub fn context_close(state: &mut AppState) {
    state.context_viewer.open = false;
}

pub fn context_scroll_up(state: &mut AppState) {
    state.context_viewer.scroll = state.context_viewer.scroll.saturating_sub(1);
}

pub fn context_scroll_down(state: &mut AppState) {
    state.context_viewer.scroll = state.context_viewer.scroll.saturating_add(1);
}

pub fn context_handle_response(state: &mut AppState, result: &Option<serde_json::Value>) {
    state.context_viewer.loading = false;

    let Some(obj) = result.as_ref().and_then(|v| v.as_object()) else {
        state.context_viewer.error = Some("Invalid response".to_string());
        return;
    };

    let breakdown = ContextBreakdown {
        model_id: obj
            .get("modelId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        context_limit: obj.get("contextLimit").and_then(|v| v.as_u64()).unwrap_or(0),
        total_used_tokens: obj.get("totalUsedTokens").and_then(|v| v.as_u64()).unwrap_or(0),
        percent_used: obj
            .get("percentUsed")
            .and_then(|v| v.as_f64())
            .map(|p| (p * 100.0) as u32)
            .unwrap_or(0),
        system_prompt: parse_context_category(obj.get("categories").and_then(|c| c.get("systemPrompt"))),
        core_tools: parse_context_category(obj.get("categories").and_then(|c| c.get("coreTools"))),
        mcp_tools: parse_context_category(obj.get("categories").and_then(|c| c.get("mcpTools"))),
        messages: parse_context_category(obj.get("categories").and_then(|c| c.get("messages"))),
        message_subcategories: parse_message_subcategories(
            obj.get("categories").and_then(|c| c.get("messages")),
        ),
        reserved_for_response: parse_context_category(
            obj.get("categories").and_then(|c| c.get("reservedForResponse")),
        ),
        free_space: parse_context_category(obj.get("categories").and_then(|c| c.get("freeSpace"))),
    };

    state.context_viewer.breakdown = Some(breakdown);
}

fn parse_context_category(value: Option<&serde_json::Value>) -> ContextCategory {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return ContextCategory::default();
    };

    let tokens = obj.get("tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let items = obj
        .get("items")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    let name = obj.get("name")?.as_str()?.to_string();
                    let tokens = obj.get("tokens")?.as_u64()?;
                    Some(ContextItem { name, tokens })
                })
                .collect()
        })
        .unwrap_or_default();

    ContextCategory { tokens, items }
}

fn parse_message_subcategories(value: Option<&serde_json::Value>) -> ContextMessageSubcategories {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return ContextMessageSubcategories::default();
    };
    let Some(sub) = obj.get("subcategories").and_then(|v| v.as_object()) else {
        return ContextMessageSubcategories::default();
    };

    ContextMessageSubcategories {
        user_messages: sub
            .get("userMessages")
            .and_then(|v| v.get("tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        agent_messages: sub
            .get("agentMessages")
            .and_then(|v| v.get("tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        tool_calls: sub
            .get("toolCalls")
            .and_then(|v| v.get("tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        tool_results: sub
            .get("toolResults")
            .and_then(|v| v.get("tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    }
}
