use crate::app::reducer::{decide_permission, Outbound};
use crate::app::{AppState, ChatMessage, Role};
use serde_json::json;

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
    KillToEnd,      // Ctrl+K
    KillToStart,    // Ctrl+U
    KillWordBack,   // Ctrl+W
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

    ToggleMultilineInput,
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

    OpenPalette,
    CloseOverlay,
    ToggleHelp,
    PaletteChar(char),
    PaletteBackspace,
    PalettePrev,
    PaletteNext,
    PaletteSubmit,

    SlashPickerOpen,
    SlashPickerClose,
    SlashPickerPrev,
    SlashPickerNext,
    SlashPickerSelect,

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
}

pub fn apply_ui_action(state: &mut AppState, action: UiAction) -> Vec<Outbound> {
    match action {
        UiAction::InputChar(ch) => {
            // Open slash picker when / is typed as first character
            if ch == '/' && state.input_buffer.is_empty() && !state.slash_commands.is_empty() {
                state.input_buffer.insert(state.input_cursor, ch);
                state.input_cursor += ch.len_utf8();
                state.slash_picker_open = true;
                state.slash_picker_selected = 0;
            } else {
                state.input_buffer.insert(state.input_cursor, ch);
                state.input_cursor += ch.len_utf8();
            }
            Vec::new()
        }
        UiAction::Backspace => {
            if state.input_cursor > 0 {
                // Find the previous character boundary
                let prev_boundary = state.input_buffer[..state.input_cursor]
                    .char_indices()
                    .last()
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                state.input_buffer.remove(prev_boundary);
                state.input_cursor = prev_boundary;
            }
            Vec::new()
        }
        UiAction::Delete => {
            if state.input_cursor < state.input_buffer.len() {
                state.input_buffer.remove(state.input_cursor);
            }
            Vec::new()
        }
        UiAction::CursorLeft => {
            if state.input_cursor > 0 {
                // Find the previous character boundary
                state.input_cursor = state.input_buffer[..state.input_cursor]
                    .char_indices()
                    .last()
                    .map(|(i, _)| i)
                    .unwrap_or(0);
            }
            Vec::new()
        }
        UiAction::CursorRight => {
            if state.input_cursor < state.input_buffer.len() {
                // Find the next character boundary
                state.input_cursor = state.input_buffer[state.input_cursor..]
                    .char_indices()
                    .nth(1)
                    .map(|(i, _)| state.input_cursor + i)
                    .unwrap_or(state.input_buffer.len());
            }
            Vec::new()
        }
        UiAction::CursorUp => {
            // Move cursor up one line, trying to maintain column position
            let before = &state.input_buffer[..state.input_cursor];
            let current_line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);

            if current_line_start == 0 {
                // Already on first line, can't go up
                return Vec::new();
            }

            // Column position in current line (in chars, not bytes)
            let col = before[current_line_start..].chars().count();

            // Find start of previous line
            let prev_line_end = current_line_start - 1; // position of the newline
            let prev_line_start = state.input_buffer[..prev_line_end]
                .rfind('\n')
                .map(|i| i + 1)
                .unwrap_or(0);

            // Move to same column in previous line (or end if line is shorter)
            let prev_line = &state.input_buffer[prev_line_start..prev_line_end];
            let prev_line_len = prev_line.chars().count();
            let target_col = col.min(prev_line_len);

            // Convert char position to byte position
            state.input_cursor = prev_line_start
                + prev_line
                    .char_indices()
                    .nth(target_col)
                    .map(|(i, _)| i)
                    .unwrap_or(prev_line.len());

            Vec::new()
        }
        UiAction::CursorDown => {
            // Move cursor down one line, trying to maintain column position
            let before = &state.input_buffer[..state.input_cursor];
            let current_line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);

            // Find end of current line
            let current_line_end = state.input_buffer[state.input_cursor..]
                .find('\n')
                .map(|i| state.input_cursor + i);

            let Some(line_end) = current_line_end else {
                // Already on last line, can't go down
                return Vec::new();
            };

            // Column position in current line (in chars, not bytes)
            let col = before[current_line_start..].chars().count();

            // Find end of next line
            let next_line_start = line_end + 1;
            let next_line_end = state.input_buffer[next_line_start..]
                .find('\n')
                .map(|i| next_line_start + i)
                .unwrap_or(state.input_buffer.len());

            // Move to same column in next line (or end if line is shorter)
            let next_line = &state.input_buffer[next_line_start..next_line_end];
            let next_line_len = next_line.chars().count();
            let target_col = col.min(next_line_len);

            // Convert char position to byte position
            state.input_cursor = next_line_start
                + next_line
                    .char_indices()
                    .nth(target_col)
                    .map(|(i, _)| i)
                    .unwrap_or(next_line.len());

            Vec::new()
        }
        UiAction::CursorHome => {
            // Move to start of current line
            state.input_cursor = state.input_buffer[..state.input_cursor]
                .rfind('\n')
                .map(|i| i + 1)
                .unwrap_or(0);
            Vec::new()
        }
        UiAction::CursorEnd => {
            // Move to end of current line
            state.input_cursor = state.input_buffer[state.input_cursor..]
                .find('\n')
                .map(|i| state.input_cursor + i)
                .unwrap_or(state.input_buffer.len());
            Vec::new()
        }
        UiAction::KillToEnd => {
            // Ctrl+K: kill from cursor to end of line
            let line_end = state.input_buffer[state.input_cursor..]
                .find('\n')
                .map(|i| state.input_cursor + i)
                .unwrap_or(state.input_buffer.len());
            state.input_buffer.drain(state.input_cursor..line_end);
            Vec::new()
        }
        UiAction::KillToStart => {
            // Ctrl+U: kill from cursor to start of line
            let line_start = state.input_buffer[..state.input_cursor]
                .rfind('\n')
                .map(|i| i + 1)
                .unwrap_or(0);
            state.input_buffer.drain(line_start..state.input_cursor);
            state.input_cursor = line_start;
            Vec::new()
        }
        UiAction::KillWordBack => {
            // Ctrl+W: kill word backward
            if state.input_cursor > 0 {
                let before = &state.input_buffer[..state.input_cursor];
                // Skip trailing whitespace
                let trimmed_end = before.trim_end().len();
                // Find start of word
                let word_start = before[..trimmed_end]
                    .rfind(|c: char| c.is_whitespace())
                    .map(|i| i + 1)
                    .unwrap_or(0);
                state.input_buffer.drain(word_start..state.input_cursor);
                state.input_cursor = word_start;
            }
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
            state.input_cursor = state.input_buffer.len();
            Vec::new()
        }
        UiAction::HistoryNext => {
            let Some(i) = state.input_history_index else {
                return Vec::new();
            };

            if i + 1 >= state.input_history.len() {
                state.input_history_index = None;
                state.input_buffer.clear();
                state.input_cursor = 0;
            } else {
                let next = i + 1;
                state.input_history_index = Some(next);
                state.input_buffer = state.input_history[next].clone();
                state.input_cursor = state.input_buffer.len();
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
        UiAction::ToggleMultilineInput => {
            state.prefs.input_multiline = !state.prefs.input_multiline;
            state.input_scroll = 0;
            let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);
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
        UiAction::Enter => {
            if state.prefs.input_multiline {
                state.input_buffer.push('\n');
                Vec::new()
            } else {
                send_input(state)
            }
        }
        UiAction::InsertNewline => {
            // Always insert a newline at cursor position
            state.input_buffer.insert(state.input_cursor, '\n');
            state.input_cursor += 1;
            Vec::new()
        }
        UiAction::PasteText(text) => {
            // Insert pasted text at cursor position without triggering submit
            state.input_buffer.insert_str(state.input_cursor, &text);
            state.input_cursor += text.len();
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
        UiAction::ConnectionsCredentialsStatus => crate::app::connections::request_credentials_status(state),
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
        UiAction::ConnectionsModelsRefresh => crate::app::connections::request_models_refresh(state),
        UiAction::ConnectionsModelsClose => {
            crate::app::connections::close_models(state);
            Vec::new()
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
                Focus::Chat => {
                    state.chat_follow = false;
                    state.chat_scroll = state.chat_scroll.saturating_sub(1);
                }
                Focus::Activity => state.activity_scroll = state.activity_scroll.saturating_sub(1),
                Focus::Debug => state.debug_scroll = state.debug_scroll.saturating_sub(1),
                Focus::Input => {
                    if state.prefs.input_multiline {
                        state.input_scroll = state.input_scroll.saturating_sub(1);
                    }
                }
            }
            Vec::new()
        }
        UiAction::ScrollDown => {
            use crate::app::Focus;
            match state.focus {
                Focus::Chat => {
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
                Focus::Input => {
                    if state.prefs.input_multiline {
                        state.input_scroll = state.input_scroll.saturating_add(1);
                    }
                }
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
            let items = palette_items(&state.palette_query);
            let max = items.len().saturating_sub(1);
            state.palette_selected = (state.palette_selected.saturating_add(1)).min(max);
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
                PaletteCommand::ToggleMultilineInput => {
                    let _ = apply_ui_action(state, UiAction::ToggleMultilineInput);
                }
                PaletteCommand::ThemeDark => {
                    let _ =
                        apply_ui_action(state, UiAction::SetTheme(crate::app::prefs::Theme::Dark));
                }
                PaletteCommand::ThemeLight => {
                    let _ =
                        apply_ui_action(state, UiAction::SetTheme(crate::app::prefs::Theme::Light));
                }
                PaletteCommand::ThemeHighContrast => {
                    let _ = apply_ui_action(
                        state,
                        UiAction::SetTheme(crate::app::prefs::Theme::HighContrast),
                    );
                }
                PaletteCommand::KeybindDefault => {
                    let _ = apply_ui_action(
                        state,
                        UiAction::SetKeybindMode(crate::app::prefs::KeybindMode::Default),
                    );
                }
                PaletteCommand::KeybindVim => {
                    let _ = apply_ui_action(
                        state,
                        UiAction::SetKeybindMode(crate::app::prefs::KeybindMode::Vim),
                    );
                }
                PaletteCommand::OpenEnvEditorCmd => {
                    let _ = apply_ui_action(state, UiAction::OpenEnvEditor);
                }
                PaletteCommand::OpenConnectionsCmd => {
                    let out_connections = apply_ui_action(state, UiAction::OpenConnections);
                    out.extend(out_connections);
                }
                PaletteCommand::McpServers => {
                    let out_mcp = apply_ui_action(state, UiAction::OpenMcpPanel);
                    out.extend(out_mcp);
                }
                PaletteCommand::ContextViewer => {
                    let out_context = apply_ui_action(state, UiAction::OpenContextViewer);
                    out.extend(out_context);
                }
                PaletteCommand::CompactContext => {
                    let id = state.next_client_id();
                    state.push_activity_line("Compacting context...".to_string());
                    out.push(Outbound::JsonRpcRequest {
                        id,
                        method: "ent/session/compact".to_string(),
                        params: Some(json!({})),
                    });
                }
                PaletteCommand::Quit => {
                    state.should_exit = true;
                }
            }
            state.palette_open = false;
            out
        }
        UiAction::PermissionPrev => {
            if state.active_permission.is_some() {
                state.active_permission_selected =
                    state.active_permission_selected.saturating_sub(1);
            }
            Vec::new()
        }
        UiAction::PermissionNext => {
            if let Some(req) = &state.active_permission {
                // Max is options.len() to include the guidance row as the last selectable item
                let max = req.options.len();
                state.active_permission_selected = (state.active_permission_selected + 1).min(max);
            }
            Vec::new()
        }
        UiAction::PermissionSubmit => {
            let Some(req) = state.active_permission.take() else {
                return Vec::new();
            };

            let has_guidance = !state.permission_guidance_input.is_empty();

            // When guidance is provided, always deny (guidance = "no, do this instead")
            // When guidance row is selected (index == options.len()), default to first option
            let decision = if has_guidance {
                // Find a deny option, or fall back to "deny" string
                req.options
                    .iter()
                    .find(|o| o.option_id.to_lowercase().contains("deny"))
                    .map(|o| o.option_id.clone())
                    .unwrap_or_else(|| "deny".to_string())
            } else {
                let selected_idx = if state.active_permission_selected >= req.options.len() {
                    0
                } else {
                    state.active_permission_selected
                };
                req.options
                    .get(selected_idx)
                    .map(|o| o.option_id.clone())
                    .unwrap_or_default()
            };

            if decision.is_empty() {
                state.push_debug_line("permission: no options available".to_string());
                return Vec::new();
            }

            // Only remember decisions when not providing guidance (guidance = rejection)
            if !has_guidance && should_remember_permission_decision(&decision) {
                if let Some(key) = crate::app::reducer::permission_allow_key(&req) {
                    state.permission_allowlist.insert(key, decision.clone());
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
                    // This way the agent gets: 1) permission denied, 2) guidance as user input
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
                            params: Some(json!({ "content": [ { "type": "text", "text": guidance_text } ] })),
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
            let Some(req) = state.active_permission.clone() else {
                return Vec::new();
            };
            let Some((idx, _)) = req
                .options
                .iter()
                .enumerate()
                .find(|(_, o)| o.option_id.to_lowercase().contains("deny"))
            else {
                return Vec::new();
            };
            state.active_permission_selected = idx;
            apply_ui_action(state, UiAction::PermissionSubmit)
        }
        UiAction::PermissionGuidanceChar(ch) => {
            state.permission_guidance_input.push(ch);
            Vec::new()
        }
        UiAction::PermissionGuidanceBackspace => {
            state.permission_guidance_input.pop();
            Vec::new()
        }
        UiAction::SlashPickerOpen => {
            if !state.slash_commands.is_empty() {
                state.slash_picker_open = true;
                state.slash_picker_selected = 0;
            }
            Vec::new()
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
            let selected_cmd = filtered
                .get(state.slash_picker_selected)
                .map(|cmd| (cmd.name.clone(), cmd.input_hint.is_some()));
            drop(filtered);

            if let Some((name, has_hint)) = selected_cmd {
                state.input_buffer = format!("/{}", name);
                if has_hint {
                    state.input_buffer.push(' ');
                }
                state.input_cursor = state.input_buffer.len();
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
    }
}

/// Returns slash commands filtered by current input (after the `/`)
fn filtered_slash_commands(state: &AppState) -> Vec<&crate::app::SlashCommand> {
    let query = state
        .input_buffer
        .strip_prefix('/')
        .unwrap_or("")
        .to_lowercase();
    state
        .slash_commands
        .iter()
        .filter(|cmd| {
            if query.is_empty() {
                true
            } else {
                cmd.name.to_lowercase().contains(&query)
                    || cmd.description.to_lowercase().contains(&query)
            }
        })
        .collect()
}

fn should_remember_permission_decision(decision: &str) -> bool {
    let d = decision.to_lowercase();
    d.contains("allow") && d.contains("session")
}

fn send_input(state: &mut AppState) -> Vec<Outbound> {
    let line = state.input_buffer.trim_end().to_string();
    let images = std::mem::take(&mut state.pending_images);
    state.input_buffer.clear();
    state.input_cursor = 0;
    state.input_scroll = 0;
    state.input_history_index = None;
    state.chat_follow = true;

    if line.is_empty() && images.is_empty() {
        return Vec::new();
    }

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaletteCommand {
    NewSession,
    Configure,
    Sessions,
    ToggleMultilineInput,
    ThemeDark,
    ThemeLight,
    ThemeHighContrast,
    KeybindDefault,
    KeybindVim,
    OpenEnvEditorCmd,
    OpenConnectionsCmd,
    McpServers,
    ContextViewer,
    CompactContext,
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
            label: "Toggle Multiline Input",
            command: PaletteCommand::ToggleMultilineInput,
        },
        PaletteItem {
            label: "Theme: Dark",
            command: PaletteCommand::ThemeDark,
        },
        PaletteItem {
            label: "Theme: Light",
            command: PaletteCommand::ThemeLight,
        },
        PaletteItem {
            label: "Theme: High Contrast",
            command: PaletteCommand::ThemeHighContrast,
        },
        PaletteItem {
            label: "Keybinds: Default",
            command: PaletteCommand::KeybindDefault,
        },
        PaletteItem {
            label: "Keybinds: Vim",
            command: PaletteCommand::KeybindVim,
        },
        PaletteItem {
            label: "Environment...",
            command: PaletteCommand::OpenEnvEditorCmd,
        },
        PaletteItem {
            label: "Connections...",
            command: PaletteCommand::OpenConnectionsCmd,
        },
        PaletteItem {
            label: "MCP Servers...",
            command: PaletteCommand::McpServers,
        },
        PaletteItem {
            label: "Context Usage...",
            command: PaletteCommand::ContextViewer,
        },
        PaletteItem {
            label: "Compact Context...",
            command: PaletteCommand::CompactContext,
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
    all.into_iter()
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
    use crate::app::prefs::{KeybindMode, Theme};
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
    fn permission_submit_with_guidance_denies_and_sends_prompt() {
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
        // Even with "allow" selected, guidance should cause denial
        state.active_permission_selected = 0;
        state.permission_guidance_input = "be careful with output".to_string();

        let out = apply_ui_action(&mut state, UiAction::PermissionSubmit);
        // Should produce 2 outputs: deny response + prompt request
        assert_eq!(out.len(), 2);
        assert!(state.active_permission.is_none());
        // Guidance should be cleared after submission
        assert!(state.permission_guidance_input.is_empty());

        // First output: plain deny (no guidance field)
        match &out[0] {
            Outbound::JsonRpcResponse { id, result } => {
                assert_eq!(id, &json!("a_1"));
                assert_eq!(result, &json!({"decision":"deny"}));
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

        // Navigate to the guidance row (index 2, which is options.len())
        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 2);

        // Should not go past guidance row
        apply_ui_action(&mut state, UiAction::PermissionNext);
        assert_eq!(state.active_permission_selected, 2);
    }

    #[test]
    fn permission_submit_from_guidance_row_denies_and_sends_prompt() {
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
        // Select guidance row (index 2)
        state.active_permission_selected = 2;
        state.permission_guidance_input = "test guidance".to_string();

        let out = apply_ui_action(&mut state, UiAction::PermissionSubmit);
        // Should produce 2 outputs: deny response + prompt request
        assert_eq!(out.len(), 2);

        // First output: plain deny (no guidance field)
        match &out[0] {
            Outbound::JsonRpcResponse { id, result } => {
                assert_eq!(id, &json!("a_1"));
                assert_eq!(result, &json!({"decision":"deny"}));
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
        // Select guidance row (index 2) but no guidance text
        state.active_permission_selected = 2;
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
    fn palette_filters_and_submits() {
        let mut state = AppState::new_with_paths(None, None);
        apply_ui_action(&mut state, UiAction::OpenPalette);
        apply_ui_action(&mut state, UiAction::PaletteChar('q'));
        apply_ui_action(&mut state, UiAction::PaletteSubmit);
        assert!(state.should_exit);
    }

    #[test]
    fn multiline_enter_inserts_newline_and_ctrl_enter_sends() {
        let mut state = AppState::new_with_paths(None, None);
        state.next_client_seq = 3;
        state.prefs.input_multiline = true;
        state.input_buffer = "a".to_string();

        let out = apply_ui_action(&mut state, UiAction::Enter);
        assert!(out.is_empty());
        assert_eq!(state.input_buffer, "a\n");

        state.input_buffer.push_str("b");
        let out = apply_ui_action(&mut state, UiAction::SendInput);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn palette_new_session_emits_request() {
        let mut state = AppState::new_with_paths(None, None);
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
        state.input_buffer = "hello".to_string();
        state.input_cursor = 5;

        // Move left
        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(state.input_cursor, 4);

        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(state.input_cursor, 3);

        // Move right
        apply_ui_action(&mut state, UiAction::CursorRight);
        assert_eq!(state.input_cursor, 4);

        // Move left to beginning
        apply_ui_action(&mut state, UiAction::CursorLeft);
        apply_ui_action(&mut state, UiAction::CursorLeft);
        apply_ui_action(&mut state, UiAction::CursorLeft);
        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(state.input_cursor, 0);

        // Can't go past beginning
        apply_ui_action(&mut state, UiAction::CursorLeft);
        assert_eq!(state.input_cursor, 0);
    }

    #[test]
    fn cursor_home_end() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "line1\nline2\nline3".to_string();
        state.input_cursor = 8; // middle of "line2"

        // Home goes to start of current line
        apply_ui_action(&mut state, UiAction::CursorHome);
        assert_eq!(state.input_cursor, 6); // start of "line2"

        // End goes to end of current line
        apply_ui_action(&mut state, UiAction::CursorEnd);
        assert_eq!(state.input_cursor, 11); // end of "line2" (before \n)

        // Move to first line and test
        state.input_cursor = 2;
        apply_ui_action(&mut state, UiAction::CursorHome);
        assert_eq!(state.input_cursor, 0);

        apply_ui_action(&mut state, UiAction::CursorEnd);
        assert_eq!(state.input_cursor, 5); // end of "line1"
    }

    #[test]
    fn cursor_up_down_multiline() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "line1\nline2\nline3".to_string();
        state.input_cursor = 8; // middle of "line2" (col 2)

        // Move up maintains column
        apply_ui_action(&mut state, UiAction::CursorUp);
        assert_eq!(state.input_cursor, 2); // col 2 of "line1"

        // Can't go up from first line
        apply_ui_action(&mut state, UiAction::CursorUp);
        assert_eq!(state.input_cursor, 2); // stays at col 2 of "line1"

        // Move down
        state.input_cursor = 8; // back to middle of "line2"
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(state.input_cursor, 14); // col 2 of "line3"

        // Can't go down from last line
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(state.input_cursor, 14); // stays at col 2 of "line3"
    }

    #[test]
    fn cursor_up_down_short_lines() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "long line here\nhi\nx".to_string();
        state.input_cursor = 10; // col 10 of first line

        // Move down to shorter line - cursor goes to end
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(state.input_cursor, 17); // end of "hi" (which is at byte 15+2=17)

        // Move down again - goes to end of "x"
        apply_ui_action(&mut state, UiAction::CursorDown);
        assert_eq!(state.input_cursor, 19); // end of "x"
    }

    #[test]
    fn kill_to_end_and_start() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "hello world".to_string();
        state.input_cursor = 6; // at 'w'

        // Kill to end (Ctrl+K)
        apply_ui_action(&mut state, UiAction::KillToEnd);
        assert_eq!(state.input_buffer, "hello ");
        assert_eq!(state.input_cursor, 6);

        // Reset
        state.input_buffer = "hello world".to_string();
        state.input_cursor = 6;

        // Kill to start (Ctrl+U)
        apply_ui_action(&mut state, UiAction::KillToStart);
        assert_eq!(state.input_buffer, "world");
        assert_eq!(state.input_cursor, 0);
    }

    #[test]
    fn kill_word_back() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "hello world foo".to_string();
        state.input_cursor = 15; // at end

        // Kill word back (Ctrl+W)
        apply_ui_action(&mut state, UiAction::KillWordBack);
        assert_eq!(state.input_buffer, "hello world ");
        assert_eq!(state.input_cursor, 12);

        apply_ui_action(&mut state, UiAction::KillWordBack);
        assert_eq!(state.input_buffer, "hello ");
        assert_eq!(state.input_cursor, 6);
    }

    #[test]
    fn insert_and_delete_at_cursor() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "helo".to_string();
        state.input_cursor = 3; // after "hel"

        // Insert at cursor
        apply_ui_action(&mut state, UiAction::InputChar('l'));
        assert_eq!(state.input_buffer, "hello");
        assert_eq!(state.input_cursor, 4);

        // Delete at cursor
        state.input_cursor = 2; // at first 'l'
        apply_ui_action(&mut state, UiAction::Delete);
        assert_eq!(state.input_buffer, "helo");
        assert_eq!(state.input_cursor, 2);

        // Backspace
        apply_ui_action(&mut state, UiAction::Backspace);
        assert_eq!(state.input_buffer, "hlo");
        assert_eq!(state.input_cursor, 1);
    }

    #[test]
    fn paste_text_at_cursor() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "hello world".to_string();
        state.input_cursor = 6; // at 'w'

        apply_ui_action(&mut state, UiAction::PasteText("beautiful ".to_string()));
        assert_eq!(state.input_buffer, "hello beautiful world");
        assert_eq!(state.input_cursor, 16); // after pasted text
    }

    #[test]
    fn insert_newline_at_cursor() {
        let mut state = AppState::new_with_paths(None, None);
        state.input_buffer = "hello world".to_string();
        state.input_cursor = 5; // after "hello"

        apply_ui_action(&mut state, UiAction::InsertNewline);
        assert_eq!(state.input_buffer, "hello\n world");
        assert_eq!(state.input_cursor, 6); // after newline
    }
}
