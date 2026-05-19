use crate::app::reducer::{decide_permission, Outbound};
use crate::app::{AppState, ChatMessage, Role};
use serde_json::json;
use strsim::normalized_levenshtein;
use tui_textarea::{CursorMove, TextArea};

fn input_text(state: &AppState) -> String {
    state.input.lines().join("\n")
}

fn set_input_text(state: &mut AppState, text: &str) {
    let lines: Vec<String> = if text.is_empty() {
        vec![String::new()]
    } else {
        text.lines().map(|s| s.to_string()).collect()
    };
    let mut ta = TextArea::new(lines);
    ta.move_cursor(CursorMove::Bottom);
    ta.move_cursor(CursorMove::End);
    state.input = ta;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiAction {
    InputChar(char),
    Backspace,
    Delete,
    Enter,
    CursorLeft,
    CursorRight,
    CursorUp,
    CursorDown,
    CursorHome,
    CursorEnd,
    KillToEnd,    // Ctrl+K
    KillToStart,  // Ctrl+U
    KillWordBack, // Ctrl+W
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

    SetTheme(crate::app::prefs::Theme),
    SetKeybindMode(crate::app::prefs::KeybindMode),
    SendInput,
    InsertNewline,
    PasteText(String),
    PasteImage,

    CopySelectedActivity,
    CopyLastAssistantMessage,
    CopyToolInput,
    CopyToolResult,
    ExportTranscript,
    FocusNext,
    ScrollUp,
    ScrollDown,

    OpenEnvEditor,
    EnvChar(char),
    EnvBackspace,
    EnvSaveEntry,
    EnvDelete,
    EnvPrev,
    EnvNext,
    EnvApply,
    CloseEnvEditor,

    OpenConnections,
    ConnectionsPrev,
    ConnectionsNext,
    ConnectionsRefresh,
    ConnectionsStartRename,
    ConnectionsRenameBackspace,
    ConnectionsRenameChar(char),
    ConnectionsSubmit,
    ConnectionsBeginDelete,
    ConnectionsCancelDelete,
    ConnectionsTest,
    ConnectionsCredentialsStatus,
    ConnectionsBeginClearCredentials,
    ConnectionsCancelClearCredentials,
    ConnectionsOpenModels,
    ConnectionsModelsPrev,
    ConnectionsModelsNext,
    ConnectionsModelsToggle,
    ConnectionsModelsRefresh,
    ConnectionsModelsClose,
    ConnectionsClose,
    ModelFetchOptions,

    CloseOverlay,
    ToggleHelp,

    SlashPickerOpen,
    SlashPickerClose,
    SlashPickerPrev,
    SlashPickerNext,
    SlashPickerSelect,
    SlashCycleOption,

    OpenMcpPanel,
    McpClose,
    McpPrev,
    McpNext,
    McpAdd,
    McpEdit,
    McpDelete,
    McpTest,
    McpFormPrev,
    McpFormNext,
    McpFormChar(char),
    McpFormBackspace,
    McpFormNewline,
    McpFormToggleEnabled,
    McpFormSubmit,
    McpFormCancel,

    OpenContextViewer,
    ContextViewerClose,
    ContextViewerScrollUp,
    ContextViewerScrollDown,

    PermissionPrev,
    PermissionNext,
    PermissionSubmit,
    PermissionCancel,
    PermissionGuidanceChar(char),
    PermissionGuidanceBackspace,
    PermissionToggleDetails,
    PermissionScrollUp,
    PermissionScrollDown,

    ChatToolPrev,
    ChatToolNext,
    ChatToolToggleExpanded,
    ChatToolClearSelection,
    ChatToolOpenDetails,
}

pub fn apply_ui_action(state: &mut AppState, action: UiAction) -> Vec<Outbound> {
    match action {
        UiAction::InputChar(ch) => {
            // Open slash picker when / is typed as first character
            if ch == '/' && input_text(state).is_empty() && !state.slash_commands.is_empty() {
                state.input.insert_char(ch);
                state.slash_picker_open = true;
                state.slash_picker_selected = 0;
            } else {
                state.input.insert_char(ch);
            }
            Vec::new()
        }
        UiAction::Backspace => {
            state.input.delete_char();
            Vec::new()
        }
        UiAction::Delete => {
            state.input.delete_next_char();
            Vec::new()
        }
        UiAction::CursorLeft => {
            state.input.move_cursor(CursorMove::Back);
            Vec::new()
        }
        UiAction::CursorRight => {
            state.input.move_cursor(CursorMove::Forward);
            Vec::new()
        }
        UiAction::CursorUp => {
            state.input.move_cursor(CursorMove::Up);
            Vec::new()
        }
        UiAction::CursorDown => {
            state.input.move_cursor(CursorMove::Down);
            Vec::new()
        }
        UiAction::CursorHome => {
            state.input.move_cursor(CursorMove::Head);
            Vec::new()
        }
        UiAction::CursorEnd => {
            state.input.move_cursor(CursorMove::End);
            Vec::new()
        }
        UiAction::KillToEnd => {
            state.input.delete_line_by_end();
            Vec::new()
        }
        UiAction::KillToStart => {
            state.input.delete_line_by_head();
            Vec::new()
        }
        UiAction::KillWordBack => {
            state.input.delete_word();
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
            let line = state.input_history[idx].clone();
            set_input_text(state, &line);
            Vec::new()
        }
        UiAction::HistoryNext => {
            let Some(i) = state.input_history_index else {
                return Vec::new();
            };

            if i + 1 >= state.input_history.len() {
                state.input_history_index = None;
                set_input_text(state, "");
            } else {
                let next = i + 1;
                state.input_history_index = Some(next);
                let line = state.input_history[next].clone();
                set_input_text(state, &line);
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
            state.chat_follow = false;
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
        UiAction::SetTheme(theme) => {
            state.prefs.theme = theme;
            let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);
            Vec::new()
        }
        UiAction::SetKeybindMode(mode) => {
            state.prefs.keybind_mode = mode;
            let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);
            Vec::new()
        }
        UiAction::SendInput => send_input(state),
        UiAction::CopySelectedActivity => {
            let Some(item) = state.activity.get(state.activity_selected) else {
                return Vec::new();
            };
            let mut text = String::new();
            text.push_str(&item.summary);
            if let Some(details) = &item.details {
                text.push_str("\n\n");
                text.push_str(
                    &serde_json::to_string_pretty(details).unwrap_or_else(|_| details.to_string()),
                );
            }
            copy_text_or_fallback(state, "activity", &text);
            Vec::new()
        }
        UiAction::CopyLastAssistantMessage => {
            let Some(msg) = state
                .messages
                .iter()
                .rev()
                .find(|m| m.role == Role::Assistant)
            else {
                return Vec::new();
            };
            let text = msg.text.clone();
            copy_text_or_fallback(state, "last assistant message", &text);
            Vec::new()
        }
        UiAction::CopyToolInput => {
            let Some(item) = state.activity.get(state.activity_selected) else {
                return Vec::new();
            };
            let Some(details) = &item.details else {
                return Vec::new();
            };
            let Some(input) = details.get("input") else {
                return Vec::new();
            };
            let text = serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
            copy_text_or_fallback(state, "tool input", &text);
            Vec::new()
        }
        UiAction::CopyToolResult => {
            let Some(item) = state.activity.get(state.activity_selected) else {
                return Vec::new();
            };
            let Some(details) = &item.details else {
                return Vec::new();
            };
            let Some(res) = details.get("result") else {
                return Vec::new();
            };
            let text = serde_json::to_string_pretty(res).unwrap_or_else(|_| res.to_string());
            copy_text_or_fallback(state, "tool result", &text);
            Vec::new()
        }
        UiAction::ExportTranscript => {
            match crate::app::transcript::export_to_workdir(state) {
                Ok(path) => state
                    .push_debug_line(format!("exported transcript: {}", path.to_string_lossy())),
                Err(err) => state.push_debug_line(format!("export transcript failed: {err}")),
            }
            Vec::new()
        }
        UiAction::Enter => send_input(state),
        UiAction::InsertNewline => {
            // Always insert a newline at cursor position
            state.input.insert_newline();
            Vec::new()
        }
        UiAction::PasteText(text) => {
            // Insert pasted text at cursor position without triggering submit
            state.input.insert_str(&text);
            Vec::new()
        }
        UiAction::PasteImage => {
            // Try to save clipboard image and add to pending images
            match crate::app::clipboard::try_save_clipboard_image() {
                Ok(path) => {
                    state.pending_images.push(path.clone());
                    state.push_debug_line(format!("Pasted image: {}", path));
                }
                Err(e) => {
                    state.push_debug_line(format!("Image paste failed: {}", e));
                }
            }
            Vec::new()
        }
        UiAction::OpenEnvEditor => {
            crate::app::config_panels::open_env_editor(state);
            Vec::new()
        }
        UiAction::EnvChar(ch) => {
            crate::app::config_panels::env_input_char(state, ch);
            Vec::new()
        }
        UiAction::EnvBackspace => {
            crate::app::config_panels::env_input_backspace(state);
            Vec::new()
        }
        UiAction::EnvSaveEntry => {
            crate::app::config_panels::env_save_entry(state);
            Vec::new()
        }
        UiAction::EnvDelete => {
            crate::app::config_panels::env_delete_selected(state);
            Vec::new()
        }
        UiAction::EnvPrev => {
            crate::app::config_panels::env_prev(state);
            Vec::new()
        }
        UiAction::EnvNext => {
            crate::app::config_panels::env_next(state);
            Vec::new()
        }
        UiAction::EnvApply => crate::app::config_panels::env_apply(state),
        UiAction::CloseEnvEditor => {
            crate::app::config_panels::close_env_editor(state);
            Vec::new()
        }
        UiAction::OpenConnections => crate::app::connections::open_connections(state),
        UiAction::ConnectionsPrev => {
            crate::app::connections::prev(state);
            Vec::new()
        }
        UiAction::ConnectionsNext => {
            crate::app::connections::next(state);
            Vec::new()
        }
        UiAction::ConnectionsRefresh => crate::app::connections::request_list(state),
        UiAction::ConnectionsStartRename => {
            crate::app::connections::start_rename(state);
            Vec::new()
        }
        UiAction::ConnectionsRenameBackspace => {
            crate::app::connections::rename_backspace(state);
            Vec::new()
        }
        UiAction::ConnectionsRenameChar(ch) => {
            crate::app::connections::rename_char(state, ch);
            Vec::new()
        }
        UiAction::ConnectionsBeginDelete => {
            crate::app::connections::begin_delete_selected(state);
            Vec::new()
        }
        UiAction::ConnectionsCancelDelete => {
            crate::app::connections::cancel_delete(state);
            Vec::new()
        }
        UiAction::ConnectionsTest => crate::app::connections::request_test_selected(state),
        UiAction::ConnectionsCredentialsStatus => {
            crate::app::connections::request_credentials_status(state)
        }
        UiAction::ConnectionsBeginClearCredentials => {
            crate::app::connections::begin_clear_credentials(state);
            Vec::new()
        }
        UiAction::ConnectionsCancelClearCredentials => {
            crate::app::connections::cancel_clear_credentials(state);
            Vec::new()
        }
        UiAction::ConnectionsOpenModels => crate::app::connections::open_models(state),
        UiAction::ConnectionsModelsPrev => {
            crate::app::connections::models_prev(state);
            Vec::new()
        }
        UiAction::ConnectionsModelsNext => {
            crate::app::connections::models_next(state);
            Vec::new()
        }
        UiAction::ConnectionsModelsToggle => crate::app::connections::toggle_selected_model(state),
        UiAction::ConnectionsModelsRefresh => {
            crate::app::connections::request_models_refresh(state)
        }
        UiAction::ConnectionsModelsClose => {
            crate::app::connections::close_models(state);
            Vec::new()
        }
        UiAction::ModelFetchOptions => {
            crate::app::connections::request_models_for_current_connection(state)
        }
        UiAction::ConnectionsSubmit => {
            if state.connections.confirm_delete {
                crate::app::connections::confirm_delete_selected(state)
            } else if state.connections.confirm_clear_credentials {
                crate::app::connections::confirm_clear_credentials(state)
            } else if state.connections.renaming {
                crate::app::connections::submit_rename(state)
            } else {
                crate::app::config_wizard::open_for_connection(state)
            }
        }
        UiAction::ConnectionsClose => {
            crate::app::connections::close_connections(state);
            Vec::new()
        }
        UiAction::FocusNext => {
            state.focus_next();
            Vec::new()
        }
        UiAction::ScrollUp => {
            use crate::app::Focus;
            match state.focus {
                // PageUp scrolls chat even when focus is Input
                Focus::Chat | Focus::Input => {
                    state.chat_follow = false;
                    state.chat_scroll = state.chat_scroll.saturating_sub(1);
                }
                Focus::Activity => state.activity_scroll = state.activity_scroll.saturating_sub(1),
                Focus::Debug => state.debug_scroll = state.debug_scroll.saturating_sub(1),
            }
            Vec::new()
        }
        UiAction::ScrollDown => {
            use crate::app::Focus;
            match state.focus {
                // PageDown scrolls chat even when focus is Input
                Focus::Chat | Focus::Input => {
                    state.chat_scroll = state
                        .chat_scroll
                        .saturating_add(1)
                        .min(state.chat_max_scroll);
                    if state.chat_scroll >= state.chat_max_scroll {
                        state.chat_follow = true;
                    }
                }
                Focus::Activity => state.activity_scroll = state.activity_scroll.saturating_add(1),
                Focus::Debug => state.debug_scroll = state.debug_scroll.saturating_add(1),
            }
            Vec::new()
        }
        UiAction::CloseOverlay => {
            state.help_open = false;
            state.search.open = false;
            Vec::new()
        }
        UiAction::ToggleHelp => {
            if state.active_permission.is_some() {
                return Vec::new();
            }
            state.help_open = !state.help_open;
            Vec::new()
        }
        UiAction::PermissionPrev => {
            if state.active_permission.is_some() {
                state.active_permission_selected =
                    state.active_permission_selected.saturating_sub(1);
            }
            Vec::new()
        }
        UiAction::PermissionNext => {
            if state.active_permission.is_some() {
                // guidance row is choices.len()
                let max = permission_choices(state).len();
                state.active_permission_selected = (state.active_permission_selected + 1).min(max);
            }
            Vec::new()
        }
        UiAction::PermissionSubmit => {
            // Compute choices BEFORE taking the permission, since permission_choices
            // requires active_permission to be present
            let choices = permission_choices(state);
            let guidance_index = choices.len();

            let Some(req) = state.active_permission.take() else {
                return Vec::new();
            };

            let has_guidance = !state.permission_guidance_input.is_empty();

            // Use the selected option regardless of whether guidance is provided
            // Guidance just adds a follow-up message to explain the decision
            let selected_idx = if state.active_permission_selected >= guidance_index {
                0
            } else {
                state.active_permission_selected
            };
            let decision = choices
                .get(selected_idx)
                .map(|c| c.option_id.clone())
                .unwrap_or_default();

            if decision.is_empty() {
                state.push_debug_line("permission: no options available".to_string());
                return Vec::new();
            }

            // Only remember decisions when not providing guidance
            // (guidance implies a one-off instruction, not a general preference)
            if !has_guidance {
                if let Some(choice) = choices.get(selected_idx) {
                    if let Some(key) = crate::app::reducer::permission_allow_key(&req) {
                        match choice.remember {
                            PermissionRemember::None => {}
                            PermissionRemember::Session => {
                                state.permission_allowlist.insert(key, decision.clone());
                            }
                            PermissionRemember::Always => {
                                state
                                    .permission_allowlist_global
                                    .insert(key, decision.clone());
                            }
                        }
                    }
                }
            }

            if let Some(tool_call_id) = req.tool_call_id.clone() {
                crate::app::activity::attach_permission_details(
                    state,
                    tool_call_id,
                    req.tool.clone(),
                    req.kind.clone(),
                    req.resource.clone(),
                    Some(decision.clone()),
                );
            }

            match decide_permission(req, &decision) {
                Ok(mut out) => {
                    // If guidance was provided, send it as a follow-up user message
                    // e.g. "yes, but use X instead" or "no, do Y instead"
                    if has_guidance {
                        let guidance_text = std::mem::take(&mut state.permission_guidance_input);
                        let id = state.next_client_id();
                        state.active_prompt_request_ids.insert(id.clone());
                        state.messages.push(ChatMessage {
                            role: Role::User,
                            text: guidance_text.clone(),
                            streaming: false,
                            turn_id: None,
                            turn_seq: None,
                        });
                        out.push(Outbound::JsonRpcRequest {
                            id,
                            method: "session/prompt".to_string(),
                            params: Some(
                                json!({ "content": [ { "type": "text", "text": guidance_text } ] }),
                            ),
                        });
                    }
                    state.permission_guidance_input.clear();
                    state.activate_next_permission_if_needed();
                    out
                }
                Err(err) => {
                    state.push_debug_line(err);
                    Vec::new()
                }
            }
        }
        UiAction::PermissionCancel => {
            if state.active_permission.is_none() {
                return Vec::new();
            }
            let choices = permission_choices(state);
            if let Some((idx, _)) = choices
                .iter()
                .enumerate()
                .find(|(_, c)| c.option_id.to_lowercase().contains("deny"))
            {
                state.active_permission_selected = idx;
                apply_ui_action(state, UiAction::PermissionSubmit)
            } else {
                Vec::new()
            }
        }
        UiAction::PermissionGuidanceChar(ch) => {
            state.permission_guidance_input.push(ch);
            Vec::new()
        }
        UiAction::PermissionGuidanceBackspace => {
            state.permission_guidance_input.pop();
            Vec::new()
        }
        UiAction::PermissionToggleDetails => {
            state.permission_details_expanded = !state.permission_details_expanded;
            Vec::new()
        }
        UiAction::PermissionScrollUp => {
            if state.permission_details_expanded {
                state.permission_details_scroll = state.permission_details_scroll.saturating_sub(1);
            }
            Vec::new()
        }
        UiAction::PermissionScrollDown => {
            if state.permission_details_expanded {
                state.permission_details_scroll = state.permission_details_scroll.saturating_add(1);
            }
            Vec::new()
        }
        UiAction::SlashPickerOpen => {
            let mut out = Vec::new();
            // Prefetch subcommand data when needed (e.g., /model)
            let input_copy = input_text(state);
            let trimmed = input_copy.trim_start();
            if let Some(head) = trimmed.strip_prefix('/') {
                let head = head.split_whitespace().next().unwrap_or("");
                if head == "model" && !state.connections.models.loading {
                    out.extend(
                        crate::app::connections::request_models_for_current_connection(state),
                    );
                }
            }
            if !filtered_slash_commands(state).is_empty() {
                state.slash_picker_open = true;
                state.slash_picker_selected = 0;
            }
            out
        }
        UiAction::SlashCycleOption => {
            // Cycle options for commands like "/mode", "/theme", etc.
            let input = input_text(state);
            let Some(stripped) = input.strip_prefix('/') else {
                return Vec::new();
            };
            let mut parts = stripped.split_whitespace();
            let Some(head_raw) = parts.next() else {
                return Vec::new();
            };
            let head = head_raw.to_lowercase();
            let suffix: String = parts.collect::<Vec<_>>().join(" ");

            // Prefetch model options if needed
            let mut out = Vec::new();
            if head == "model" && !state.connections.models.loading {
                out.extend(crate::app::connections::request_models_for_current_connection(state));
            }

            let options: Vec<String> = all_slash_commands(state)
                .into_iter()
                .filter_map(|cmd| {
                    let lower = cmd.name.to_lowercase();
                    lower.split_once(' ').and_then(|(h, t)| {
                        if h == head {
                            Some(t.to_string())
                        } else {
                            None
                        }
                    })
                })
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();

            if options.is_empty() {
                return Vec::new();
            }

            let suffix_norm = suffix.to_lowercase().trim().to_string();
            let idx = options.iter().position(|o| o.to_lowercase() == suffix_norm);
            let next = options[match idx {
                Some(i) => (i + 1) % options.len(),
                None => 0,
            }]
            .clone();
            let new_input = format!("/{} {}", head_raw, next);
            set_input_text(state, &new_input);
            state.slash_picker_open = false;
            out
        }
        UiAction::SlashPickerClose => {
            state.slash_picker_open = false;
            Vec::new()
        }
        UiAction::SlashPickerPrev => {
            state.slash_picker_selected = state.slash_picker_selected.saturating_sub(1);
            Vec::new()
        }
        UiAction::SlashPickerNext => {
            let filtered = filtered_slash_commands(state);
            let max = filtered.len().saturating_sub(1);
            state.slash_picker_selected = (state.slash_picker_selected + 1).min(max);
            Vec::new()
        }
        UiAction::SlashPickerSelect => {
            let filtered = filtered_slash_commands(state);
            // Clone needed values before modifying state
            let selected_cmd = filtered.get(state.slash_picker_selected).map(|cmd| {
                (
                    cmd.name.clone(),
                    cmd.input_hint.is_some(),
                    cmd.source.clone().unwrap_or_else(|| "builtin".to_string()),
                )
            });
            drop(filtered);

            if let Some((name, has_hint, source)) = selected_cmd {
                if source == "permission" {
                    let out = execute_permission_slash_command(state, &name);
                    state.slash_picker_open = false;
                    return out;
                } else if source == "local" {
                    let out = execute_local_slash_command(state, &name);
                    state.slash_picker_open = false;
                    return out;
                } else {
                    let mut line = format!("/{}", name);
                    if has_hint {
                        line.push(' ');
                    }
                    set_input_text(state, &line);
                }
            }
            state.slash_picker_open = false;
            Vec::new()
        }

        // === MCP Panel ===
        UiAction::OpenMcpPanel => crate::app::config_panels::mcp_open(state),
        UiAction::McpClose => {
            crate::app::config_panels::mcp_close(state);
            Vec::new()
        }
        UiAction::McpPrev => {
            crate::app::config_panels::mcp_prev(state);
            Vec::new()
        }
        UiAction::McpNext => {
            crate::app::config_panels::mcp_next(state);
            Vec::new()
        }
        UiAction::McpAdd => {
            crate::app::config_panels::mcp_open_add_form(state);
            Vec::new()
        }
        UiAction::McpEdit => {
            crate::app::config_panels::mcp_open_edit_form(state);
            Vec::new()
        }
        UiAction::McpDelete => crate::app::config_panels::mcp_delete_selected(state),
        UiAction::McpTest => crate::app::config_panels::mcp_test_selected(state),
        UiAction::McpFormPrev => {
            crate::app::config_panels::mcp_form_prev_field(state);
            Vec::new()
        }
        UiAction::McpFormNext => {
            crate::app::config_panels::mcp_form_next_field(state);
            Vec::new()
        }
        UiAction::McpFormChar(ch) => {
            crate::app::config_panels::mcp_form_char(state, ch);
            Vec::new()
        }
        UiAction::McpFormBackspace => {
            crate::app::config_panels::mcp_form_backspace(state);
            Vec::new()
        }
        UiAction::McpFormNewline => {
            crate::app::config_panels::mcp_form_newline(state);
            Vec::new()
        }
        UiAction::McpFormToggleEnabled => {
            crate::app::config_panels::mcp_form_toggle_enabled(state);
            Vec::new()
        }
        UiAction::McpFormSubmit => crate::app::config_panels::mcp_form_submit(state),
        UiAction::McpFormCancel => {
            crate::app::config_panels::mcp_form_cancel(state);
            Vec::new()
        }

        // === Context Viewer ===
        UiAction::OpenContextViewer => crate::app::config_panels::context_open(state),
        UiAction::ContextViewerClose => {
            crate::app::config_panels::context_close(state);
            Vec::new()
        }
        UiAction::ContextViewerScrollUp => {
            crate::app::config_panels::context_scroll_up(state);
            Vec::new()
        }
        UiAction::ContextViewerScrollDown => {
            crate::app::config_panels::context_scroll_down(state);
            Vec::new()
        }

        // === Chat Tool Selection ===
        UiAction::ChatToolPrev => {
            let tools = state.completed_tool_calls();
            if !tools.is_empty() {
                state.chat_selected_tool_idx = match state.chat_selected_tool_idx {
                    None => Some(tools.len() - 1),
                    Some(0) => Some(tools.len() - 1),
                    Some(i) => Some(i - 1),
                };
            }
            Vec::new()
        }
        UiAction::ChatToolNext => {
            let tools = state.completed_tool_calls();
            if !tools.is_empty() {
                state.chat_selected_tool_idx = match state.chat_selected_tool_idx {
                    None => Some(0),
                    Some(i) if i >= tools.len() - 1 => Some(0),
                    Some(i) => Some(i + 1),
                };
            }
            Vec::new()
        }
        UiAction::ChatToolToggleExpanded => {
            if state.chat_selected_tool_idx.is_some() {
                state.chat_tool_expanded = !state.chat_tool_expanded;
            }
            Vec::new()
        }
        UiAction::ChatToolClearSelection => {
            state.chat_selected_tool_idx = None;
            state.chat_tool_expanded = false;
            Vec::new()
        }
        UiAction::ChatToolOpenDetails => {
            if state.chat_selected_tool_idx.is_some() {
                state.tool_details_overlay_open = true;
                state.tool_details_overlay_scroll = 0;
            }
            Vec::new()
        }
    }
}

pub(crate) fn all_slash_commands(state: &AppState) -> Vec<crate::app::SlashCommand> {
    fn local_commands() -> Vec<crate::app::SlashCommand> {
        vec![
            ("theme dark", "Switch to dark theme"),
            ("theme light", "Switch to light theme"),
            ("theme high-contrast", "Switch to high contrast theme"),
            ("keybind default", "Use default keybindings"),
            ("keybind vim", "Use Vim keybindings"),
            ("toggle debug", "Toggle debug overlay"),
            ("toggle activity", "Toggle activity overlay"),
            ("help", "Toggle help"),
            ("search", "Open search"),
            ("configure", "Run quick setup"),
            ("sessions", "Switch sessions"),
            ("connections", "Open connections panel"),
            ("env", "Open environment editor"),
            ("context", "Open context viewer"),
            ("mcp servers", "Manage MCP servers"),
            ("compact context", "Compact current context"),
            ("clear", "Clear conversation and start new session"),
            ("new session", "Start a new session"),
            ("export transcript", "Export chat transcript"),
            ("model", "Switch model (current connection)"),
            ("quit", "Quit the TUI"),
        ]
        .into_iter()
        .map(|(name, desc)| crate::app::SlashCommand {
            name: name.to_string(),
            description: desc.to_string(),
            input_hint: if name == "model" {
                Some("<modelId>".to_string())
            } else {
                None
            },
            source: Some("local".to_string()),
        })
        .collect()
    }

    fn permission_commands(state: &AppState) -> Vec<crate::app::SlashCommand> {
        let mut cmds = Vec::new();
        if let Some(req) = &state.active_permission {
            for opt in &req.options {
                let label = opt.label.to_lowercase();
                cmds.push(crate::app::SlashCommand {
                    name: format!("permission {}", label),
                    description: format!(
                        "Decide permission: {} (resource: {})",
                        opt.label,
                        req.resource.clone().unwrap_or_else(|| "n/a".to_string())
                    ),
                    input_hint: None,
                    source: Some("permission".to_string()),
                });
            }
            // Convenience aliases
            cmds.push(crate::app::SlashCommand {
                name: "permission allow".to_string(),
                description: "Allow current permission request".to_string(),
                input_hint: None,
                source: Some("permission".to_string()),
            });
            cmds.push(crate::app::SlashCommand {
                name: "permission deny".to_string(),
                description: "Deny current permission request".to_string(),
                input_hint: None,
                source: Some("permission".to_string()),
            });
        }
        cmds
    }

    let mut all: Vec<crate::app::SlashCommand> = state.slash_commands.clone();
    all.extend(local_commands());
    all.extend(permission_commands(state));

    // Expand commands with sub-options into synthetic subcommands, so picker + Tab can show them.
    // We keep track of which primary command each subcommand belongs to.
    let mut expanded: Vec<(String, crate::app::SlashCommand)> = Vec::new();

    // Dynamic: /model options from fetched models / wizard / last model
    let model_options: Vec<String> = if !state.connections.models.models.is_empty() {
        state
            .connections
            .models
            .models
            .iter()
            .map(|m| m.model_id.clone())
            .collect()
    } else if !state.config_wizard.models.is_empty() {
        state
            .config_wizard
            .models
            .iter()
            .map(|m| m.model_id.clone())
            .collect()
    } else if let Some(last) = &state.prefs.last_model_id {
        vec![last.clone()]
    } else {
        // No models known yet; show a placeholder entry to instruct user.
        vec!["current connection".to_string()]
    };
    for m in model_options {
        // Skip duplicate placeholder
        let desc = if m == "current connection" {
            "Switch model to current connection (load models)".to_string()
        } else {
            format!("Switch model to {}", m)
        };
        expanded.push((
            "model".to_string(),
            crate::app::SlashCommand {
                name: format!("model {}", m),
                description: desc,
                input_hint: None,
                source: Some("local".to_string()),
            },
        ));
    }

    // Static inline "(a|b|c)" expansion
    for cmd in &all {
        if let Some(start) = cmd.description.find('(') {
            if let Some(end_rel) = cmd.description[start..].find(')') {
                let inside = &cmd.description[start + 1..start + end_rel];
                let opts: Vec<String> = inside
                    .split('|')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if !opts.is_empty() {
                    for opt in opts {
                        expanded.push((
                            cmd.name.clone(),
                            crate::app::SlashCommand {
                                name: format!("{} {}", cmd.name, opt),
                                description: format!("{} ({opt})", cmd.description),
                                input_hint: None,
                                source: cmd.source.clone(),
                            },
                        ));
                    }
                }
            }
        }
    }
    // Only include subcommands when input head matches, to avoid clutter.
    let input_head = state
        .input
        .lines()
        .join("\n")
        .strip_prefix('/')
        .and_then(|s| s.split_whitespace().next())
        .map(|s| s.to_string());
    if let Some(head) = input_head {
        for (_primary, sub) in expanded.into_iter().filter(|(p, _)| p == &head) {
            all.push(sub);
        }
    }
    all
}

/// Returns slash commands filtered by current input (after the `/`)
pub fn filtered_slash_commands(state: &AppState) -> Vec<crate::app::SlashCommand> {
    let all = all_slash_commands(state);

    let query = state
        .input
        .lines()
        .join("\n")
        .strip_prefix('/')
        .unwrap_or("")
        .to_lowercase();
    let input_head = state
        .input
        .lines()
        .join("\n")
        .strip_prefix('/')
        .and_then(|s| s.split_whitespace().next())
        .map(|s| s.to_string());
    let has_space = state
        .input
        .lines()
        .join("\n")
        .strip_prefix('/')
        .map(|s| s.contains(' '))
        .unwrap_or(false);

    let mut filtered: Vec<(i32, crate::app::SlashCommand)> = all
        .into_iter()
        .filter_map(|cmd| {
            // When inside a head (e.g., "/mode ..."), hide the bare head entry
            if has_space {
                if let Some(ref head) = input_head {
                    if cmd.name == *head {
                        return None;
                    }
                }
            }
            if query.is_empty() {
                Some((0, cmd))
            } else {
                let name = cmd.name.to_lowercase();
                let desc = cmd.description.to_lowercase();
                if name.contains(&query) || desc.contains(&query) {
                    // simple relevance score: startswith > contains > fuzzy
                    let mut score = 1;
                    if name.starts_with(&query) {
                        score += 3;
                    } else if desc.starts_with(&query) {
                        score += 2;
                    }
                    let fuzzy = (normalized_levenshtein(&name, &query) * 100.0) as i32;
                    score += fuzzy / 20; // small bonus
                    Some((score, cmd))
                } else {
                    None
                }
            }
        })
        .collect();
    filtered.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    filtered.into_iter().map(|(_, cmd)| cmd).collect()
}

fn execute_local_slash_command(state: &mut AppState, name: &str) -> Vec<Outbound> {
    match name {
        "theme dark" => {
            let _ = apply_ui_action(state, UiAction::SetTheme(crate::app::prefs::Theme::Dark));
            Vec::new()
        }
        "theme light" => {
            let _ = apply_ui_action(state, UiAction::SetTheme(crate::app::prefs::Theme::Light));
            Vec::new()
        }
        "theme high-contrast" => {
            let _ = apply_ui_action(
                state,
                UiAction::SetTheme(crate::app::prefs::Theme::HighContrast),
            );
            Vec::new()
        }
        "keybind default" => {
            let _ = apply_ui_action(
                state,
                UiAction::SetKeybindMode(crate::app::prefs::KeybindMode::Default),
            );
            Vec::new()
        }
        "keybind vim" => {
            let _ = apply_ui_action(
                state,
                UiAction::SetKeybindMode(crate::app::prefs::KeybindMode::Vim),
            );
            Vec::new()
        }
        "toggle debug" => {
            state.debug_overlay_open = !state.debug_overlay_open;
            if state.debug_overlay_open {
                state.activity_overlay_open = false;
            }
            Vec::new()
        }
        "toggle activity" => {
            state.activity_overlay_open = !state.activity_overlay_open;
            if state.activity_overlay_open {
                state.debug_overlay_open = false;
            }
            Vec::new()
        }
        "help" => {
            let _ = apply_ui_action(state, UiAction::ToggleHelp);
            Vec::new()
        }
        "search" => {
            let _ = apply_ui_action(state, UiAction::OpenSearch);
            Vec::new()
        }
        "configure" => crate::app::config_wizard::open(state),
        "sessions" => crate::app::sessions::open_sessions(state),
        "connections" => apply_ui_action(state, UiAction::OpenConnections),
        "env" => apply_ui_action(state, UiAction::OpenEnvEditor),
        "context" => apply_ui_action(state, UiAction::OpenContextViewer),
        "mcp servers" => crate::app::config_panels::mcp_open(state),
        name if name.starts_with("model ") => {
            let target = name.trim_start_matches("model ").trim();
            switch_model(state, target)
        }
        "model" => {
            // Prepare input for subcommand selection and open picker
            set_input_text(state, "/model ");
            let mut out = Vec::new();
            if !state.connections.models.loading {
                out.extend(crate::app::connections::request_models_for_current_connection(state));
            }
            state.slash_picker_open = true;
            state.slash_picker_selected = 0;
            out
        }
        "compact context" => {
            let id = state.next_client_id();
            state.push_activity_line("Compacting context...".to_string());
            vec![Outbound::JsonRpcRequest {
                id,
                method: "ent/session/compact".to_string(),
                params: Some(json!({})),
            }]
        }
        "clear" | "new session" => {
            let mut out = Vec::new();
            let id = state.next_client_id();
            crate::app::sessions::prepare_for_session_switch(state, None);
            state.session_id = None;
            out.push(Outbound::JsonRpcRequest {
                id,
                method: "session/new".to_string(),
                params: Some(json!({ "cwd": state.workdir.clone(), "mcpServers": [] })),
            });
            out
        }
        "export transcript" => {
            let _ = apply_ui_action(state, UiAction::ExportTranscript);
            Vec::new()
        }
        "quit" => {
            state.should_exit = true;
            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn switch_model(state: &mut AppState, model_id: &str) -> Vec<Outbound> {
    let model_id = model_id.trim();
    if model_id.is_empty() {
        state.push_debug_line("model: missing model id".to_string());
        return Vec::new();
    }
    let Some(connection_id) = crate::app::connections::current_connection_id(state) else {
        state.push_debug_line("model: no active connection".to_string());
        return Vec::new();
    };

    state.model_id = Some(model_id.to_string());
    state.prefs.last_model_id = state.model_id.clone();
    let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);

    let id = state.next_client_id();
    vec![Outbound::JsonRpcRequest {
        id,
        method: "ent/session/configure".to_string(),
        params: Some(json!({
            "connectionId": connection_id,
            "modelId": model_id,
        })),
    }]
}

fn execute_permission_slash_command(state: &mut AppState, name: &str) -> Vec<Outbound> {
    let Some(req) = state.active_permission.clone() else {
        return Vec::new();
    };
    let target = name
        .strip_prefix("permission ")
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let mut selected_idx: Option<usize> = None;

    for (idx, opt) in req.options.iter().enumerate() {
        if opt.label.to_lowercase() == target || opt.option_id.to_lowercase() == target {
            selected_idx = Some(idx);
            break;
        }
    }

    if selected_idx.is_none() {
        if target == "allow" {
            selected_idx = req
                .options
                .iter()
                .position(|o| o.option_id.to_lowercase().contains("allow"));
        } else if target == "deny" {
            selected_idx = req
                .options
                .iter()
                .position(|o| o.option_id.to_lowercase().contains("deny"));
        }
    }

    let Some(idx) = selected_idx else {
        return Vec::new();
    };
    state.active_permission = Some(req);
    state.permission_details_scroll = 0;
    state.active_permission_selected = idx;
    apply_ui_action(state, UiAction::PermissionSubmit)
}

#[derive(Clone, Copy)]
pub(crate) enum PermissionRemember {
    None,
    Session,
    Always,
}

#[derive(Clone)]
pub(crate) struct PermissionChoice {
    pub(crate) option_id: String,
    pub(crate) remember: PermissionRemember,
}

pub(crate) fn permission_choices(state: &AppState) -> Vec<PermissionChoice> {
    let Some(req) = state.active_permission.as_ref() else {
        return Vec::new();
    };

    let mut allow_opt: Option<String> = None;
    let mut deny_opt: Option<String> = None;
    let mut extra: Vec<String> = Vec::new();

    for opt in &req.options {
        let id_lower = opt.option_id.to_lowercase();
        let label_lower = opt.label.to_lowercase();
        if allow_opt.is_none() && (id_lower.contains("allow") || label_lower.contains("allow")) {
            allow_opt = Some(opt.option_id.clone());
        } else if deny_opt.is_none() && (id_lower.contains("deny") || label_lower.contains("deny"))
        {
            deny_opt = Some(opt.option_id.clone());
        } else {
            extra.push(opt.option_id.clone());
        }
    }

    let mut choices: Vec<PermissionChoice> = Vec::new();

    if let Some(id) = allow_opt.clone() {
        choices.push(PermissionChoice {
            option_id: id.clone(),
            remember: PermissionRemember::None,
        });
        choices.push(PermissionChoice {
            option_id: id.clone(),
            remember: PermissionRemember::Session,
        });
        choices.push(PermissionChoice {
            option_id: id,
            remember: PermissionRemember::Always,
        });
    }

    if let Some(id) = deny_opt.clone() {
        choices.push(PermissionChoice {
            option_id: id,
            remember: PermissionRemember::None,
        });
    }

    for id in extra {
        choices.push(PermissionChoice {
            option_id: id,
            remember: PermissionRemember::None,
        });
    }

    // If no allow/deny detected, fall back to the raw options
    if choices.is_empty() {
        for opt in &req.options {
            choices.push(PermissionChoice {
                option_id: opt.option_id.clone(),
                remember: PermissionRemember::None,
            });
        }
    }

    choices
}

fn send_input(state: &mut AppState) -> Vec<Outbound> {
    let line = input_text(state).trim_end().to_string();
    let images = std::mem::take(&mut state.pending_images);

    if line.is_empty() && images.is_empty() {
        return Vec::new();
    }

    // Handle local slash commands directly (no agent roundtrip)
    if images.is_empty() && line.starts_with('/') {
        let cmd_text = line.trim_start_matches('/').trim();
        if !cmd_text.is_empty() {
            if let Some(cmd) = all_slash_commands(state)
                .into_iter()
                .find(|c| c.name == cmd_text)
            {
                let out = match cmd.source.as_deref() {
                    Some("local") => execute_local_slash_command(state, &cmd.name),
                    Some("permission") => execute_permission_slash_command(state, &cmd.name),
                    _ => Vec::new(),
                };
                set_input_text(state, "");
                state.input_history_index = None;
                return out;
            }
        }
    }

    set_input_text(state, "");
    state.input_history_index = None;
    state.chat_follow = true;

    // Build display text for chat (show image indicators)
    let display_text = if images.is_empty() {
        line.clone()
    } else {
        let image_indicators: Vec<String> = images
            .iter()
            .enumerate()
            .map(|(i, _)| format!("[Image #{}]", i + 1))
            .collect();
        if line.is_empty() {
            image_indicators.join(" ")
        } else {
            format!("{} {}", line, image_indicators.join(" "))
        }
    };

    state.input_history.push(line.clone());
    state.messages.push(ChatMessage {
        role: Role::User,
        text: display_text,
        streaming: false,
        turn_id: None,
        turn_seq: None,
    });

    // Build content array with text and images
    let mut content = Vec::new();

    if !line.is_empty() {
        content.push(json!({ "type": "text", "text": line }));
    }

    // Add images as base64-encoded content
    for path in &images {
        if let Ok(data) = std::fs::read(path) {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            content.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": b64
                }
            }));
        } else {
            state.push_debug_line(format!("Failed to read image: {}", path));
        }
    }

    if content.is_empty() {
        return Vec::new();
    }

    let id = state.next_client_id();
    state.active_prompt_request_ids.insert(id.clone());

    vec![Outbound::JsonRpcRequest {
        id,
        method: "session/prompt".to_string(),
        params: Some(json!({ "content": content })),
    }]
}

