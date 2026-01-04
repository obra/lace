use crate::app::{AppState, ChatMessage, PermissionRequest, Role};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
  TextDelta { text: String },
  TurnEnd { stop_reason: Option<String> },
  ToolUse { tool_call_id: String, input: Value },
  PermissionRequested(PermissionRequest),
  PromptDispatched { request_id: String },
  RpcResponse { id: Value },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outbound {
  JsonRpcRequest {
    id: String,
    method: String,
    params: Option<Value>,
  },
  JsonRpcResponse { id: Value, result: Value },
}

pub fn reduce(state: &mut AppState, event: AppEvent) -> Vec<Outbound> {
  match event {
    AppEvent::TextDelta { text } => {
      append_assistant_text(state, &text);
      Vec::new()
    }
    AppEvent::TurnEnd { .. } => {
      end_assistant_stream(state);
      Vec::new()
    }
    AppEvent::ToolUse { tool_call_id, input } => {
      state.tool_inputs_by_tool_call_id.insert(tool_call_id, input);
      Vec::new()
    }
    AppEvent::PermissionRequested(req) => {
      state.permission_queue.push_back(req);
      Vec::new()
    }
    AppEvent::PromptDispatched { request_id } => {
      state.active_prompt_request_ids.insert(request_id);
      Vec::new()
    }
    AppEvent::RpcResponse { id } => {
      if let Some(id_str) = id.as_str() {
        if state.active_prompt_request_ids.remove(id_str) {
          end_assistant_stream(state);
        }
      }
      Vec::new()
    }
  }
}

pub fn take_next_permission(state: &mut AppState) -> Option<PermissionRequest> {
  state.permission_queue.pop_front()
}

pub fn decide_permission(
  request: PermissionRequest,
  decision: &str,
) -> Result<Vec<Outbound>, String> {
  if !request.options.is_empty()
    && !request.options.iter().any(|o| o.option_id == decision)
  {
    return Err(format!("invalid optionId: {decision}"));
  }

  let result = Value::Object(
    [("decision".to_string(), Value::String(decision.to_string()))]
      .into_iter()
      .collect(),
  );
  Ok(vec![Outbound::JsonRpcResponse { id: request.id, result }])
}

fn append_assistant_text(state: &mut AppState, text: &str) {
  match state.messages.last_mut() {
    Some(ChatMessage {
      role: Role::Assistant,
      streaming: true,
      ..
    }) => {
      state.messages.last_mut().unwrap().text.push_str(text);
    }
    Some(ChatMessage {
      role: Role::Assistant,
      streaming: false,
      ..
    })
    | Some(ChatMessage { role: Role::User, .. })
    | None => {
      state.messages.push(ChatMessage {
        role: Role::Assistant,
        text: text.to_string(),
        streaming: true,
      });
    }
  }
}

fn end_assistant_stream(state: &mut AppState) {
  if let Some(msg) = state.messages.last_mut() {
    if msg.role == Role::Assistant && msg.streaming {
      msg.streaming = false;
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::app::{PermissionOption, PermissionRequest};
  use serde_json::json;

  #[test]
  fn text_delta_creates_and_appends_to_streaming_message() {
    let mut state = AppState::new();

    reduce(
      &mut state,
      AppEvent::TextDelta {
        text: "Hello".to_string(),
      },
    );
    reduce(
      &mut state,
      AppEvent::TextDelta {
        text: " world".to_string(),
      },
    );

    assert_eq!(
      state.messages,
      vec![ChatMessage {
        role: Role::Assistant,
        text: "Hello world".to_string(),
        streaming: true,
      }]
    );
  }

  #[test]
  fn turn_end_finalizes_streaming_message() {
    let mut state = AppState::new();

    reduce(
      &mut state,
      AppEvent::TextDelta {
        text: "ok".to_string(),
      },
    );
    reduce(
      &mut state,
      AppEvent::TurnEnd {
        stop_reason: Some("end_turn".to_string()),
      },
    );

    assert_eq!(state.messages.len(), 1);
    assert!(!state.messages[0].streaming);
  }

  #[test]
  fn tool_use_is_captured_for_permission_display() {
    let mut state = AppState::new();
    reduce(
      &mut state,
      AppEvent::ToolUse {
        tool_call_id: "tool_1".to_string(),
        input: json!({"command":"echo hi"}),
      },
    );
    assert_eq!(
      state.tool_inputs_by_tool_call_id.get("tool_1"),
      Some(&json!({"command":"echo hi"}))
    );
  }

  #[test]
  fn permission_queue_enqueue_and_decide() {
    let mut state = AppState::new();
    let req = PermissionRequest {
      id: json!("a_1"),
      tool: Some("shell.exec".to_string()),
      kind: Some("execute".to_string()),
      resource: Some("echo hi".to_string()),
      tool_call_id: Some("tool_1".to_string()),
      turn_id: Some("turn_1".to_string()),
      turn_seq: Some(1),
      job_id: None,
      options: vec![
        PermissionOption {
          option_id: "allow".to_string(),
          label: "Allow".to_string(),
        },
        PermissionOption {
          option_id: "deny".to_string(),
          label: "Deny".to_string(),
        },
      ],
    };

    reduce(&mut state, AppEvent::PermissionRequested(req.clone()));
    assert_eq!(state.permission_queue.len(), 1);

    let active = take_next_permission(&mut state).unwrap();
    let out = decide_permission(active, "allow").unwrap();
    assert_eq!(
      out,
      vec![Outbound::JsonRpcResponse {
        id: json!("a_1"),
        result: json!({"decision":"allow"}),
      }]
    );
  }

  #[test]
  fn prompt_response_can_finalize_when_turn_end_is_missing() {
    let mut state = AppState::new();

    reduce(
      &mut state,
      AppEvent::PromptDispatched {
        request_id: "c_1".to_string(),
      },
    );
    reduce(
      &mut state,
      AppEvent::TextDelta {
        text: "ok".to_string(),
      },
    );

    assert!(state.messages[0].streaming);

    reduce(
      &mut state,
      AppEvent::RpcResponse { id: json!("c_1") },
    );

    assert!(!state.messages[0].streaming);
  }
}
