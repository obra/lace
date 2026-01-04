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
  ActivityJumpToTurn,

  OpenConfigureWizard,
  ConfigWizardPrev,
  ConfigWizardNext,
  ConfigWizardSubmit,
  ConfigWizardClose,
  ConfigWizardChar(char),
  ConfigWizardBackspace,

  OpenSessions,
  SessionsPrev,
  SessionsNext,
  SessionsClose,
  SessionsQueryChar(char),
  SessionsQueryBackspace,
  SessionsStartRename,
  SessionsRenameChar(char),
  SessionsRenameBackspace,
  SessionsSubmit,

  OpenSearch,
  SearchPrev,
  SearchNext,
  SearchBackspace,
  SearchChar(char),
  SearchSubmit,
  JumpLastError,
  JumpLastToolUse,
  JumpLastTurnEnd,
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
	    UiAction::ActivityJumpToTurn => {
      let Some(item) = state.activity.get(state.activity_selected) else {
        return Vec::new();
      };

      let target_turn_id = item.turn_id.as_deref();
      let target_turn_seq = item.turn_seq;
      let Some(target_idx) = state.messages.iter().position(|m| {
        if m.role != Role::Assistant {
          return false;
        }
        if let Some(tid) = target_turn_id {
          return m.turn_id.as_deref() == Some(tid);
        }
        m.turn_seq.is_some() && m.turn_seq == target_turn_seq
      }) else {
        return Vec::new();
      };

      state.focus = crate::app::Focus::Chat;
	      state.chat_scroll = chat_start_line_for_message_index(&state.messages, target_idx);
	      Vec::new()
	    }
	    UiAction::OpenConfigureWizard => crate::app::config_wizard::open(state),
	    UiAction::ConfigWizardPrev => {
	      crate::app::config_wizard::prev(state);
	      Vec::new()
	    }
	    UiAction::ConfigWizardNext => {
	      crate::app::config_wizard::next(state);
	      Vec::new()
	    }
	    UiAction::ConfigWizardSubmit => crate::app::config_wizard::submit(state),
	    UiAction::ConfigWizardClose => {
	      crate::app::config_wizard::close(state);
	      Vec::new()
	    }
	    UiAction::ConfigWizardChar(ch) => {
	      crate::app::config_wizard::input_char(state, ch);
	      Vec::new()
	    }
	    UiAction::ConfigWizardBackspace => {
	      crate::app::config_wizard::backspace(state);
	      Vec::new()
	    }
	    UiAction::OpenSessions => crate::app::sessions::open_sessions(state),
	    UiAction::SessionsPrev => {
	      crate::app::sessions::prev(state);
	      Vec::new()
	    }
	    UiAction::SessionsNext => {
	      crate::app::sessions::next(state);
	      Vec::new()
	    }
	    UiAction::SessionsClose => {
	      crate::app::sessions::close_sessions(state);
	      Vec::new()
	    }
	    UiAction::SessionsQueryChar(ch) => {
	      let mut q = state.sessions.query.clone();
	      q.push(ch);
	      crate::app::sessions::update_query(state, q);
	      Vec::new()
	    }
	    UiAction::SessionsQueryBackspace => {
	      let mut q = state.sessions.query.clone();
	      q.pop();
	      crate::app::sessions::update_query(state, q);
	      Vec::new()
	    }
	    UiAction::SessionsStartRename => {
	      crate::app::sessions::start_rename(state);
	      Vec::new()
	    }
	    UiAction::SessionsRenameChar(ch) => {
	      crate::app::sessions::rename_char(state, ch);
	      Vec::new()
	    }
	    UiAction::SessionsRenameBackspace => {
	      crate::app::sessions::rename_backspace(state);
	      Vec::new()
	    }
	    UiAction::SessionsSubmit => {
	      if state.sessions.renaming {
	        crate::app::sessions::submit_rename(state);
	        Vec::new()
	      } else {
	        crate::app::sessions::submit_load_selected(state)
	      }
	    }
	    UiAction::OpenSearch => {
	      crate::app::search::open(state);
	      Vec::new()
	    }
	    UiAction::SearchPrev => {
	      crate::app::search::prev(state);
	      Vec::new()
	    }
	    UiAction::SearchNext => {
	      crate::app::search::next(state);
	      Vec::new()
	    }
	    UiAction::SearchBackspace => {
	      crate::app::search::backspace(state);
	      Vec::new()
	    }
	    UiAction::SearchChar(ch) => {
	      crate::app::search::input_char(state, ch);
	      Vec::new()
	    }
	    UiAction::SearchSubmit => {
	      crate::app::search::jump_selected(state);
	      Vec::new()
	    }
	    UiAction::JumpLastError => {
	      crate::app::search::jump_last_error(state);
	      Vec::new()
	    }
	    UiAction::JumpLastToolUse => {
	      crate::app::search::jump_last_tool_use(state);
	      Vec::new()
	    }
	    UiAction::JumpLastTurnEnd => {
	      crate::app::search::jump_last_turn_end(state);
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
        turn_id: None,
        turn_seq: None,
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
      state.search.open = false;
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
		          crate::app::sessions::prepare_for_session_switch(state, None);
		          state.session_id = None;
		          out.push(Outbound::JsonRpcRequest {
		            id,
		            method: "session/new".to_string(),
		            params: Some(json!({ "workDir": state.workdir.clone() })),
		          });
		        }
		        PaletteCommand::Configure => {
		          out.extend(crate::app::config_wizard::open(state));
		        }
	        PaletteCommand::Sessions => {
	          out.extend(crate::app::sessions::open_sessions(state));
	        }
	        PaletteCommand::Search => {
	          crate::app::search::open(state);
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
  Configure,
  Sessions,
  Search,
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
	      label: "Configure...",
	      command: PaletteCommand::Configure,
	    },
		    PaletteItem {
		      label: "Sessions...",
		      command: PaletteCommand::Sessions,
		    },
		    PaletteItem {
		      label: "Search...",
		      command: PaletteCommand::Search,
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

fn chat_start_line_for_message_index(messages: &[ChatMessage], idx: usize) -> u16 {
  let mut lines: u64 = 0;
  for m in messages.iter().take(idx) {
    lines += 1; // prefix
    lines += m.text.lines().count() as u64;
    lines += 1; // blank line after message
  }
  lines.min(u16::MAX as u64) as u16
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
        turn_id: Some("turn_1".to_string()),
        turn_seq: Some(1),
      },
    );
    assert_eq!(state.messages.len(), 2);
  }

  #[test]
  fn activity_jump_to_turn_sets_chat_focus_and_scroll() {
    use crate::app::activity::{upsert_tool_use, ActivityKind};
    use serde_json::json;

    let mut state = AppState::new();
    state.messages.push(ChatMessage {
      role: Role::User,
      text: "hi".to_string(),
      streaming: false,
      turn_id: None,
      turn_seq: None,
    });
    state.messages.push(ChatMessage {
      role: Role::Assistant,
      text: "Hello".to_string(),
      streaming: false,
      turn_id: Some("turn_2".to_string()),
      turn_seq: Some(2),
    });

    upsert_tool_use(
      &mut state,
      "tool_1".to_string(),
      Some("shell.exec".to_string()),
      Some("awaiting_permission".to_string()),
      json!({"command":"echo hi"}),
      None,
      None,
      Some("turn_2".to_string()),
      Some(2),
    );
    assert_eq!(state.activity.len(), 1);
    assert_eq!(state.activity[0].kind, ActivityKind::ToolUse);
    state.activity_selected = 0;

    apply_ui_action(&mut state, UiAction::ActivityJumpToTurn);
    assert_eq!(state.focus, crate::app::Focus::Chat);
    assert_eq!(state.chat_scroll, 3);
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

  #[test]
  fn palette_search_opens_modal() {
    let mut state = AppState::new();
    apply_ui_action(&mut state, UiAction::OpenPalette);
    apply_ui_action(&mut state, UiAction::PaletteChar('s'));
    apply_ui_action(&mut state, UiAction::PaletteChar('e'));
    apply_ui_action(&mut state, UiAction::PaletteChar('a'));
    apply_ui_action(&mut state, UiAction::PaletteChar('r'));
    apply_ui_action(&mut state, UiAction::PaletteChar('c'));
    apply_ui_action(&mut state, UiAction::PaletteChar('h'));

    let out = apply_ui_action(&mut state, UiAction::PaletteSubmit);
    assert!(out.is_empty());
    assert!(state.search.open);
  }
}
