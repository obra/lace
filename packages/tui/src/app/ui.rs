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
  ActivityPrev,
  ActivityNext,
  ActivityToggleExpanded,
  ToggleChat,
  ToggleActivity,
  ToggleDebug,
  FocusNext,
  ScrollUp,
  ScrollDown,

  OpenPalette,
  CloseOverlay,
  ToggleHelp,
  PaletteChar(char),
  PaletteBackspace,
  PalettePrev,
  PaletteNext,
  PaletteSubmit,

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
    UiAction::ActivityPrev => {
      if !state.activity.is_empty() {
        state.activity_selected = state.activity_selected.saturating_sub(1);
      }
      Vec::new()
    }
    UiAction::ActivityNext => {
      if !state.activity.is_empty() {
        let max = state.activity.len().saturating_sub(1);
        state.activity_selected = (state.activity_selected + 1).min(max);
      }
      Vec::new()
    }
    UiAction::ActivityToggleExpanded => {
      if let Some(item) = state.activity.get_mut(state.activity_selected) {
        item.expanded = !item.expanded;
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
    UiAction::OpenPalette => {
      if state.active_permission.is_some() {
        return Vec::new();
      }
      state.palette_open = true;
      state.help_open = false;
      state.palette_query.clear();
      state.palette_selected = 0;
      Vec::new()
    }
    UiAction::CloseOverlay => {
      state.palette_open = false;
      state.help_open = false;
      Vec::new()
    }
    UiAction::ToggleHelp => {
      if state.active_permission.is_some() {
        return Vec::new();
      }
      state.help_open = !state.help_open;
      if state.help_open {
        state.palette_open = false;
      }
      Vec::new()
    }
    UiAction::PaletteChar(ch) => {
      if !state.palette_open {
        return Vec::new();
      }
      state.palette_query.push(ch);
      state.palette_selected = 0;
      Vec::new()
    }
    UiAction::PaletteBackspace => {
      if !state.palette_open {
        return Vec::new();
      }
      state.palette_query.pop();
      state.palette_selected = 0;
      Vec::new()
    }
    UiAction::PalettePrev => {
      if !state.palette_open {
        return Vec::new();
      }
      state.palette_selected = state.palette_selected.saturating_sub(1);
      Vec::new()
    }
    UiAction::PaletteNext => {
      if !state.palette_open {
        return Vec::new();
      }
      state.palette_selected = state.palette_selected.saturating_add(1);
      Vec::new()
    }
    UiAction::PaletteSubmit => {
      if !state.palette_open {
        return Vec::new();
      }
      let items = palette_items(&state.palette_query);
      if items.is_empty() {
        return Vec::new();
      }
      let idx = state.palette_selected.min(items.len() - 1);
      let mut out: Vec<Outbound> = Vec::new();
      match items[idx].command {
        PaletteCommand::NewSession => {
          let id = state.next_client_id();
          state.session_id = None;
          state.messages.clear();
          crate::app::activity::reset_activity(state);
          state.debug_lines.clear();
          out.push(Outbound::JsonRpcRequest {
            id,
            method: "session/new".to_string(),
            params: Some(json!({ "workDir": state.workdir.clone() })),
          });
        }
        PaletteCommand::ToggleChat => {
          state.show_chat = !state.show_chat;
          state.ensure_focus_visible();
        }
        PaletteCommand::ToggleActivity => {
          state.show_activity = !state.show_activity;
          state.ensure_focus_visible();
        }
        PaletteCommand::ToggleDebug => {
          state.show_debug = !state.show_debug;
          state.ensure_focus_visible();
        }
        PaletteCommand::FocusInput => {
          state.focus = crate::app::Focus::Input;
        }
        PaletteCommand::Quit => {
          state.should_exit = true;
        }
      }
      state.palette_open = false;
      out
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaletteCommand {
  NewSession,
  ToggleChat,
  ToggleActivity,
  ToggleDebug,
  FocusInput,
  Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PaletteItem {
  label: &'static str,
  command: PaletteCommand,
}

fn palette_items(query: &str) -> Vec<PaletteItem> {
  let all = [
    PaletteItem {
      label: "New Session",
      command: PaletteCommand::NewSession,
    },
    PaletteItem {
      label: "Toggle Chat Pane",
      command: PaletteCommand::ToggleChat,
    },
    PaletteItem {
      label: "Toggle Activity Pane",
      command: PaletteCommand::ToggleActivity,
    },
    PaletteItem {
      label: "Toggle Debug Pane",
      command: PaletteCommand::ToggleDebug,
    },
    PaletteItem {
      label: "Focus Input",
      command: PaletteCommand::FocusInput,
    },
    PaletteItem {
      label: "Quit",
      command: PaletteCommand::Quit,
    },
  ];

  let q = query.trim().to_lowercase();
  if q.is_empty() {
    return all.to_vec();
  }
  all
    .into_iter()
    .filter(|i| i.label.to_lowercase().contains(&q))
    .collect()
}

pub fn palette_labels(query: &str) -> Vec<&'static str> {
  palette_items(query).into_iter().map(|i| i.label).collect()
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

  #[test]
  fn palette_filters_and_submits() {
    let mut state = AppState::new();
    apply_ui_action(&mut state, UiAction::OpenPalette);
    apply_ui_action(&mut state, UiAction::PaletteChar('q'));
    apply_ui_action(&mut state, UiAction::PaletteSubmit);
    assert!(state.should_exit);
  }

  #[test]
  fn palette_new_session_emits_request() {
    let mut state = AppState::new();
    state.workdir = "/tmp".to_string();
    state.next_client_seq = 10;

    apply_ui_action(&mut state, UiAction::OpenPalette);
    apply_ui_action(&mut state, UiAction::PaletteChar('n'));
    apply_ui_action(&mut state, UiAction::PaletteChar('e'));
    apply_ui_action(&mut state, UiAction::PaletteChar('w'));
    let out = apply_ui_action(&mut state, UiAction::PaletteSubmit);

    assert_eq!(out.len(), 1);
    match &out[0] {
      Outbound::JsonRpcRequest { id, method, params } => {
        assert_eq!(id, "c_10");
        assert_eq!(method, "session/new");
        assert!(params.is_some());
      }
      _ => panic!("expected request"),
    }
  }
}
