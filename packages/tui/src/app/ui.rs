use crate::app::{AppState, ChatMessage, Role};
use crate::app::reducer::{decide_permission, Outbound};
use serde_json::json;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiAction {
  InputChar(char),
  Backspace,
  Enter,
  HistoryPrev,
  HistoryNext,
  ToggleChat,
  ToggleActivity,
  ToggleDebug,
  FocusNext,
  ScrollUp,
  ScrollDown,

  PermissionPrev,
  PermissionNext,
  PermissionSubmit,
}

pub fn apply_ui_action(state: &mut AppState, action: UiAction) -> Vec<Outbound> {
  match action {
    UiAction::InputChar(ch) => {
      state.input_buffer.push(ch);
      Vec::new()
    }
    UiAction::Backspace => {
      state.input_buffer.pop();
      Vec::new()
    }
    UiAction::HistoryPrev => {
      if state.input_history.is_empty() {
        return Vec::new();
      }

      state.input_history_index = Some(match state.input_history_index {
        None => state.input_history.len() - 1,
        Some(0) => 0,
        Some(i) => i - 1,
      });
      let idx = state.input_history_index.unwrap();
      state.input_buffer = state.input_history[idx].clone();
      Vec::new()
    }
    UiAction::HistoryNext => {
      let Some(i) = state.input_history_index else {
        return Vec::new();
      };

      if i + 1 >= state.input_history.len() {
        state.input_history_index = None;
        state.input_buffer.clear();
      } else {
        let next = i + 1;
        state.input_history_index = Some(next);
        state.input_buffer = state.input_history[next].clone();
      }
      Vec::new()
    }
    UiAction::Enter => {
      let line = state.input_buffer.trim_end().to_string();
      state.input_buffer.clear();
      state.input_history_index = None;

      if line.is_empty() {
        return Vec::new();
      }

      state.input_history.push(line.clone());
      state.messages.push(ChatMessage {
        role: Role::User,
        text: line.clone(),
        streaming: false,
      });

      let id = state.next_client_id();
      state.active_prompt_request_ids.insert(id.clone());

      vec![Outbound::JsonRpcRequest {
        id,
        method: "session/prompt".to_string(),
        params: Some(json!({ "content": [ { "type": "text", "text": line } ] })),
      }]
    }
    UiAction::ToggleChat => {
      state.show_chat = !state.show_chat;
      state.ensure_focus_visible();
      Vec::new()
    }
    UiAction::ToggleActivity => {
      state.show_activity = !state.show_activity;
      state.ensure_focus_visible();
      Vec::new()
    }
    UiAction::ToggleDebug => {
      state.show_debug = !state.show_debug;
      state.ensure_focus_visible();
      Vec::new()
    }
    UiAction::FocusNext => {
      state.focus_next();
      Vec::new()
    }
    UiAction::ScrollUp => {
      use crate::app::Focus;
      match state.focus {
        Focus::Chat => state.chat_scroll = state.chat_scroll.saturating_sub(1),
        Focus::Activity => state.activity_scroll = state.activity_scroll.saturating_sub(1),
        Focus::Debug => state.debug_scroll = state.debug_scroll.saturating_sub(1),
        Focus::Input => {}
      }
      Vec::new()
    }
    UiAction::ScrollDown => {
      use crate::app::Focus;
      match state.focus {
        Focus::Chat => state.chat_scroll = state.chat_scroll.saturating_add(1),
        Focus::Activity => state.activity_scroll = state.activity_scroll.saturating_add(1),
        Focus::Debug => state.debug_scroll = state.debug_scroll.saturating_add(1),
        Focus::Input => {}
      }
      Vec::new()
    }
    UiAction::PermissionPrev => {
      if let Some(req) = &state.active_permission {
        if req.options.is_empty() {
          return Vec::new();
        }
        state.active_permission_selected = state.active_permission_selected.saturating_sub(1);
      }
      Vec::new()
    }
    UiAction::PermissionNext => {
      if let Some(req) = &state.active_permission {
        if req.options.is_empty() {
          return Vec::new();
        }
        let max = req.options.len() - 1;
        state.active_permission_selected = (state.active_permission_selected + 1).min(max);
      }
      Vec::new()
    }
    UiAction::PermissionSubmit => {
      let Some(req) = state.active_permission.take() else {
        return Vec::new();
      };

      let decision = req
        .options
        .get(state.active_permission_selected)
        .map(|o| o.option_id.clone())
        .unwrap_or_default();

      if decision.is_empty() {
        state.push_debug_line("permission: no options available".to_string());
        return Vec::new();
      }

      match decide_permission(req, &decision) {
        Ok(out) => {
          state.activate_next_permission_if_needed();
          out
        }
        Err(err) => {
          state.push_debug_line(err);
          Vec::new()
        }
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::app::reducer::{reduce, AppEvent};

  #[test]
  fn enter_sends_prompt_and_adds_user_message() {
    let mut state = AppState::new();
    state.next_client_seq = 3;

    state.input_buffer = "hi".to_string();
    let out = apply_ui_action(&mut state, UiAction::Enter);

    assert_eq!(state.messages.len(), 1);
    assert_eq!(state.messages[0].role, Role::User);
    assert_eq!(state.messages[0].text, "hi");

    assert_eq!(out.len(), 1);
    match &out[0] {
      Outbound::JsonRpcRequest { id, method, params } => {
        assert_eq!(id, "c_3");
        assert_eq!(method, "session/prompt");
        assert!(params.is_some());
      }
      _ => panic!("expected request"),
    }

    reduce(
      &mut state,
      AppEvent::TextDelta {
        text: "ok".to_string(),
      },
    );
    assert_eq!(state.messages.len(), 2);
  }

  #[test]
  fn history_prev_and_next() {
    let mut state = AppState::new();
    state.input_history = vec!["one".to_string(), "two".to_string()];

    apply_ui_action(&mut state, UiAction::HistoryPrev);
    assert_eq!(state.input_buffer, "two");

    apply_ui_action(&mut state, UiAction::HistoryPrev);
    assert_eq!(state.input_buffer, "one");

    apply_ui_action(&mut state, UiAction::HistoryNext);
    assert_eq!(state.input_buffer, "two");

    apply_ui_action(&mut state, UiAction::HistoryNext);
    assert_eq!(state.input_buffer, "");
  }

  #[test]
  fn permission_submit_sends_response() {
    use crate::app::{PermissionOption, PermissionRequest};
    use serde_json::json;

    let mut state = AppState::new();
    state.active_permission = Some(PermissionRequest {
      id: json!("a_1"),
      tool: Some("shell.exec".to_string()),
      kind: Some("execute".to_string()),
      resource: Some("echo hi".to_string()),
      tool_call_id: Some("tool_1".to_string()),
      turn_id: None,
      turn_seq: None,
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
    });
    state.active_permission_selected = 1;

    let out = apply_ui_action(&mut state, UiAction::PermissionSubmit);
    assert_eq!(out.len(), 1);
    assert!(state.active_permission.is_none());

    match &out[0] {
      Outbound::JsonRpcResponse { id, result } => {
        assert_eq!(id, &json!("a_1"));
        assert_eq!(result, &json!({"decision":"deny"}));
      }
      _ => panic!("expected response"),
    }
  }

  #[test]
  fn focus_cycle_skips_hidden_panes() {
    use crate::app::Focus;

    let mut state = AppState::new();
    state.show_debug = true;
    state.focus = Focus::Input;

    apply_ui_action(&mut state, UiAction::FocusNext);
    assert_eq!(state.focus, Focus::Chat);

    apply_ui_action(&mut state, UiAction::ToggleChat);
    assert_eq!(state.focus, Focus::Input);

    apply_ui_action(&mut state, UiAction::FocusNext);
    assert_eq!(state.focus, Focus::Activity);

    apply_ui_action(&mut state, UiAction::FocusNext);
    assert_eq!(state.focus, Focus::Debug);
  }
}