fn copy_text_or_fallback(state: &mut AppState, label: &str, text: &str) {
    match crate::app::clipboard::try_copy_to_clipboard(text) {
        Ok(()) => state.push_debug_line(format!("copied {label} to clipboard")),
        Err(_) => state.push_debug_line(format!("copy {label}:\n{text}")),
    }
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
    use crate::app::prefs::{KeybindMode, Theme};
    use crate::app::reducer::{reduce, AppEvent};
    use crate::app::SlashCommand;

    fn input_str(state: &AppState) -> String {
        input_text(state)
    }

    fn set_input(state: &mut AppState, text: &str) {
        set_input_text(state, text);
    }

    fn cursor_pos(state: &AppState) -> (usize, usize) {
        state.input.cursor()
    }

    fn slash_cmd(name: &str, desc: &str) -> SlashCommand {
        SlashCommand {
            name: name.to_string(),
            description: desc.to_string(),
            input_hint: None,
            source: None,
        }
    }

    #[test]
    fn enter_sends_prompt_and_adds_user_message() {
        let mut state = AppState::new();
        state.next_client_seq = 3;
        state.prefs.input_multiline = true;

        set_input(&mut state, "hi");
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

        let mut state = AppState::new_with_paths(None, None);
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
        assert_eq!(input_str(&state), "two");

        apply_ui_action(&mut state, UiAction::HistoryPrev);
        assert_eq!(input_str(&state), "one");

        apply_ui_action(&mut state, UiAction::HistoryNext);
        assert_eq!(input_str(&state), "two");

        apply_ui_action(&mut state, UiAction::HistoryNext);
        assert_eq!(input_str(&state), "");
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
        // With allow/deny options, permission_choices creates:
        // 0: allow (None), 1: allow (Session), 2: allow (Always), 3: deny (None)
        // Select index 3 to choose "deny"
        state.active_permission_selected = 3;

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
    fn permission_cancel_picks_deny_if_present() {
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
        state.active_permission_selected = 0;

        let out = apply_ui_action(&mut state, UiAction::PermissionCancel);
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcResponse { result, .. } => {
                assert_eq!(result, &json!({"decision":"deny"}))
            }
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn permission_submit_with_guidance_uses_selected_option_and_sends_prompt() {
        use crate::app::{PermissionOption, PermissionRequest};
        use serde_json::json;

        let mut state = AppState::new();
        state.next_client_seq = 5;
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
        // With "allow" selected, guidance should allow + send follow-up
        state.active_permission_selected = 0;
        state.permission_guidance_input = "be careful with output".to_string();

        let out = apply_ui_action(&mut state, UiAction::PermissionSubmit);
        // Should produce 2 outputs: allow response + prompt request
        assert_eq!(out.len(), 2);
        assert!(state.active_permission.is_none());
        // Guidance should be cleared after submission
        assert!(state.permission_guidance_input.is_empty());

        // First output: allow (uses selected option)
        match &out[0] {
            Outbound::JsonRpcResponse { id, result } => {
                assert_eq!(id, &json!("a_1"));
                assert_eq!(result, &json!({"decision":"allow"}));
            }
            _ => panic!("expected response"),
        }

        // Second output: session/prompt with guidance text
        match &out[1] {
            Outbound::JsonRpcRequest { id, method, params } => {
                assert_eq!(id, "c_5");
                assert_eq!(method, "session/prompt");
                let params = params.as_ref().unwrap();
                let content = params.get("content").unwrap().as_array().unwrap();
                assert_eq!(content[0].get("text").unwrap(), "be careful with output");
            }
            _ => panic!("expected request"),
        }

        // Guidance should also appear in chat as user message
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].role, Role::User);
        assert_eq!(state.messages[0].text, "be careful with output");
    }

    #[test]
    fn permission_guidance_typing_and_backspace() {
        use crate::app::{PermissionOption, PermissionRequest};
        use serde_json::json;

        let mut state = AppState::new();
        state.active_permission = Some(PermissionRequest {
            id: json!("a_1"),
            tool: Some("shell.exec".to_string()),
            kind: None,
            resource: None,
            tool_call_id: None,
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![PermissionOption {
                option_id: "allow".to_string(),
                label: "Allow".to_string(),
            }],
        });

        // Type some guidance
        apply_ui_action(&mut state, UiAction::PermissionGuidanceChar('h'));
        apply_ui_action(&mut state, UiAction::PermissionGuidanceChar('i'));
        assert_eq!(state.permission_guidance_input, "hi");

        // Backspace removes last char
        apply_ui_action(&mut state, UiAction::PermissionGuidanceBackspace);
        assert_eq!(state.permission_guidance_input, "h");

        apply_ui_action(&mut state, UiAction::PermissionGuidanceBackspace);
        assert!(state.permission_guidance_input.is_empty());
    }

    #[test]
    fn permission_toggle_details_toggles_expanded_state() {
        let mut state = AppState::new();
        state.permission_details_scroll = 3;
        assert!(state.permission_details_expanded);

        // Toggle off
        apply_ui_action(&mut state, UiAction::PermissionToggleDetails);
        assert!(!state.permission_details_expanded);
        assert_eq!(state.permission_details_scroll, 3, "Scroll is preserved");

        // Toggle on
        apply_ui_action(&mut state, UiAction::PermissionToggleDetails);
        assert!(state.permission_details_expanded);
        assert_eq!(state.permission_details_scroll, 3, "Scroll is preserved");
    }

    #[test]
    fn permission_scroll_up_down_changes_scroll_when_expanded() {
        let mut state = AppState::new();
        state.permission_details_expanded = true;
        state.permission_details_scroll = 1;

        apply_ui_action(&mut state, UiAction::PermissionScrollDown);
        assert_eq!(state.permission_details_scroll, 2);

        apply_ui_action(&mut state, UiAction::PermissionScrollUp);
        assert_eq!(state.permission_details_scroll, 1);

        apply_ui_action(&mut state, UiAction::PermissionScrollUp);
        assert_eq!(state.permission_details_scroll, 0);

        apply_ui_action(&mut state, UiAction::PermissionScrollUp);
        assert_eq!(state.permission_details_scroll, 0);
    }

    #[test]
    fn permission_scroll_up_down_noop_when_collapsed() {
        let mut state = AppState::new();
        state.permission_details_expanded = false;
        state.permission_details_scroll = 5;

        apply_ui_action(&mut state, UiAction::PermissionScrollDown);
        assert_eq!(state.permission_details_scroll, 5);

        apply_ui_action(&mut state, UiAction::PermissionScrollUp);
        assert_eq!(state.permission_details_scroll, 5);
    }

    #[test]
    fn permission_next_includes_guidance_row() {
        use crate::app::{PermissionOption, PermissionRequest};
        use serde_json::json;

        let mut state = AppState::new();
        state.active_permission = Some(PermissionRequest {
            id: json!("a_1"),
            tool: Some("shell.exec".to_string()),
            kind: None,
            resource: None,
            tool_call_id: None,
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
        state.active_permission_selected = 0;

        // Navigate to the second option
        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 1);

        // Navigate to the guidance row (index 4, which is choices.len())
        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 2);

        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 3);

        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 4);

        // Should not go past guidance row
        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 4);
    }

    #[test]
    fn permission_submit_from_guidance_row_uses_first_option_and_sends_prompt() {
        use crate::app::{PermissionOption, PermissionRequest};
        use serde_json::json;

        let mut state = AppState::new();
        state.next_client_seq = 7;
        state.active_permission = Some(PermissionRequest {
            id: json!("a_1"),
            tool: Some("shell.exec".to_string()),
            kind: None,
            resource: None,
            tool_call_id: None,
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
        // Select guidance row (index 4) - falls back to first option (allow)
        state.active_permission_selected = 4;
        state.permission_guidance_input = "test guidance".to_string();

        let out = apply_ui_action(&mut state, UiAction::PermissionSubmit);
        // Should produce 2 outputs: allow response + prompt request
        assert_eq!(out.len(), 2);

        // First output: allow (falls back to first option when guidance row selected)
        match &out[0] {
            Outbound::JsonRpcResponse { id, result } => {
                assert_eq!(id, &json!("a_1"));
                assert_eq!(result, &json!({"decision":"allow"}));
            }
            _ => panic!("expected response"),
        }

        // Second output: session/prompt with guidance text
        match &out[1] {
            Outbound::JsonRpcRequest { id, method, params } => {
                assert_eq!(id, "c_7");
                assert_eq!(method, "session/prompt");
                let params = params.as_ref().unwrap();
                let content = params.get("content").unwrap().as_array().unwrap();
                assert_eq!(content[0].get("text").unwrap(), "test guidance");
            }
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn permission_submit_from_guidance_row_without_text_uses_first_option() {
        use crate::app::{PermissionOption, PermissionRequest};
        use serde_json::json;

        let mut state = AppState::new();
        state.active_permission = Some(PermissionRequest {
            id: json!("a_1"),
            tool: Some("shell.exec".to_string()),
            kind: None,
            resource: None,
            tool_call_id: None,
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
        // Select guidance row (index 4) but no guidance text
        state.active_permission_selected = 4;
        state.permission_guidance_input.clear();

        let out = apply_ui_action(&mut state, UiAction::PermissionSubmit);
        assert_eq!(out.len(), 1);

        match &out[0] {
            Outbound::JsonRpcResponse { id, result } => {
                assert_eq!(id, &json!("a_1"));
                // Without guidance text, falls back to first option
                assert_eq!(result, &json!({"decision":"allow"}));
            }
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn focus_cycle_skips_hidden_panes() {
        use crate::app::Focus;

        let mut state = AppState::new_with_paths(None, None);
        state.prefs.show_debug = true;
        state.focus = Focus::Input;

        apply_ui_action(&mut state, UiAction::FocusNext);
        assert_eq!(state.focus, Focus::Chat);

        // Directly hide chat pane (ToggleChat action was removed)
        state.prefs.show_chat = false;
        state.ensure_focus_visible();
        assert_eq!(state.focus, Focus::Input);

        apply_ui_action(&mut state, UiAction::FocusNext);
        assert_eq!(state.focus, Focus::Activity);

        apply_ui_action(&mut state, UiAction::FocusNext);
        assert_eq!(state.focus, Focus::Debug);
    }

    #[test]
    fn multiline_enter_sends_and_shift_enter_inserts_newline() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 3;
        state.prefs.input_multiline = true;
        set_input(&mut state, "hello");

        // Bare Enter submits
        let out = apply_ui_action(&mut state, UiAction::Enter);
        assert_eq!(out.len(), 1);

        // Reset state to test Shift+Enter newline
        set_input(&mut state, "hi");
        let out = apply_ui_action(&mut state, UiAction::InsertNewline);
        assert!(out.is_empty());
        assert_eq!(input_str(&state), "hi\n");
    }

    #[test]
    fn set_theme_updates_preferences() {
        let mut state = AppState::new_with_paths(None, None);
        assert_eq!(state.prefs.theme, Theme::Dark);
        let out = apply_ui_action(&mut state, UiAction::SetTheme(Theme::Light));
        assert!(out.is_empty());
        assert_eq!(state.prefs.theme, Theme::Light);
    }

    #[test]
    fn set_keybind_mode_updates_preferences() {
        let mut state = AppState::new_with_paths(None, None);
        assert_eq!(state.prefs.keybind_mode, KeybindMode::Default);
        let out = apply_ui_action(&mut state, UiAction::SetKeybindMode(KeybindMode::Vim));
        assert!(out.is_empty());
        assert_eq!(state.prefs.keybind_mode, KeybindMode::Vim);
    }

    #[test]
    fn cursor_left_right_navigation() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "hello");

        // Move left
        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(cursor_pos(&state), (0, 4));

        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(cursor_pos(&state), (0, 3));

        // Move right
        apply_ui_action(&mut state, UiAction::CursorRight);
        assert_eq!(cursor_pos(&state), (0, 4));

        // Move left to beginning
        apply_ui_action(&mut state, UiAction::CursorLeft);
        apply_ui_action(&mut state, UiAction::CursorLeft);
        apply_ui_action(&mut state, UiAction::CursorLeft);
        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(cursor_pos(&state), (0, 0));

        // Can't go past beginning
        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(cursor_pos(&state), (0, 0));
    }

    #[test]
    fn cursor_home_end() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "line1\nline2\nline3");
        // Move cursor to middle of line2 (row 1 col 2)
        // Start at end of input (row 2, col 5), go up to row 1, then head to col 0, then forward twice
        state.input.move_cursor(CursorMove::Up);
        state.input.move_cursor(CursorMove::Head);
        state.input.move_cursor(CursorMove::Forward);
        state.input.move_cursor(CursorMove::Forward);

        // Home goes to start of current line
        apply_ui_action(&mut state, UiAction::CursorHome);
        assert_eq!(cursor_pos(&state), (1, 0)); // start of "line2"

        // End goes to end of current line
        apply_ui_action(&mut state, UiAction::CursorEnd);
        assert_eq!(cursor_pos(&state), (1, 5)); // end of "line2" (before \n)

        // Move to first line and test
        state.input.move_cursor(CursorMove::Head);
        state.input.move_cursor(CursorMove::Up);
        state.input.move_cursor(CursorMove::Forward);
        state.input.move_cursor(CursorMove::Forward);
        apply_ui_action(&mut state, UiAction::CursorHome);
        assert_eq!(cursor_pos(&state), (0, 0));

        apply_ui_action(&mut state, UiAction::CursorEnd);
        assert_eq!(cursor_pos(&state), (0, 5)); // end of "line1"
    }

    #[test]
    fn cursor_up_down_multiline() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "line1\nline2\nline3");
        // Move to middle of line2 (row1 col2)
        state.input.move_cursor(CursorMove::Up); // to row1 end
        state.input.move_cursor(CursorMove::Head);
        state.input.move_cursor(CursorMove::Forward);
        state.input.move_cursor(CursorMove::Forward);

        // Move up maintains column
        apply_ui_action(&mut state, UiAction::CursorUp);
        assert_eq!(cursor_pos(&state), (0, 2)); // col 2 of "line1"

        // Can't go up from first line
        apply_ui_action(&mut state, UiAction::CursorUp);
        assert_eq!(cursor_pos(&state), (0, 2)); // stays at col 2 of "line1"

        // Move down
        set_input(&mut state, "line1\nline2\nline3");
        state.input.move_cursor(CursorMove::Up);
        state.input.move_cursor(CursorMove::Head);
        state.input.move_cursor(CursorMove::Forward);
        state.input.move_cursor(CursorMove::Forward);
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(cursor_pos(&state), (2, 2)); // col 2 of "line3"

        // Can't go down from last line
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(cursor_pos(&state), (2, 2)); // stays at col 2 of "line3"
    }

    #[test]
    fn cursor_up_down_short_lines() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "long line here\nhi\nx");
        // Move cursor to first line at high column
        // Start at end of input (2, 1), go to top/head, then move forward to col 10
        state.input.move_cursor(CursorMove::Top);
        for _ in 0..10 {
            state.input.move_cursor(CursorMove::Forward);
        }
        // Now at (0, 10) - middle of "long line here"

        // Move down to shorter line - cursor clamps to end of "hi" (length 2)
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(cursor_pos(&state), (1, 2)); // end of "hi"

        // Move down again - goes to end of "x" (length 1)
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(cursor_pos(&state), (2, 1)); // end of "x"
    }

    #[test]
    fn kill_to_end_and_start() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "hello world");
        state.input.move_cursor(CursorMove::Head);
        for _ in 0..6 {
            state.input.move_cursor(CursorMove::Forward);
        }

        // Kill to end (Ctrl+K)
        apply_ui_action(&mut state, UiAction::KillToEnd);
        assert_eq!(input_str(&state), "hello ");
        assert_eq!(cursor_pos(&state), (0, 6));

        // Reset
        set_input(&mut state, "hello world");
        state.input.move_cursor(CursorMove::Head);
        for _ in 0..6 {
            state.input.move_cursor(CursorMove::Forward);
        }

        // Kill to start (Ctrl+U)
        apply_ui_action(&mut state, UiAction::KillToStart);
        assert_eq!(input_str(&state), "world");
        assert_eq!(cursor_pos(&state), (0, 0));
    }

    #[test]
    fn kill_word_back() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "hello world foo");

        // Kill word back (Ctrl+W)
        apply_ui_action(&mut state, UiAction::KillWordBack);
        assert_eq!(input_str(&state), "hello world ");
        assert_eq!(cursor_pos(&state), (0, 12));

        apply_ui_action(&mut state, UiAction::KillWordBack);
        assert_eq!(input_str(&state), "hello ");
        assert_eq!(cursor_pos(&state), (0, 6));
    }

    #[test]
    fn insert_and_delete_at_cursor() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "helo");
        state.input.move_cursor(CursorMove::Head);
        for _ in 0..3 {
            state.input.move_cursor(CursorMove::Forward);
        }

        // Insert at cursor
        apply_ui_action(&mut state, UiAction::InputChar('l'));
        assert_eq!(input_str(&state), "hello");
        assert_eq!(cursor_pos(&state), (0, 4));

        // Delete at cursor
        state.input.move_cursor(CursorMove::Head);
        state.input.move_cursor(CursorMove::Forward);
        state.input.move_cursor(CursorMove::Forward);
        apply_ui_action(&mut state, UiAction::Delete);
        assert_eq!(input_str(&state), "helo");
        assert_eq!(cursor_pos(&state), (0, 2));

        // Backspace
        apply_ui_action(&mut state, UiAction::Backspace);
        assert_eq!(input_str(&state), "hlo");
        assert_eq!(cursor_pos(&state), (0, 1));
    }

    #[test]
    fn paste_text_at_cursor() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "hello world");
        state.input.move_cursor(CursorMove::Head);
        for _ in 0..6 {
            state.input.move_cursor(CursorMove::Forward);
        }

        apply_ui_action(&mut state, UiAction::PasteText("beautiful ".to_string()));
        assert_eq!(input_str(&state), "hello beautiful world");
        assert_eq!(cursor_pos(&state), (0, 16)); // after pasted text
    }

    #[test]
    fn insert_newline_at_cursor() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "hello world");
        state.input.move_cursor(CursorMove::Head);
        for _ in 0..5 {
            state.input.move_cursor(CursorMove::Forward);
        }

        apply_ui_action(&mut state, UiAction::InsertNewline);
        assert_eq!(input_str(&state), "hello\n world");
        // Cursor is at start of new line (row 1, col 0)
        assert_eq!(cursor_pos(&state), (1, 0));
    }

    #[test]
    fn slash_picker_open_and_selects_command() {
        let mut state = AppState::new_with_paths(None, None);
        state.slash_commands = vec![slash_cmd("ping", "Ping the agent")];

        // Typing '/' opens picker and inserts the slash
        apply_ui_action(&mut state, UiAction::InputChar('/'));
        assert!(state.slash_picker_open);
        assert_eq!(input_str(&state), "/");

        // Narrow to command and select
        set_input(&mut state, "/pi");
        state.slash_picker_open = true;
        state.slash_picker_selected = 0;
        apply_ui_action(&mut state, UiAction::SlashPickerSelect);

        assert!(!state.slash_picker_open);
        // No trailing space since command has no input_hint
        assert_eq!(input_str(&state), "/ping");
    }

    #[test]
    fn slash_picker_respects_input_hint_spacing() {
        let mut state = AppState::new_with_paths(None, None);
        let mut cmd = slash_cmd("deploy", "Deploy stuff");
        cmd.input_hint = Some("env".to_string());
        state.slash_commands = vec![cmd];

        set_input(&mut state, "/dep");
        state.slash_picker_open = true;
        state.slash_picker_selected = 0;
        apply_ui_action(&mut state, UiAction::SlashPickerSelect);

        // Trailing space added when command has an input hint
        assert_eq!(input_str(&state), "/deploy ");
    }

    #[test]
    fn multiline_shift_enter_preserves_blank_lines_and_text() {
        let mut state = AppState::new_with_paths(None, None);
        set_input(&mut state, "hi");

        apply_ui_action(&mut state, UiAction::InsertNewline); // shift+enter
        apply_ui_action(&mut state, UiAction::InsertNewline); // shift+enter
        apply_ui_action(&mut state, UiAction::InputChar('f'));
        apply_ui_action(&mut state, UiAction::InputChar('f'));

        assert_eq!(input_str(&state), "hi\n\nff");
        assert_eq!(state.input.cursor(), (2, 2)); // row 2 col 2
    }

    #[test]
    fn chat_tool_selection_navigates_completed_tools() {
        use crate::app::activity;
        let mut state = AppState::new_with_paths(None, None);

        // Add some completed tool calls
        activity::upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("file.read".to_string()),
            Some("completed".to_string()),
            serde_json::json!({"path": "/tmp/file.txt"}),
            None,
            None,
            None,
            None,
        );
        activity::upsert_tool_use(
            &mut state,
            "tool_2".to_string(),
            Some("shell.exec".to_string()),
            Some("success".to_string()),
            serde_json::json!({"command": "echo hi"}),
            None,
            None,
            None,
            None,
        );
        activity::upsert_tool_use(
            &mut state,
            "tool_3".to_string(),
            Some("file.write".to_string()),
            Some("error".to_string()),
            serde_json::json!({"path": "/etc/passwd"}),
            None,
            None,
            None,
            None,
        );

        // Initially no selection
        assert_eq!(state.chat_selected_tool_idx, None);
        assert!(!state.chat_tool_expanded);

        // Navigate down - should start at 0
        apply_ui_action(&mut state, UiAction::ChatToolNext);
        assert_eq!(state.chat_selected_tool_idx, Some(0));

        // Navigate down again
        apply_ui_action(&mut state, UiAction::ChatToolNext);
        assert_eq!(state.chat_selected_tool_idx, Some(1));

        // Navigate down to last
        apply_ui_action(&mut state, UiAction::ChatToolNext);
        assert_eq!(state.chat_selected_tool_idx, Some(2));

        // Wrap around to first
        apply_ui_action(&mut state, UiAction::ChatToolNext);
        assert_eq!(state.chat_selected_tool_idx, Some(0));

        // Navigate up wraps to last
        apply_ui_action(&mut state, UiAction::ChatToolPrev);
        assert_eq!(state.chat_selected_tool_idx, Some(2));

        // Toggle expanded
        apply_ui_action(&mut state, UiAction::ChatToolToggleExpanded);
        assert!(state.chat_tool_expanded);

        // Toggle again to collapse
        apply_ui_action(&mut state, UiAction::ChatToolToggleExpanded);
        assert!(!state.chat_tool_expanded);

        // Clear selection
        apply_ui_action(&mut state, UiAction::ChatToolClearSelection);
        assert_eq!(state.chat_selected_tool_idx, None);
        assert!(!state.chat_tool_expanded);
    }

    #[test]
    fn chat_tool_selection_toggle_requires_selection() {
        let mut state = AppState::new_with_paths(None, None);

        // No tools, no selection
        assert_eq!(state.chat_selected_tool_idx, None);
        assert!(!state.chat_tool_expanded);

        // Toggle does nothing when nothing is selected
        apply_ui_action(&mut state, UiAction::ChatToolToggleExpanded);
        assert!(!state.chat_tool_expanded);
    }

    #[test]
    fn chat_tool_selection_empty_list_no_crash() {
        let mut state = AppState::new_with_paths(None, None);

        // No completed tools - these should be no-ops
        apply_ui_action(&mut state, UiAction::ChatToolNext);
        assert_eq!(state.chat_selected_tool_idx, None);

        apply_ui_action(&mut state, UiAction::ChatToolPrev);
        assert_eq!(state.chat_selected_tool_idx, None);
    }

    #[test]
    fn chat_tool_open_details_requires_selection() {
        let mut state = AppState::new_with_paths(None, None);

        // No selection - open details does nothing
        assert_eq!(state.chat_selected_tool_idx, None);
        assert!(!state.tool_details_overlay_open);

        apply_ui_action(&mut state, UiAction::ChatToolOpenDetails);
        assert!(!state.tool_details_overlay_open);
    }

    #[test]
    fn chat_tool_open_details_opens_overlay_with_selection() {
        use crate::app::activity;

        let mut state = AppState::new_with_paths(None, None);

        // Add some completed tool calls
        activity::upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("file.read".to_string()),
            Some("completed".to_string()),
            serde_json::json!({"path": "/tmp/file.txt"}),
            Some(serde_json::json!({"content": "file contents"})),
            None,
            None,
            None,
        );

        // Select a tool
        apply_ui_action(&mut state, UiAction::ChatToolNext);
        assert_eq!(state.chat_selected_tool_idx, Some(0));
        assert!(!state.tool_details_overlay_open);
        assert_eq!(state.tool_details_overlay_scroll, 0);

        // Open details overlay
        apply_ui_action(&mut state, UiAction::ChatToolOpenDetails);
        assert!(state.tool_details_overlay_open);
        assert_eq!(state.tool_details_overlay_scroll, 0);
    }
}
