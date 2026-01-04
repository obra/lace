pub mod reducer;
pub mod ui;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppState {
  pub session_id: Option<String>,
  pub workdir: String,
  pub messages: Vec<ChatMessage>,
  pub tool_inputs_by_tool_call_id: std::collections::HashMap<String, Value>,
  pub permission_queue: std::collections::VecDeque<PermissionRequest>,
  pub active_prompt_request_ids: std::collections::HashSet<String>,

  pub input_buffer: String,
  pub input_history: Vec<String>,
  pub input_history_index: Option<usize>,

  pub focus: Focus,
  pub chat_scroll: u16,
  pub activity_scroll: u16,
  pub debug_scroll: u16,

  pub show_chat: bool,
  pub show_activity: bool,
  pub show_debug: bool,

  pub activity: std::collections::VecDeque<String>,
  pub debug_lines: std::collections::VecDeque<String>,

  pub active_permission: Option<PermissionRequest>,
  pub active_permission_selected: usize,

  pub next_client_seq: u64,
}

impl AppState {
  pub fn new() -> Self {
    Self {
      session_id: None,
      workdir: String::new(),
      messages: Vec::new(),
      tool_inputs_by_tool_call_id: std::collections::HashMap::new(),
      permission_queue: std::collections::VecDeque::new(),
      active_prompt_request_ids: std::collections::HashSet::new(),

      input_buffer: String::new(),
      input_history: Vec::new(),
      input_history_index: None,

      focus: Focus::Input,
      chat_scroll: 0,
      activity_scroll: 0,
      debug_scroll: 0,

      show_chat: true,
      show_activity: true,
      show_debug: false,

      activity: std::collections::VecDeque::new(),
      debug_lines: std::collections::VecDeque::new(),

      active_permission: None,
      active_permission_selected: 0,

      next_client_seq: 1,
    }
  }

  pub fn next_client_id(&mut self) -> String {
    let id = format!("c_{}", self.next_client_seq);
    self.next_client_seq += 1;
    id
  }

  pub fn push_activity_line(&mut self, line: String) {
    const MAX: usize = 200;
    if self.activity.len() >= MAX {
      self.activity.pop_front();
    }
    self.activity.push_back(line);
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
    if self.show_chat {
      order.push(Focus::Chat);
    }
    if self.show_activity {
      order.push(Focus::Activity);
    }
    if self.show_debug {
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
      Focus::Chat if !self.show_chat => self.focus = Focus::Input,
      Focus::Activity if !self.show_activity => self.focus = Focus::Input,
      Focus::Debug if !self.show_debug => self.focus = Focus::Input,
      _ => {}
    }
  }
}
