pub mod reducer;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
  User,
  Assistant,
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
  pub messages: Vec<ChatMessage>,
  pub tool_inputs_by_tool_call_id: std::collections::HashMap<String, Value>,
  pub permission_queue: std::collections::VecDeque<PermissionRequest>,
  pub active_prompt_request_ids: std::collections::HashSet<String>,
}

impl AppState {
  pub fn new() -> Self {
    Self {
      messages: Vec::new(),
      tool_inputs_by_tool_call_id: std::collections::HashMap::new(),
      permission_queue: std::collections::VecDeque::new(),
      active_prompt_request_ids: std::collections::HashSet::new(),
    }
  }
}

