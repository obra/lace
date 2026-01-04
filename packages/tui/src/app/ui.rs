use crate::app::{AppState, ChatMessage, Role};
use crate::app::reducer::Outbound;
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
      Vec::new()
    }
    UiAction::ToggleActivity => {
      state.show_activity = !state.show_activity;
      Vec::new()
    }
    UiAction::ToggleDebug => {
      state.show_debug = !state.show_debug;
      Vec::new()
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
}

