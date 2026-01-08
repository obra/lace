pub mod activity;
pub mod clipboard;
pub mod config_panels;
pub mod config_wizard;
pub mod prefs;
pub mod reducer;
pub mod search;
pub mod sessions;
pub mod storage;
pub mod transcript;
pub mod ui;

use crate::app::config_panels::{EnvEditorState, ModelsPanelState};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Input,
    Chat,
    Activity,
    Debug,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: Role,
    pub text: String,
    pub streaming: bool,
    pub turn_id: Option<String>,
    pub turn_seq: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionOption {
    pub option_id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionRequest {
    pub id: Value,
    pub tool: Option<String>,
    pub kind: Option<String>,
    pub resource: Option<String>,
    pub tool_call_id: Option<String>,
    pub turn_id: Option<String>,
    pub turn_seq: Option<i64>,
    pub job_id: Option<String>,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PermissionAllowKey {
    pub tool: String,
    pub kind: String,
    pub resource: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppState {
    pub session_id: Option<String>,
    pub workdir: String,
    pub connection_id: Option<String>,
    pub model_id: Option<String>,
    pub last_activity_ms: Option<u64>,
    pub messages: Vec<ChatMessage>,
    pub tool_inputs_by_tool_call_id: std::collections::HashMap<String, Value>,
    pub permission_queue: std::collections::VecDeque<PermissionRequest>,
    pub active_prompt_request_ids: std::collections::HashSet<String>,

    pub input_buffer: String,
    pub input_scroll: u16,
    pub input_history: Vec<String>,
    pub input_history_index: Option<usize>,

    pub focus: Focus,
    pub chat_scroll: u16,
    pub chat_follow: bool,
    pub chat_max_scroll: u16,
    pub activity_scroll: u16,
    pub debug_scroll: u16,

    pub activity: std::collections::VecDeque<activity::ActivityItem>,
    pub activity_selected: usize,
    pub next_activity_seq: u64,
    pub debug_lines: std::collections::VecDeque<String>,

    pub active_permission: Option<PermissionRequest>,
    pub active_permission_selected: usize,

    pub palette_open: bool,
    pub palette_query: String,
    pub palette_selected: usize,

    pub help_open: bool,
    pub config_wizard: config_wizard::ConfigWizardState,
    pub sessions: sessions::SessionsState,
    pub search: search::SearchState,
    pub should_exit: bool,

    pub next_client_seq: u64,

    pub pending_requests: std::collections::HashMap<String, PendingRequest>,

    pub permission_allowlist: std::collections::HashMap<PermissionAllowKey, String>,

    pub session_aliases: std::collections::HashMap<String, String>,
    pub aliases_path: Option<std::path::PathBuf>,
    pub prefs: prefs::Preferences,
    pub prefs_path: Option<std::path::PathBuf>,
    pub session_snapshots: std::collections::HashMap<String, sessions::SessionSnapshot>,
    pub session_switch_target: Option<String>,

    // Simple, single-agent config state
    pub environment: std::collections::BTreeMap<String, String>,
    pub tools: Vec<String>,
    pub tools_open: bool,
    pub env_editor: EnvEditorState,
    pub models_panel: ModelsPanelState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingRequest {
    pub method: String,
    pub params: Option<Value>,
    pub sent_at_ms: u64,
    pub timeout_ms: u64,
}

impl AppState {
    pub fn new() -> Self {
        let aliases_path = storage::default_aliases_path();
        let prefs_path = storage::default_prefs_path();
        Self::new_with_paths(aliases_path, prefs_path)
    }

    pub fn new_with_paths(
        aliases_path: Option<std::path::PathBuf>,
        prefs_path: Option<std::path::PathBuf>,
    ) -> Self {
        let session_aliases = sessions::load_aliases(aliases_path.as_deref()).unwrap_or_default();
        let prefs = prefs::load(prefs_path.as_deref()).unwrap_or_default();

        let environment = prefs
            .environment
            .clone()
            .unwrap_or_else(std::collections::BTreeMap::new);

        Self {
            session_id: None,
            workdir: String::new(),
            connection_id: None,
            model_id: None,
            last_activity_ms: None,
            messages: Vec::new(),
            tool_inputs_by_tool_call_id: std::collections::HashMap::new(),
            permission_queue: std::collections::VecDeque::new(),
            active_prompt_request_ids: std::collections::HashSet::new(),

            input_buffer: String::new(),
            input_scroll: 0,
            input_history: Vec::new(),
            input_history_index: None,

            focus: Focus::Input,
            chat_scroll: 0,
            chat_follow: true,
            chat_max_scroll: 0,
            activity_scroll: 0,
            debug_scroll: 0,

            activity: std::collections::VecDeque::new(),
            activity_selected: 0,
            next_activity_seq: 1,
            debug_lines: std::collections::VecDeque::new(),

            active_permission: None,
            active_permission_selected: 0,

            palette_open: false,
            palette_query: String::new(),
            palette_selected: 0,

            help_open: false,
            config_wizard: config_wizard::ConfigWizardState::new(),
            sessions: sessions::SessionsState::new(),
            search: search::SearchState::new(),
            should_exit: false,

            next_client_seq: 1,

            pending_requests: std::collections::HashMap::new(),

            permission_allowlist: std::collections::HashMap::new(),

            session_aliases,
            aliases_path,
            prefs: prefs.clone(),
            prefs_path,
            session_snapshots: std::collections::HashMap::new(),
            session_switch_target: None,

            environment,
            tools: Vec::new(),
            tools_open: false,
            env_editor: EnvEditorState::default(),
            models_panel: ModelsPanelState::default(),
        }
    }

    pub fn next_client_id(&mut self) -> String {
        let id = format!("c_{}", self.next_client_seq);
        self.next_client_seq += 1;
        id
    }

    pub fn mark_request_sent(
        &mut self,
        id: String,
        method: String,
        params: Option<Value>,
        now_ms: u64,
        timeout_ms: u64,
    ) {
        self.pending_requests.insert(
            id,
            PendingRequest {
                method,
                params,
                sent_at_ms: now_ms,
                timeout_ms,
            },
        );
    }

    pub fn take_pending_request(&mut self, id: &str) -> Option<PendingRequest> {
        self.pending_requests.remove(id)
    }

    pub fn push_activity_line(&mut self, line: String) {
        activity::push_log_line(self, line);
    }

    pub fn push_debug_line(&mut self, line: String) {
        const MAX: usize = 400;
        if self.debug_lines.len() >= MAX {
            self.debug_lines.pop_front();
        }
        self.debug_lines.push_back(line);
    }

    pub fn activate_next_permission_if_needed(&mut self) {
        if self.active_permission.is_some() {
            return;
        }
        if let Some(next) = self.permission_queue.pop_front() {
            self.active_permission = Some(next);
            self.active_permission_selected = 0;
        }
    }

    pub fn focus_next(&mut self) {
        if self.active_permission.is_some() {
            return;
        }

        let mut order = Vec::new();
        order.push(Focus::Input);
        if self.prefs.show_chat {
            order.push(Focus::Chat);
        }
        if self.prefs.show_activity {
            order.push(Focus::Activity);
        }
        if self.prefs.show_debug {
            order.push(Focus::Debug);
        }

        let Some(pos) = order.iter().position(|f| *f == self.focus) else {
            self.focus = Focus::Input;
            return;
        };

        let next = (pos + 1) % order.len();
        self.focus = order[next];
    }

    pub fn ensure_focus_visible(&mut self) {
        if self.active_permission.is_some() {
            return;
        }
        match self.focus {
            Focus::Chat if !self.prefs.show_chat => self.focus = Focus::Input,
            Focus::Activity if !self.prefs.show_activity => self.focus = Focus::Input,
            Focus::Debug if !self.prefs.show_debug => self.focus = Focus::Input,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_request_round_trip() {
        let mut state = AppState::new();
        state.mark_request_sent(
            "c_1".to_string(),
            "session/prompt".to_string(),
            Some(Value::String("p".into())),
            100,
            500,
        );
        let p = state.take_pending_request("c_1").unwrap();
        assert_eq!(p.method, "session/prompt");
        assert_eq!(p.params, Some(Value::String("p".into())));
        assert_eq!(p.sent_at_ms, 100);
        assert_eq!(p.timeout_ms, 500);
        assert!(state.take_pending_request("c_1").is_none());
    }
}
