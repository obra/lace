mod markdown;
pub mod theme;

use crate::app::activity;
use crate::app::config_wizard;
use crate::app::connections;
use crate::app::prefs::{KeybindMode, Theme};
use crate::app::reducer::{reduce, AppEvent, Outbound};
use crate::app::sessions;
use crate::app::ui::{apply_ui_action, palette_labels, UiAction};
use crate::app::AppState;
use crate::app::{Focus, Role};
use crate::args::Args;
use crate::protocol::bootstrap::bootstrap_session;
use crate::protocol::transport::AgentTransport;
use crate::protocol::{ent, jsonrpc};
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::{execute, terminal};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use ratatui::Terminal;
use serde_json::Value;
use std::io;
use std::path::PathBuf;
use std::time::Duration;

/// Returns an animated spinner character based on the current time.
/// The spinner cycles through a set of braille characters every 100ms.
fn spinning_char() -> char {
    const SPINNER: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let idx = ((ms / 100) % SPINNER.len() as u128) as usize;
    SPINNER[idx]
}

pub fn run_tui(args: Args) -> io::Result<()> {
    let workdir = resolve_workdir(args.workdir.as_deref())?;
    let agent_cmd = args
        .agent_cmd
        .unwrap_or_else(|| default_agent_cmd().unwrap_or_else(|| "lace-agent".to_string()));

    let transport = AgentTransport::spawn_shell(&agent_cmd, &workdir)?;
    let bootstrap_result =
        bootstrap_session(&transport, &workdir, args.load_session_id.as_deref())?;

    let mut state = AppState::new();
    state.session_id = Some(bootstrap_result.session_id);
    state.slash_commands = bootstrap_result.slash_commands;
    state.workdir = workdir.to_string_lossy().to_string();
    state.next_client_seq = 3;
    state.push_activity_line(format!("timeout-ms={}", args.timeout_ms));

    if let Some(dir) = resolve_tui_dir_for_logs() {
        state.push_debug_line(format!("{dir}/tui-ent-protocol.log"));
        state.push_debug_line(format!("{dir}/tui-agent-stderr.log"));
    }

    // Probe catalogs early; surface missing providers immediately in Debug/Activity
    let probe_id = state.next_client_id();
    let probe_req = Outbound::JsonRpcRequest {
        id: probe_id.clone(),
        method: "ent/providers/list".to_string(),
        params: Some(serde_json::json!({})),
    };
    send_outbound(&transport, &mut state, vec![probe_req], args.timeout_ms)?;

    // Best-effort: populate conn/model in the status bar when supported by the agent.
    let status_req = vec![Outbound::JsonRpcRequest {
        id: state.next_client_id(),
        method: "ent/agent/status".to_string(),
        params: Some(serde_json::json!({})),
    }];
    send_outbound(&transport, &mut state, status_req, args.timeout_ms)?;

    // Discover existing connections; once we know a ready connection exists we may auto-configure.
    let connections_req = vec![Outbound::JsonRpcRequest {
        id: state.next_client_id(),
        method: "ent/connections/list".to_string(),
        params: Some(serde_json::json!({})),
    }];
    send_outbound(&transport, &mut state, connections_req, args.timeout_ms)?;

    let mut terminal = TerminalGuard::init()?;
    let res = run_loop(
        &mut terminal.terminal,
        &transport,
        &mut state,
        args.timeout_ms,
    );
    terminal.restore()?;
    res
}

fn remap_key_code(
    mode: KeybindMode,
    focus: Focus,
    code: KeyCode,
    modifiers: KeyModifiers,
) -> KeyCode {
    if mode != KeybindMode::Vim {
        return code;
    }
    if focus == Focus::Input {
        return code;
    }
    if modifiers.contains(KeyModifiers::CONTROL) {
        return code;
    }

    match code {
        KeyCode::Char('j') => KeyCode::Down,
        KeyCode::Char('k') => KeyCode::Up,
        _ => code,
    }
}

fn is_help_toggle_key(code: KeyCode, modifiers: KeyModifiers) -> bool {
    code == KeyCode::F(1) && modifiers.is_empty()
}

fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    transport: &AgentTransport,
    state: &mut AppState,
    timeout_ms: u64,
) -> io::Result<()> {
    loop {
        expire_timeouts(state, now_ms());

        while let Ok(line) = transport.try_recv_line() {
            handle_agent_line(transport, state, &line, timeout_ms)?;
        }
        while let Ok(line) = transport.try_recv_stderr_line() {
            state.push_debug_line(format!("agent stderr: {line}"));
        }
        state.activate_next_permission_if_needed();

        if let Ok(size) = terminal.size() {
            update_chat_autoscroll(
                state,
                ratatui::layout::Rect::new(0, 0, size.width, size.height),
            );
        }
        terminal.draw(|f| draw(f, state))?;

        if event::poll(Duration::from_millis(50))? {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    if key.modifiers.contains(KeyModifiers::CONTROL)
                        && key.code == KeyCode::Char('c')
                    {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;

                        // If we have active streaming requests, cancel them
                        if !state.active_prompt_request_ids.is_empty() {
                            // Clone IDs first to avoid borrow issues
                            let req_ids: Vec<_> =
                                state.active_prompt_request_ids.iter().cloned().collect();
                            // Send cancel for each active request
                            for req_id in req_ids {
                                let cancel_msg = jsonrpc::encode_notification(
                                    "$/cancel_request",
                                    Some(serde_json::json!({ "requestId": req_id })),
                                );
                                if let Err(e) = transport.send_line(cancel_msg) {
                                    state.push_debug_line(format!("cancel send error: {e}"));
                                }
                            }
                            state.push_activity_line("Cancelled active request".to_string());
                            // Mark messages as interrupted if streaming
                            if let Some(msg) = state.messages.last_mut() {
                                if msg.streaming {
                                    msg.streaming = false;
                                    if !msg.text.ends_with('\n') {
                                        msg.text.push('\n');
                                    }
                                    msg.text.push_str("✗ Interrupted");
                                }
                            }
                            state.active_prompt_request_ids.clear();
                            state.last_ctrl_c_ms = None;
                            continue;
                        }

                        // Double Ctrl+C to quit when idle
                        let double_press_window_ms = 500;
                        if let Some(last_ms) = state.last_ctrl_c_ms {
                            if now_ms - last_ms < double_press_window_ms {
                                // Double press - quit
                                break;
                            }
                        }
                        state.last_ctrl_c_ms = Some(now_ms);
                        state.push_activity_line("Press Ctrl+C again to quit".to_string());
                        continue;
                    }

                    if let Some(req) = &state.active_permission {
                        let options_count = req.options.len();
                        let guidance_selected = state.active_permission_selected == options_count;

                        let action = if guidance_selected {
                            // When guidance row is selected, handle typing
                            match key.code {
                                KeyCode::Up => Some(UiAction::PermissionPrev),
                                KeyCode::Down => Some(UiAction::PermissionNext),
                                KeyCode::Enter => Some(UiAction::PermissionSubmit),
                                KeyCode::Esc => Some(UiAction::PermissionCancel),
                                KeyCode::Backspace => Some(UiAction::PermissionGuidanceBackspace),
                                KeyCode::Char(ch) => Some(UiAction::PermissionGuidanceChar(ch)),
                                _ => None,
                            }
                        } else {
                            match key.code {
                                KeyCode::Up => Some(UiAction::PermissionPrev),
                                KeyCode::Down => Some(UiAction::PermissionNext),
                                KeyCode::Enter => Some(UiAction::PermissionSubmit),
                                KeyCode::Esc => Some(UiAction::PermissionCancel),
                                _ => None,
                            }
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        continue;
                    }

                    if state.env_editor.open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::CloseEnvEditor),
                            KeyCode::Up => Some(UiAction::EnvPrev),
                            KeyCode::Down => Some(UiAction::EnvNext),
                            KeyCode::Enter => Some(UiAction::EnvSaveEntry),
                            KeyCode::Backspace => Some(UiAction::EnvBackspace),
                            KeyCode::Char('d') => Some(UiAction::EnvDelete),
                            KeyCode::Char('s') => Some(UiAction::EnvApply),
                            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                Some(UiAction::EnvChar(ch))
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        continue;
                    }

                    if state.connections.models.open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::ConnectionsModelsClose),
                            KeyCode::Up => Some(UiAction::ConnectionsModelsPrev),
                            KeyCode::Down => Some(UiAction::ConnectionsModelsNext),
                            KeyCode::Char('r') => Some(UiAction::ConnectionsModelsRefresh),
                            KeyCode::Enter => Some(UiAction::ConnectionsModelsToggle),
                            KeyCode::Char(' ') => Some(UiAction::ConnectionsModelsToggle),
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        continue;
                    }

                    if state.connections.open {
                        let action = match key.code {
                            KeyCode::Esc => {
                                if state.connections.confirm_delete {
                                    Some(UiAction::ConnectionsCancelDelete)
                                } else if state.connections.confirm_clear_credentials {
                                    Some(UiAction::ConnectionsCancelClearCredentials)
                                } else {
                                    Some(UiAction::ConnectionsClose)
                                }
                            }
                            KeyCode::Up => Some(UiAction::ConnectionsPrev),
                            KeyCode::Down => Some(UiAction::ConnectionsNext),
                            KeyCode::Enter => Some(UiAction::ConnectionsSubmit),
                            KeyCode::Char('r') => Some(UiAction::ConnectionsRefresh),
                            KeyCode::Char('e') => Some(UiAction::ConnectionsStartRename),
                            KeyCode::Char('d') => Some(UiAction::ConnectionsBeginDelete),
                            KeyCode::Char('t') => Some(UiAction::ConnectionsTest),
                            KeyCode::Char('s') => Some(UiAction::ConnectionsCredentialsStatus),
                            KeyCode::Char('k') => Some(UiAction::ConnectionsBeginClearCredentials),
                            KeyCode::Char('m') => Some(UiAction::ConnectionsOpenModels),
                            KeyCode::Char('c') => {
                                connections::close_connections(state);
                                let out = config_wizard::open(state);
                                send_outbound(transport, state, out, timeout_ms)?;
                                continue;
                            }
                            KeyCode::Backspace if state.connections.renaming => {
                                Some(UiAction::ConnectionsRenameBackspace)
                            }
                            KeyCode::Char(ch)
                                if state.connections.renaming
                                    && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                            {
                                Some(UiAction::ConnectionsRenameChar(ch))
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        if state.should_exit {
                            break;
                        }
                        continue;
                    }

                    if state.config_wizard.open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::ConfigWizardClose),
                            KeyCode::Up => Some(UiAction::ConfigWizardPrev),
                            KeyCode::Down => Some(UiAction::ConfigWizardNext),
                            KeyCode::Enter => Some(UiAction::ConfigWizardSubmit),
                            KeyCode::Backspace => Some(UiAction::ConfigWizardBackspace),
                            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                Some(UiAction::ConfigWizardChar(ch))
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        if state.should_exit {
                            break;
                        }
                        continue;
                    }

                    if state.sessions.open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::SessionsClose),
                            KeyCode::Up => Some(UiAction::SessionsPrev),
                            KeyCode::Down => Some(UiAction::SessionsNext),
                            KeyCode::Enter => Some(UiAction::SessionsSubmit),
                            KeyCode::Backspace => {
                                if state.sessions.renaming {
                                    Some(UiAction::SessionsRenameBackspace)
                                } else {
                                    Some(UiAction::SessionsQueryBackspace)
                                }
                            }
                            KeyCode::Char('r') if !state.sessions.renaming => {
                                Some(UiAction::SessionsStartRename)
                            }
                            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                if state.sessions.renaming {
                                    Some(UiAction::SessionsRenameChar(ch))
                                } else {
                                    Some(UiAction::SessionsQueryChar(ch))
                                }
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        if state.should_exit {
                            break;
                        }
                        continue;
                    }

                    if state.search.open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::CloseOverlay),
                            KeyCode::Up => Some(UiAction::SearchPrev),
                            KeyCode::Down => Some(UiAction::SearchNext),
                            KeyCode::Enter => Some(UiAction::SearchSubmit),
                            KeyCode::Backspace => Some(UiAction::SearchBackspace),
                            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                Some(UiAction::SearchChar(ch))
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        if state.should_exit {
                            break;
                        }
                        continue;
                    }

                    if state.debug_overlay_open {
                        match key.code {
                            KeyCode::Esc => {
                                state.debug_overlay_open = false;
                            }
                            KeyCode::Up | KeyCode::PageUp => {
                                state.debug_scroll = state.debug_scroll.saturating_sub(1);
                            }
                            KeyCode::Down | KeyCode::PageDown => {
                                state.debug_scroll = state.debug_scroll.saturating_add(1);
                            }
                            _ => {}
                        }
                        continue;
                    }

                    if state.activity_overlay_open {
                        match key.code {
                            KeyCode::Esc => {
                                state.activity_overlay_open = false;
                            }
                            KeyCode::Up | KeyCode::PageUp => {
                                state.activity_scroll = state.activity_scroll.saturating_sub(1);
                            }
                            KeyCode::Down | KeyCode::PageDown => {
                                state.activity_scroll = state.activity_scroll.saturating_add(1);
                            }
                            _ => {}
                        }
                        continue;
                    }

                    if state.help_open {
                        match key.code {
                            KeyCode::Esc => {
                                let _ = apply_ui_action(state, UiAction::ToggleHelp);
                            }
                            KeyCode::F(1) if is_help_toggle_key(key.code, key.modifiers) => {
                                let _ = apply_ui_action(state, UiAction::ToggleHelp);
                            }
                            _ => {}
                        }
                        if state.should_exit {
                            break;
                        }
                        continue;
                    }

                    if state.palette_open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::CloseOverlay),
                            KeyCode::Enter => Some(UiAction::PaletteSubmit),
                            KeyCode::Up => Some(UiAction::PalettePrev),
                            KeyCode::Down => Some(UiAction::PaletteNext),
                            KeyCode::Backspace => Some(UiAction::PaletteBackspace),
                            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                Some(UiAction::PaletteChar(ch))
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        if state.should_exit {
                            break;
                        }
                        continue;
                    }

                    // Slash command picker - shows when typing `/` commands
                    if state.slash_picker_open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::SlashPickerClose),
                            KeyCode::Enter | KeyCode::Tab => Some(UiAction::SlashPickerSelect),
                            KeyCode::Up => Some(UiAction::SlashPickerPrev),
                            KeyCode::Down => Some(UiAction::SlashPickerNext),
                            KeyCode::Backspace => {
                                // Backspace in picker: update input and close if no longer starts with /
                                state.input_buffer.pop();
                                if !state.input_buffer.starts_with('/') {
                                    state.slash_picker_open = false;
                                } else {
                                    // Re-filter and reset selection
                                    state.slash_picker_selected = 0;
                                }
                                None
                            }
                            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                // Type into input while picker is open
                                state.input_buffer.push(ch);
                                state.slash_picker_selected = 0;
                                // Close picker if space is typed (user is done with command name)
                                if ch == ' ' {
                                    state.slash_picker_open = false;
                                }
                                None
                            }
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        continue;
                    }

                    if key.modifiers.contains(KeyModifiers::CONTROL) {
                        match key.code {
                            KeyCode::Char('k') => {
                                let _ = apply_ui_action(state, UiAction::OpenPalette);
                                continue;
                            }
                            KeyCode::Char('f') => {
                                let _ = apply_ui_action(state, UiAction::OpenSearch);
                                continue;
                            }
                            KeyCode::Char('e') => {
                                let _ = apply_ui_action(state, UiAction::ToggleMultilineInput);
                                continue;
                            }
                            KeyCode::Char('d') => {
                                state.debug_overlay_open = !state.debug_overlay_open;
                                state.activity_overlay_open = false; // Close activity if opening debug
                                continue;
                            }
                            KeyCode::Char('a') => {
                                state.activity_overlay_open = !state.activity_overlay_open;
                                state.debug_overlay_open = false; // Close debug if opening activity
                                continue;
                            }
                            _ => {}
                        }
                    }

                    if is_help_toggle_key(key.code, key.modifiers) {
                        let _ = apply_ui_action(state, UiAction::ToggleHelp);
                        continue;
                    }

                    let code = remap_key_code(
                        state.prefs.keybind_mode,
                        state.focus,
                        key.code,
                        key.modifiers,
                    );
                    let action = match code {
                        KeyCode::Tab => Some(UiAction::FocusNext),
                        KeyCode::PageUp => Some(UiAction::ScrollUp),
                        KeyCode::PageDown => Some(UiAction::ScrollDown),
                        KeyCode::Up => match state.focus {
                            Focus::Input => Some(UiAction::HistoryPrev),
                            Focus::Activity => Some(UiAction::ActivityPrev),
                            _ => Some(UiAction::ScrollUp),
                        },
                        KeyCode::Down => match state.focus {
                            Focus::Input => Some(UiAction::HistoryNext),
                            Focus::Activity => Some(UiAction::ActivityNext),
                            _ => Some(UiAction::ScrollDown),
                        },
                        KeyCode::Enter => match state.focus {
                            Focus::Input
                                if state.prefs.input_multiline
                                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
                            {
                                Some(UiAction::SendInput)
                            }
                            Focus::Input => Some(UiAction::Enter),
                            Focus::Activity => Some(UiAction::ActivityToggleExpanded),
                            _ => None,
                        },
                        KeyCode::Backspace => match state.focus {
                            Focus::Input => Some(UiAction::Backspace),
                            _ => None,
                        },
                        KeyCode::Char('g')
                            if state.focus == Focus::Activity
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::ActivityJumpToTurn)
                        }
                        KeyCode::Char('y')
                            if state.focus == Focus::Activity
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::CopySelectedActivity)
                        }
                        KeyCode::Char('e')
                            if state.focus != Focus::Input
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::JumpLastError)
                        }
                        KeyCode::Char('t')
                            if state.focus != Focus::Input
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::JumpLastToolUse)
                        }
                        KeyCode::Char('n')
                            if state.focus != Focus::Input
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::JumpLastTurnEnd)
                        }
                        KeyCode::Char(ch)
                            if state.focus == Focus::Input
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::InputChar(ch))
                        }
                        _ => None,
                    };

                    if let Some(action) = action {
                        let out = apply_ui_action(state, action);
                        send_outbound(transport, state, out, timeout_ms)?;
                    }

                    if state.should_exit {
                        break;
                    }
                }
                Event::Resize(_, _) => {}
                _ => {}
            }
        }
    }

    Ok(())
}

fn send_outbound(
    transport: &AgentTransport,
    state: &mut AppState,
    out: Vec<Outbound>,
    timeout_ms: u64,
) -> io::Result<()> {
    for m in out {
        match m {
            Outbound::JsonRpcRequest { id, method, params } => {
                let params_clone = params.clone();
                let line = jsonrpc::encode_request(Value::String(id.clone()), &method, params_clone.clone());
                transport
                    .send_line(line)
                    .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
                activity::push_rpc_sent(state, method.clone());
                state.mark_request_sent(id, method, params_clone, now_ms(), timeout_ms);
            }
            Outbound::JsonRpcResponse { id, result } => {
                let line = jsonrpc::encode_response_result(id, result);
                transport
                    .send_line(line)
                    .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
                state.push_activity_line("permission: decided".to_string());
            }
        }
    }

    Ok(())
}

fn handle_agent_line(
    transport: &AgentTransport,
    state: &mut AppState,
    line: &str,
    timeout_ms: u64,
) -> io::Result<()> {
    state.last_activity_ms = Some(now_ms());
    let inbound = match jsonrpc::parse_inbound(line) {
        Ok(m) => m,
        Err(err) => {
            state.push_debug_line(format!("bad jsonrpc: {err}"));
            return Ok(());
        }
    };

    match inbound {
        jsonrpc::InboundMessage::Notification { method, params } => {
            if method == "session/update" {
                let params = params.unwrap_or(Value::Null);
                handle_session_update(state, &params);
            }
        }
        jsonrpc::InboundMessage::Request { id, method, params } => {
            if method == "session/update" {
                let params = params.unwrap_or(Value::Null);
                handle_session_update(state, &params);
                let _ = transport.send_line(jsonrpc::encode_response_result(id, Value::Null));
                return Ok(());
            }

            if method == "session/request_permission" {
                let params = params.unwrap_or(Value::Null);
                let req = ent::decode_permission_request(id, &params);

                if let Some(tool_call_id) = req.tool_call_id.clone() {
                    activity::attach_permission_details(
                        state,
                        tool_call_id,
                        req.tool.clone(),
                        req.kind.clone(),
                        req.resource.clone(),
                        None,
                    );
                }

                let out = reduce(state, AppEvent::PermissionRequested(req));
                if out.is_empty() {
                    state.push_activity_line("permission: requested".to_string());
                } else {
                    state.push_activity_line("permission: auto-decided".to_string());
                    send_outbound(transport, state, out, timeout_ms)?;
                }
                return Ok(());
            }

            let _ = transport.send_line(jsonrpc::encode_response_result(id, Value::Null));
        }
        jsonrpc::InboundMessage::Response { id, result, error } => {
            let mut should_refocus = false;
            let mut pending_method: Option<String> = None;
            let mut pending_params: Option<Value> = None;
            if let Some(id_str) = id.as_str() {
                should_refocus = state.active_prompt_request_ids.contains(id_str);
                if let Some(req) = state.take_pending_request(id_str) {
                    pending_params = req.params;
                    pending_method = Some(req.method);
                }
            }

            let error_message = error.as_ref().map(|e| e.message.as_str());
            let suppress_method_not_found =
                matches!(pending_method.as_deref(), Some("ent/agent/status"))
                    && error_message
                        .unwrap_or("")
                        .to_lowercase()
                        .contains("method not found");
            if let Some(err) = error.as_ref() {
                if !suppress_method_not_found {
                    let reason = err
                        .data
                        .as_ref()
                        .and_then(|d| d.get("reason"))
                        .and_then(|r| r.as_str())
                        .map(|s| s.to_string());
                let method_label = pending_method.clone().unwrap_or_else(|| "<unknown>".into());
                let mut dbg = format!(
                    "rpc error method={} code={} message={}",
                    method_label, err.code, err.message
                );
                if let Some(r) = reason.clone() {
                    dbg.push_str(&format!(" reason={r}"));
                }
                if let Some(params) = pending_params.clone() {
                    dbg.push_str(&format!(" params={}", params));
                }
                if method_label == "ent/providers/list" || method_label == "ent/models/list" {
                    state.push_activity_line(dbg.clone());
                }
                state.push_debug_line(dbg);
                activity::push_rpc_error(
                    state,
                    err.message.clone(),
                    Some(serde_json::to_value(err.clone()).unwrap_or(Value::Null)),
                    );
                }
            }

            let out = maybe_open_config_wizard_for_prompt_error(
                state,
                pending_method.as_deref(),
                error_message,
            );
            if !out.is_empty() {
                send_outbound(transport, state, out, timeout_ms)?;
            }

            // Extract token usage from session/prompt responses
            let usage_tokens = if pending_method.as_deref() == Some("session/prompt") {
                ent::extract_prompt_usage(&result)
            } else {
                None
            };

            reduce(
                state,
                AppEvent::RpcResponse {
                    id: id.clone(),
                    usage_tokens,
                },
            );

            if matches!(
                pending_method.as_deref(),
                Some("session/new" | "session/load")
            ) {
                if let Some(session_id) = extract_session_id(&result) {
                    state.session_id = Some(session_id.clone());
                    state.push_activity_line(format!("session: active {session_id}"));
                    sessions::on_session_activated(state, &session_id);
                }
            }

            if let Some(method) = pending_method.as_deref() {
                if method == "session/list" {
                    sessions::handle_session_list_response(state, &result, error_message);
                }
                if method == "ent/agent/status" {
                    let (conn, model) = ent::extract_agent_status_config(&result);
                    if conn.is_some() {
                        state.connection_id = conn;
                    }
                    if model.is_some() {
                        state.model_id = model;
                    }
                }
                if method == "ent/connections/list" {
                    clear_invalid_active_connection_from_list(state, &result);
                    if state.connections.open {
                        connections::handle_list_response(state, &result, error_message);
                    }
                    if !state.config_wizard.open && !state.connections.open {
                        let auto = crate::app::config_panels::maybe_autoconfigure_from_connections(
                            state,
                            &result,
                        );
                        if !auto.is_empty() {
                            send_outbound(transport, state, auto, timeout_ms)?;
                        } else if state.connection_id.is_none() {
                            // No valid saved connection; open the wizard to guide setup.
                            let out = config_wizard::open(state);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                    }
                }
                if method == "ent/connections/test" && state.connections.open {
                    connections::handle_test_response(state, &result, error_message);
                }
                if method == "ent/connections/credentials/status" && state.connections.open {
                    connections::handle_credentials_status_response(state, &result, error_message);
                }
                if method == "ent/connections/delete" && state.connections.open {
                    let out = connections::handle_delete_response(state, error_message);
                    send_outbound(transport, state, out, timeout_ms)?;
                }
                if method == "ent/connections/credentials/clear" && state.connections.open {
                    let out = connections::handle_clear_credentials_response(state, error_message);
                    send_outbound(transport, state, out, timeout_ms)?;
                }
                if method == "ent/connections/upsert" && state.connections.open {
                    // Handle upsert response for model toggle when models panel is open
                    if state.connections.models.open {
                        state.connections.models.loading = false;
                        if let Some(err) = error_message {
                            state.connections.models.error = Some(err.to_string());
                            // Revert optimistic update by re-fetching model list
                            let out = connections::open_models(state);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        // On success, the optimistic update is already applied
                    } else {
                        let out = connections::handle_upsert_response(state, error_message);
                        send_outbound(transport, state, out, timeout_ms)?;
                    }
                }
                if state.config_wizard.open && method.starts_with("ent/") {
                    let out = config_wizard::handle_response(state, method, &result, error_message);
                    send_outbound(transport, state, out, timeout_ms)?;
                }
                if method == "ent/session/configure" && !state.config_wizard.open {
                    if error_message.is_none() {
                        let (conn, model) = ent::extract_session_configure_config(&result);
                        if conn.is_some() {
                            state.connection_id = conn;
                        }
                        if model.is_some() {
                            state.model_id = model;
                        }
                        state.prefs.last_connection_id = state.connection_id.clone();
                        state.prefs.last_model_id = state.model_id.clone();
                        let _ = crate::app::prefs::save(state.prefs_path.as_deref(), &state.prefs);
                    }
                }
                if method == "ent/models/list" && state.connections.models.open {
                    crate::app::connections::handle_models_list_response(state, &result, error_message);
                }
                // Note: Model toggling now uses ent/connections/upsert instead of
                // ent/models/enable/disable, which operates at the connection level
                // rather than provider level, avoiding issues with dynamic model catalogs.
                if method == "ent/models/refresh" && state.connections.models.open {
                    let out = crate::app::connections::open_models(state);
                    send_outbound(transport, state, out, timeout_ms)?;
                }
            }

            if should_refocus && state.active_permission.is_none() {
                state.focus = Focus::Input;
            }
        }
    }

    Ok(())
}

fn clear_invalid_active_connection_from_list(state: &mut AppState, result: &Option<Value>) {
    let Some(conn) = state.connection_id.clone().filter(|c| !c.is_empty()) else {
        state.connection_id = None;
        state.model_id = None;
        return;
    };

    let seen = crate::app::config_panels::connection_exists_in_list(result, &conn);
    if seen {
        return;
    }

    state.push_activity_line(format!("configure: active connection missing ({conn})"));
    state.connection_id = None;
    state.model_id = None;
}

fn maybe_open_config_wizard_for_prompt_error(
    state: &mut AppState,
    pending_method: Option<&str>,
    error_message: Option<&str>,
) -> Vec<Outbound> {
    if pending_method != Some("session/prompt") {
        return Vec::new();
    }
    let Some(err) = error_message else {
        return Vec::new();
    };
    if !is_missing_provider_configuration_error(err) {
        return Vec::new();
    }
    if state.connection_id.is_some() && state.model_id.is_some() {
        return Vec::new();
    }
    if state.config_wizard.open {
        return Vec::new();
    }

    state.push_activity_line("configure: required".to_string());
    config_wizard::open(state)
}

fn is_missing_provider_configuration_error(message: &str) -> bool {
    let m = message.to_lowercase();
    m.contains("missing provider configuration")
        || m.contains("connectionid and modelid are required")
}

fn extract_session_id(result: &Option<Value>) -> Option<String> {
    let Some(result) = result else { return None };
    let obj = result.as_object()?;
    obj.get("sessionId")?.as_str().map(|s| s.to_string())
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0));
    dur.as_millis() as u64
}

fn expire_timeouts(state: &mut AppState, now_ms: u64) {
    let mut expired: Vec<String> = Vec::new();
    for (id, pending) in &state.pending_requests {
        if now_ms.saturating_sub(pending.sent_at_ms) > pending.timeout_ms {
            expired.push(id.clone());
        }
    }

    for id in expired {
        if let Some(p) = state.pending_requests.remove(&id) {
            activity::push_timeout(state, id, p.method);
        }
    }
}

fn handle_session_update(state: &mut AppState, params: &Value) {
    let mut saw_turn_end = false;
    for ev in ent::decode_session_update(params) {
        match &ev {
            AppEvent::ToolUse {
                tool_call_id,
                name,
                status,
                input,
                result,
                job_id,
                turn_id,
                turn_seq,
                ..
            } => {
                activity::upsert_tool_use(
                    state,
                    tool_call_id.clone(),
                    name.clone(),
                    status.clone(),
                    input.clone(),
                    result.clone(),
                    job_id.clone(),
                    turn_id.clone(),
                    *turn_seq,
                );
            }
            AppEvent::JobStarted { job_id, job_type } => {
                activity::push_job_started(state, job_id.clone(), job_type.clone());
            }
            AppEvent::JobFinished { job_id, outcome } => {
                activity::push_job_finished(state, job_id.clone(), outcome.clone());
            }
            AppEvent::TurnEnd {
                stop_reason,
                turn_id,
                turn_seq,
                ..
            } => {
                activity::push_turn_end(state, stop_reason.clone(), turn_id.clone(), *turn_seq);
            }
            _ => {}
        }
        if matches!(ev, AppEvent::TurnEnd { .. }) {
            saw_turn_end = true;
        }
        reduce(state, ev);
    }
    if saw_turn_end && state.active_permission.is_none() {
        state.focus = Focus::Input;
    }
}

fn draw(f: &mut ratatui::Frame, state: &AppState) {
    // Dynamic input height based on content, capped at 1/3 of screen
    let input_line_count = state.input_buffer.lines().count().max(1);
    let input_line_count = if state.input_buffer.ends_with('\n') {
        input_line_count + 1
    } else {
        input_line_count
    };
    let max_input_height = f.area().height / 3;
    let input_height = (input_line_count as u16).min(max_input_height).max(1);

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),               // main area (first)
            Constraint::Length(input_height), // input
            Constraint::Length(1),            // status at BOTTOM
        ])
        .split(f.area());

    let main_area = root[0];
    let input_area = root[1];
    let status_area = root[2];

    let status = render_status(state);
    f.render_widget(status, status_area);

    // Main area: show overlays if open, otherwise conversation
    if state.debug_overlay_open {
        f.render_widget(render_debug_overlay(state), main_area);
    } else if state.activity_overlay_open {
        f.render_widget(render_activity_overlay(state), main_area);
    } else {
        render_main(f, state, main_area);
    }
    f.render_widget(render_input(state), input_area);

    // Slash command picker appears just above the input area
    if state.slash_picker_open {
        // Calculate picker area: above the input, same width, 12 lines tall
        let picker_height = 12u16;
        let picker_y = input_area.y.saturating_sub(picker_height);
        let picker_area = ratatui::layout::Rect {
            x: input_area.x,
            y: picker_y,
            width: input_area.width.min(60), // Cap width for readability
            height: picker_height,
        };
        f.render_widget(Clear, picker_area);
        f.render_widget(render_slash_picker(state), picker_area);
    }

    // Permission is now rendered inline in the conversation, not as a modal overlay
    if state.env_editor.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_env_modal(state), area);
    } else if state.connections.models.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_connections_models_modal(state), area);
    } else if state.connections.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_connections_modal(state), area);
    } else if state.config_wizard.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_config_modal(state), area);
    } else if state.sessions.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_sessions_modal(state), area);
    } else if state.search.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_search_modal(state), area);
    } else if state.palette_open {
        let area = centered_rect(70, 60, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_palette_modal(state), area);
    } else if state.help_open {
        let area = centered_rect(70, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_help_modal(), area);
    }
}

#[derive(Debug, Clone, Copy)]
struct ThemeStyles {
    pub colors: theme::ThemeColors,
}

impl ThemeStyles {
    fn new(theme: Theme) -> Self {
        Self {
            colors: theme::ThemeColors::from_pref(theme),
        }
    }

    fn focused_border(&self) -> Color {
        self.colors.accent
    }
    // Used by render_activity which is kept for future overlay implementation
    #[allow(dead_code)]
    fn activity_selected(&self) -> Color {
        self.colors.accent
    }
    // Used by render_activity which is kept for future overlay implementation
    #[allow(dead_code)]
    fn activity_error(&self) -> Color {
        self.colors.error
    }
    fn dim(&self) -> Color {
        self.colors.fg_muted
    }
}

fn theme_styles(theme: Theme) -> ThemeStyles {
    ThemeStyles::new(theme)
}

/// Format token count for display in status bar.
/// Uses K/M suffixes for readability.
fn format_token_count(count: u64) -> String {
    if count >= 1_000_000 {
        format!("{:.1}M", count as f64 / 1_000_000.0)
    } else if count >= 1_000 {
        format!("{:.1}k", count as f64 / 1_000.0)
    } else {
        count.to_string()
    }
}

fn render_status(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let model = state
        .model_id
        .clone()
        .unwrap_or_else(|| "no model".to_string());

    // Extract provider name from connection_id (e.g., "anthropic-prod" -> "anthropic")
    let provider = state
        .connection_id
        .clone()
        .and_then(|c| c.split('-').next().map(|s| s.to_string()))
        .unwrap_or_else(|| "—".to_string());

    // Token count with nice formatting
    let tokens = state
        .token_count
        .map(format_token_count)
        .unwrap_or_else(|| "—".to_string());

    // Shorten workdir if too long
    let workdir = state.workdir.clone();
    let short_workdir = if workdir.len() > 30 {
        format!("…{}", &workdir[workdir.len() - 28..])
    } else {
        workdir
    };

    let sep = Span::styled(" · ", Style::default().fg(colors.fg_muted));

    let text = Line::from(vec![
        Span::styled(
            format!(" {}", model),
            Style::default().fg(colors.fg_primary),
        ),
        sep.clone(),
        Span::styled(provider, Style::default().fg(colors.fg_muted)),
        sep.clone(),
        Span::styled(format!("{tokens} tokens"), Style::default().fg(colors.fg_muted)),
        sep,
        Span::styled(short_workdir, Style::default().fg(colors.fg_muted)),
        Span::raw(" "),
    ]);

    Paragraph::new(text).style(Style::default().bg(colors.bg_surface))
}

fn render_sessions_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let s = &state.sessions;
    let mut lines: Vec<Line> = Vec::new();

    // Title
    lines.push(Line::from(Span::styled(
        "Sessions",
        Style::default()
            .fg(colors.fg_primary)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    if s.loading {
        lines.push(Line::from(Span::styled(
            "Loading sessions...",
            Style::default().fg(colors.fg_muted),
        )));
    } else if let Some(err) = &s.error {
        lines.push(Line::from(Span::styled(
            format!("Error: {err}"),
            Style::default().fg(colors.error),
        )));
    } else {
        // Search/filter input
        lines.push(Line::from(vec![
            Span::styled("> ", Style::default().fg(colors.accent)),
            Span::styled(s.query.clone(), Style::default().fg(colors.fg_primary)),
            Span::styled("▌", Style::default().fg(colors.accent)),
        ]));
        lines.push(Line::from(""));

        // Session list
        if s.filtered.is_empty() {
            lines.push(Line::from(Span::styled(
                "(no sessions)",
                Style::default().fg(colors.fg_muted),
            )));
        } else {
            let max = 18usize;
            let start = s.selected.saturating_sub(max / 2);
            let end = (start + max).min(s.filtered.len());

            for sel_idx in start..end {
                let idx = s.filtered[sel_idx];
                let selected = sel_idx == s.selected;
                let it = &s.items[idx];
                let alias = state
                    .session_aliases
                    .get(&it.session_id)
                    .cloned()
                    .unwrap_or_default();
                let title = if alias.is_empty() {
                    it.session_id.clone()
                } else {
                    format!(
                        "{alias} ({})",
                        &it.session_id[..8.min(it.session_id.len())]
                    )
                };

                let marker = if selected { "▸ " } else { "  " };
                let style = if selected {
                    Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                } else {
                    Style::default().fg(colors.fg_secondary)
                };

                lines.push(Line::from(Span::styled(format!("{marker}{title}"), style)));

                // Show workdir and last active on second line for selected
                if selected {
                    let work = it.work_dir.clone().unwrap_or_else(|| "?".to_string());
                    let last_active = it.last_active.clone().unwrap_or_else(|| "?".to_string());
                    lines.push(Line::from(Span::styled(
                        format!("     {} · {}", work, last_active),
                        Style::default().fg(colors.fg_muted),
                    )));
                }
            }
        }

        // Rename input if active
        if s.renaming {
            lines.push(Line::from(""));
            lines.push(Line::from(vec![
                Span::styled("Rename: ", Style::default().fg(colors.fg_muted)),
                Span::styled(s.rename_input.clone(), Style::default().fg(colors.fg_primary)),
                Span::styled("▌", Style::default().fg(colors.accent)),
            ]));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Enter load · r rename · Esc close",
        Style::default().fg(colors.fg_muted),
    )));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
        .wrap(Wrap { trim: true })
}

fn render_search_modal(state: &AppState) -> Paragraph<'static> {
    let s = &state.search;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from("Search"));
    lines.push(Line::from(""));
    lines.push(Line::from(format!("> {}", s.query)));
    lines.push(Line::from(""));

    if s.results.is_empty() && !s.query.trim().is_empty() {
        lines.push(Line::from("(no matches)"));
    } else {
        let max = 18usize;
        let start = s.selected.saturating_sub(max / 2);
        let end = (start + max).min(s.results.len());
        for idx in start..end {
            let marker = if idx == s.selected { "▸ " } else { "  " };
            lines.push(Line::from(format!("{marker}{}", s.results[idx].label)));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from("Up/Down select • Enter jump • Esc close"));

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Search").borders(Borders::ALL))
        .wrap(Wrap { trim: true })
}

fn render_config_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let w = &state.config_wizard;
    let mut lines: Vec<Line> = Vec::new();

    // Title
    lines.push(Line::from(Span::styled(
        "Configure",
        Style::default()
            .fg(colors.fg_primary)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    match w.step {
        config_wizard::ConfigWizardStep::LoadingConnections => {
            lines.push(Line::from(Span::styled(
                "Loading connections...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::SelectConnection => {
            lines.push(Line::from(Span::styled(
                "Select connection:",
                Style::default().fg(colors.fg_secondary),
            )));
            for (i, c) in w.connections.iter().enumerate() {
                let selected = i == w.selected;
                let marker = if selected { "▸ " } else { "  " };
                let name = c.name.clone().unwrap_or_else(|| c.connection_id.clone());
                let cred = c
                    .credential_state
                    .clone()
                    .map(|s| format!(" [{s}]"))
                    .unwrap_or_default();
                let style = if selected {
                    Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                } else {
                    Style::default().fg(colors.fg_secondary)
                };
                lines.push(Line::from(Span::styled(
                    format!("{marker}{}{}", name, cred),
                    style,
                )));
            }
        }
        config_wizard::ConfigWizardStep::LoadingProviders => {
            lines.push(Line::from(Span::styled(
                "No connections found; loading providers...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::SelectProvider => {
            lines.push(Line::from(Span::styled(
                "Select provider:",
                Style::default().fg(colors.fg_secondary),
            )));
            for (i, p) in w.providers.iter().enumerate() {
                let selected = i == w.selected;
                let marker = if selected { "▸ " } else { "  " };
                let name = p
                    .display_name
                    .clone()
                    .unwrap_or_else(|| p.provider_id.clone());
                let style = if selected {
                    Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                } else {
                    Style::default().fg(colors.fg_secondary)
                };
                lines.push(Line::from(Span::styled(
                    format!("{marker}{name} ({})", p.provider_id),
                    style,
                )));
            }
        }
        config_wizard::ConfigWizardStep::UpsertingConnection => {
            lines.push(Line::from(Span::styled(
                "Creating connection...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::CheckingCredentials => {
            lines.push(Line::from(Span::styled(
                "Checking credentials...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::EnterCredential => {
            let idx = w.credential_field_index;
            if let Some(field) = w.credential_fields.get(idx) {
                let label = field.label.clone().unwrap_or_else(|| field.name.clone());
                let display = if field.secret {
                    "*".repeat(w.credential_input.chars().count())
                } else {
                    w.credential_input.clone()
                };
                lines.push(Line::from(Span::styled(
                    format!("Enter {label}:"),
                    Style::default().fg(colors.fg_secondary),
                )));
                lines.push(Line::from(vec![
                    Span::styled("> ", Style::default().fg(colors.accent)),
                    Span::styled(display, Style::default().fg(colors.fg_primary)),
                    Span::styled("▌", Style::default().fg(colors.accent)),
                ]));
            } else {
                lines.push(Line::from(Span::styled(
                    "Enter credential:",
                    Style::default().fg(colors.fg_secondary),
                )));
            }
        }
        config_wizard::ConfigWizardStep::SubmittingCredentials => {
            lines.push(Line::from(Span::styled(
                "Submitting credentials...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::LoadingModels => {
            lines.push(Line::from(Span::styled(
                "Loading models...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::SelectModel => {
            lines.push(Line::from(Span::styled(
                "Select model:",
                Style::default().fg(colors.fg_secondary),
            )));
            let max = 18usize;
            let start = w.selected.saturating_sub(max / 2);
            let end = (start + max).min(w.models.len());
            for i in start..end {
                let selected = i == w.selected;
                let marker = if selected { "▸ " } else { "  " };
                let m = &w.models[i];
                let style = if selected {
                    Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                } else {
                    Style::default().fg(colors.fg_secondary)
                };
                lines.push(Line::from(Span::styled(format!("{marker}{}", m.name), style)));
            }
        }
        config_wizard::ConfigWizardStep::Applying => {
            lines.push(Line::from(Span::styled(
                "Applying session configuration...",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::Done => {
            lines.push(Line::from(Span::styled(
                format!(
                    "Configured: connectionId={} modelId={}",
                    w.connection_id.clone().unwrap_or_else(|| "?".to_string()),
                    w.model_id.clone().unwrap_or_else(|| "?".to_string())
                ),
                Style::default().fg(colors.success),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Press Enter or Esc to close",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::NotSupported => {
            lines.push(Line::from(Span::styled(
                w.error_message.clone().unwrap_or_else(|| {
                    "configuration not supported by this agent".to_string()
                }),
                Style::default().fg(colors.warning),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Press Enter or Esc to close",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::Error => {
            lines.push(Line::from(Span::styled(
                "Error:",
                Style::default().fg(colors.error),
            )));
            lines.push(Line::from(Span::styled(
                w.error_message
                    .clone()
                    .unwrap_or_else(|| "<unknown>".to_string()),
                Style::default().fg(colors.error),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Press Enter or Esc to close",
                Style::default().fg(colors.fg_muted),
            )));
        }
        config_wizard::ConfigWizardStep::Closed => {}
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Up/Down select • Enter confirm • Esc close",
        Style::default().fg(colors.fg_muted),
    )));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
        .wrap(Wrap { trim: true })
}

fn render_env_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Title
    lines.push(Line::from(Span::styled(
        "Environment (KEY=VALUE)",
        Style::default()
            .fg(colors.fg_primary)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    for (idx, (k, v)) in state.environment.iter().enumerate() {
        let selected = idx == state.env_editor.selected;
        let marker = if selected { "▸ " } else { "  " };
        let style = if selected {
            Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
        } else {
            Style::default().fg(colors.fg_secondary)
        };
        lines.push(Line::from(Span::styled(format!("{marker}{k}={v}"), style)));
    }
    if state.environment.is_empty() {
        lines.push(Line::from(Span::styled(
            "No variables set",
            Style::default().fg(colors.fg_muted),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("> ", Style::default().fg(colors.accent)),
        Span::styled(
            state.env_editor.input.clone(),
            Style::default().fg(colors.fg_primary),
        ),
        Span::styled("▌", Style::default().fg(colors.accent)),
    ]));
    if let Some(err) = &state.env_editor.error {
        lines.push(Line::from(Span::styled(
            format!("Error: {err}"),
            Style::default().fg(colors.error),
        )));
    }
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Enter add/update • d delete • s apply • Esc close",
        Style::default().fg(colors.fg_muted),
    )));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
        .wrap(Wrap { trim: true })
}

fn render_slash_picker(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Filter slash commands based on current input
    let query = state
        .input_buffer
        .strip_prefix('/')
        .unwrap_or("")
        .to_lowercase();
    let filtered: Vec<_> = state
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
        .collect();

    // Show commands with selection
    let max = 8usize;
    let start = state.slash_picker_selected.saturating_sub(max / 2);
    let end = (start + max).min(filtered.len());
    for i in start..end {
        let selected = i == state.slash_picker_selected;
        let marker = if selected { "▸ " } else { "  " };
        let cmd = &filtered[i];
        let style = if selected {
            Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
        } else {
            Style::default().fg(colors.fg_secondary)
        };

        // Show name and description
        let name_style = if selected {
            Style::default()
                .fg(colors.accent)
                .bg(colors.bg_surface)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(colors.accent)
        };
        let desc_style = if selected {
            Style::default().fg(colors.fg_muted).bg(colors.bg_surface)
        } else {
            Style::default().fg(colors.fg_muted)
        };

        lines.push(Line::from(vec![
            Span::styled(marker, style),
            Span::styled(format!("/{}", cmd.name), name_style),
            Span::styled(format!(" - {}", cmd.description), desc_style),
        ]));
    }

    if filtered.is_empty() {
        lines.push(Line::from(Span::styled(
            "  No matching commands",
            Style::default().fg(colors.fg_muted),
        )));
    }

    // Legend
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "↑↓ navigate • Enter/Tab select • Esc close",
        Style::default().fg(colors.fg_muted),
    )));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
}

fn render_connections_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Title
    lines.push(Line::from(Span::styled(
        "Connections",
        Style::default()
            .fg(colors.fg_primary)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    if let Some(err) = &state.connections.error {
        lines.push(Line::from(Span::styled(
            format!("Error: {err}"),
            Style::default().fg(colors.error),
        )));
        lines.push(Line::from(""));
    }

    if state.connections.loading {
        lines.push(Line::from(Span::styled(
            "Loading connections...",
            Style::default().fg(colors.fg_muted),
        )));
    } else if state.connections.items.is_empty() {
        lines.push(Line::from(Span::styled(
            "No connections",
            Style::default().fg(colors.fg_muted),
        )));
    } else {
        let max = 18usize;
        let start = state.connections.selected.saturating_sub(max / 2);
        let end = (start + max).min(state.connections.items.len());
        for i in start..end {
            let selected = i == state.connections.selected;
            let marker = if selected { "▸ " } else { "  " };
            let it = &state.connections.items[i];
            let cred = match state.connections.credential_status.get(&it.connection_id) {
                Some(cs) => {
                    let label = cs
                        .account_label
                        .clone()
                        .filter(|s| !s.is_empty())
                        .map(|s| format!(":{s}"))
                        .unwrap_or_default();
                    format!("{}{}", cs.state, label)
                }
                None => it
                    .credential_state
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
            };
            let endpoint_str = it
                .endpoint
                .clone()
                .filter(|s| !s.is_empty())
                .map(|s| format!(" • {s}"))
                .unwrap_or_default();
            let test = state.connections.last_test.get(&it.connection_id);
            let test_str = match test {
                None => String::new(),
                Some(t) if t.ok => t
                    .latency_ms
                    .map(|ms| format!(" • ok {ms}ms"))
                    .unwrap_or_else(|| " • ok".to_string()),
                Some(t) => format!(
                    " • error {}",
                    t.error.clone().unwrap_or_else(|| "?".to_string())
                ),
            };

            let style = if selected {
                Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
            } else {
                Style::default().fg(colors.fg_secondary)
            };
            lines.push(Line::from(Span::styled(
                format!(
                    "{marker}{} ({}) [{cred}]{endpoint_str}{test_str}",
                    it.name, it.provider_id
                ),
                style,
            )));
        }
    }

    lines.push(Line::from(""));
    if state.connections.confirm_delete {
        lines.push(Line::from(Span::styled(
            "Delete selected connection? Enter confirm • Esc cancel",
            Style::default().fg(colors.warning),
        )));
    } else if state.connections.confirm_clear_credentials {
        lines.push(Line::from(Span::styled(
            "Clear credentials for selected connection? Enter confirm • Esc cancel",
            Style::default().fg(colors.warning),
        )));
    } else if state.connections.renaming {
        lines.push(Line::from(vec![
            Span::styled("Rename: ", Style::default().fg(colors.fg_muted)),
            Span::styled(
                state.connections.rename_input.clone(),
                Style::default().fg(colors.fg_primary),
            ),
            Span::styled("▌", Style::default().fg(colors.accent)),
        ]));
        lines.push(Line::from(Span::styled(
            "Enter save • Esc close",
            Style::default().fg(colors.fg_muted),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            "Enter configure • c create • r refresh • e rename • d delete • t test • s status • k clear creds • m models • Esc close",
            Style::default().fg(colors.fg_muted),
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
        .wrap(Wrap { trim: true })
}

fn render_connections_models_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Title
    lines.push(Line::from(Span::styled(
        "Connection Models",
        Style::default()
            .fg(colors.fg_primary)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    if let Some(err) = &state.connections.models.error {
        lines.push(Line::from(Span::styled(
            format!("Error: {err}"),
            Style::default().fg(colors.error),
        )));
        lines.push(Line::from(""));
    }

    if state.connections.models.loading {
        lines.push(Line::from(Span::styled(
            "Loading models...",
            Style::default().fg(colors.fg_muted),
        )));
    } else if state.connections.models.models.is_empty() {
        lines.push(Line::from(Span::styled(
            "No models",
            Style::default().fg(colors.fg_muted),
        )));
    } else {
        // Use max=10 to ensure the legend is visible in small terminals (24 rows).
        // With a 70% height modal (~16 rows), minus borders (2), minus fixed content
        // (title, empty lines, legend = 4), we have ~10 rows for models.
        let max = 10usize;
        let start = state.connections.models.selected.saturating_sub(max / 2);
        let end = (start + max).min(state.connections.models.models.len());
        for i in start..end {
            let selected = i == state.connections.models.selected;
            let marker = if selected { "▸ " } else { "  " };
            let m = &state.connections.models.models[i];
            let (status, status_color) = if m.disabled {
                ("[disabled]", colors.fg_muted)
            } else {
                ("[enabled]", colors.success)
            };
            let style = if selected {
                Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
            } else {
                Style::default().fg(colors.fg_secondary)
            };
            lines.push(Line::from(vec![
                Span::styled(format!("{marker}{} ", m.name), style),
                Span::styled(status, Style::default().fg(status_color)),
            ]));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Enter/Space toggle • r refresh • Esc close",
        Style::default().fg(colors.fg_muted),
    )));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
        .wrap(Wrap { trim: true })
}

/// Renders the main content area. The conversation (chat) is always shown as the
/// primary view. Debug and Activity panes have been removed in favor of full-screen
/// overlays (to be implemented in later tasks).
fn render_main(f: &mut ratatui::Frame, state: &AppState, area: ratatui::layout::Rect) {
    f.render_widget(render_chat(state), area);
}

/// Renders a single tool call line with status indicator.
fn render_tool_call_line(item: &activity::ActivityItem, colors: &theme::ThemeColors) -> Line<'static> {
    let status_char = match item.status.as_deref() {
        Some("completed") | Some("success") => '\u{2713}', // checkmark
        Some("error") => '\u{2717}',                       // X mark
        _ => '\u{25B6}',                                   // play/running triangle
    };
    let status_color = match item.status.as_deref() {
        Some("completed") | Some("success") => colors.success,
        Some("error") => colors.error,
        _ => colors.accent,
    };

    let tool_name = item
        .tool_name
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    Line::from(vec![
        Span::styled(
            format!("{} ", status_char),
            Style::default().fg(status_color),
        ),
        Span::styled(tool_name, Style::default().fg(colors.fg_primary)),
    ])
}

fn render_chat(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    for m in &state.messages {
        let prefix_style = match m.role {
            Role::User => Style::default().fg(colors.accent).add_modifier(Modifier::BOLD),
            Role::Assistant => Style::default().fg(colors.fg_secondary),
        };

        // Add spacing before message (except for first message)
        if !lines.is_empty() {
            lines.push(Line::from(""));
        }

        // Role indicator - use friendly labels
        let role_text = match m.role {
            Role::User => "you",
            Role::Assistant => "assistant",
        };
        lines.push(Line::from(Span::styled(role_text, prefix_style)));

        // Message content with streaming cursor if applicable
        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        // Markdown rendering is always enabled
        for l in markdown::render_markdownish_lines(&text) {
            let style = if l.is_code {
                Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
            } else {
                Style::default().fg(colors.fg_primary)
            };
            lines.push(Line::from(Span::styled(l.text, style)));
        }
    }

    // Show in-progress tool calls inline
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        lines.push(Line::from(""));
        for item in pending_tools {
            lines.push(render_tool_call_line(item, colors));
        }
    }

    // Show thinking indicator if awaiting response
    if state.is_thinking() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!("{} Thinking...", spinning_char()),
            Style::default().fg(colors.spinner),
        )));
    }

    // Show permission request inline
    if state.active_permission.is_some() {
        lines.extend(render_permission_inline(state, colors));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.chat_scroll, 0))
}

/// Renders the Activity pane content.
///
/// NOTE: This function is kept for future use as a full-screen overlay.
/// It is no longer rendered as a split pane in the main view.
#[allow(dead_code)]
fn render_activity(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let mut lines: Vec<Line> = Vec::new();
    let total = state.activity.len();
    let start = total.saturating_sub(200);
    for (idx, item) in state.activity.iter().enumerate().skip(start) {
        let selected = idx == state.activity_selected && state.focus == Focus::Activity;
        let sel_marker = if selected { "▸" } else { " " };
        let exp_marker = if item.expanded { "▾" } else { " " };

        let mut style = Style::default();
        if selected {
            style = style.fg(styles.activity_selected());
        } else if matches!(
            item.kind,
            activity::ActivityKind::RpcError | activity::ActivityKind::Timeout
        ) {
            style = style.fg(styles.activity_error());
        }

        lines.push(Line::from(vec![
            Span::styled(format!("{sel_marker}{exp_marker} "), style),
            Span::raw(item.summary.clone()),
        ]));

        if item.expanded {
            if let Some(details) = &item.details {
                let pretty =
                    serde_json::to_string_pretty(details).unwrap_or_else(|_| details.to_string());
                for l in pretty.lines() {
                    lines.push(Line::from(Span::styled(
                        format!("    {l}"),
                        Style::default().fg(styles.dim()),
                    )));
                }
            }
        }
    }
    Paragraph::new(Text::from(lines))
        .block(focused_block(
            "Activity",
            state.focus == Focus::Activity,
            state.prefs.theme,
        ))
        .wrap(Wrap { trim: true })
        .scroll((state.activity_scroll, 0))
}

/// Renders the Debug pane content.
///
/// NOTE: This function is kept for future use as a full-screen overlay.
/// It is no longer rendered as a split pane in the main view.
#[allow(dead_code)]
fn render_debug(state: &AppState) -> Paragraph<'static> {
    let mut lines: Vec<Line> = Vec::new();
    for l in state.debug_lines.iter().rev().take(200).rev() {
        lines.push(Line::from(l.clone()));
    }
    Paragraph::new(Text::from(lines))
        .block(focused_block(
            "Debug",
            state.focus == Focus::Debug,
            state.prefs.theme,
        ))
        .wrap(Wrap { trim: true })
        .scroll((state.debug_scroll, 0))
}

/// Renders a full-screen debug log overlay.
/// Toggled with Ctrl+D, closed with Esc.
fn render_debug_overlay(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Header
    lines.push(Line::from(Span::styled(
        "Debug Log                                        [Esc to close]",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(""));

    // Show debug lines (oldest at top, most recent at bottom)
    for line in state.debug_lines.iter().rev().take(200).rev() {
        lines.push(Line::from(Span::styled(
            line.clone(),
            Style::default().fg(colors.fg_secondary),
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.debug_scroll, 0))
}

/// Renders a full-screen activity overlay.
/// Toggled with Ctrl+A, closed with Esc.
fn render_activity_overlay(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Header
    lines.push(Line::from(Span::styled(
        "Activity                                         [Esc to close]",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(""));

    // Activity items
    for item in state.activity.iter() {
        let status_char = match item.kind {
            activity::ActivityKind::ToolUse => match item.status.as_deref() {
                Some("completed") => '\u{2713}', // checkmark
                Some("error") => '\u{2717}',     // X mark
                _ => '\u{25B6}',                 // play triangle
            },
            activity::ActivityKind::TurnEnd => '\u{25C6}', // diamond
            activity::ActivityKind::JobStarted | activity::ActivityKind::JobFinished => {
                '\u{25CF}' // filled circle
            }
            _ => '\u{00B7}', // middle dot
        };

        let status_color = match item.status.as_deref() {
            Some("completed") | Some("success") => colors.success,
            Some("error") => colors.error,
            _ => colors.fg_muted,
        };

        lines.push(Line::from(vec![
            Span::styled(format!("{} ", status_char), Style::default().fg(status_color)),
            Span::styled(format!("{:?}", item.kind), Style::default().fg(colors.fg_primary)),
            Span::styled(
                format!("  {}", item.summary),
                Style::default().fg(colors.fg_muted),
            ),
        ]));
    }

    if state.activity.is_empty() {
        lines.push(Line::from(Span::styled(
            "(no activity yet)",
            Style::default().fg(colors.fg_muted),
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.activity_scroll, 0))
}

fn render_input(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let prompt = "> ";
    let continuation = "  ";
    let mut lines: Vec<Line> = Vec::new();

    let input_lines: Vec<&str> = state.input_buffer.lines().collect();
    let input_lines = if input_lines.is_empty() {
        vec![""]
    } else {
        input_lines
    };

    // Handle trailing newline by adding empty continuation line
    let has_trailing_newline = !state.input_buffer.is_empty() && state.input_buffer.ends_with('\n');
    let total_lines = input_lines.len() + if has_trailing_newline { 1 } else { 0 };

    for (i, line) in input_lines.iter().enumerate() {
        let prefix = if i == 0 { prompt } else { continuation };
        let is_last = i == total_lines - 1 && !has_trailing_newline;
        lines.push(Line::from(vec![
            Span::styled(prefix, Style::default().fg(colors.accent)),
            Span::styled(line.to_string(), Style::default().fg(colors.fg_primary)),
            if is_last {
                Span::styled("▌", Style::default().fg(colors.accent))
            } else {
                Span::raw("")
            },
        ]));
    }

    // Add continuation line with cursor if there's a trailing newline
    if has_trailing_newline {
        lines.push(Line::from(vec![
            Span::styled(continuation, Style::default().fg(colors.accent)),
            Span::styled("▌", Style::default().fg(colors.accent)),
        ]));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .scroll((state.input_scroll, 0))
}

/// Renders permission request inline in the conversation flow.
/// Returns lines to be appended to the conversation view.
fn render_permission_inline(state: &AppState, colors: &theme::ThemeColors) -> Vec<Line<'static>> {
    let Some(req) = state.active_permission.as_ref() else {
        return Vec::new();
    };

    let mut lines = Vec::new();
    lines.push(Line::from("")); // spacing

    // Tool name with indicator
    let tool = req.tool.clone().unwrap_or_else(|| "unknown".to_string());
    lines.push(Line::from(vec![
        Span::styled(
            format!("{} ", '\u{25B6}'), // play triangle
            Style::default().fg(colors.warning),
        ),
        Span::styled(
            tool,
            Style::default()
                .fg(colors.fg_primary)
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    // Resource summary (e.g., file path or command)
    if let Some(resource) = &req.resource {
        lines.push(Line::from(Span::styled(
            format!("  {}", resource),
            Style::default().fg(colors.fg_secondary),
        )));
    }

    // Show tool input if available
    if let Some(tool_call_id) = &req.tool_call_id {
        if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
            let pretty =
                serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
            // Limit input preview to avoid overwhelming the UI
            let preview_lines: Vec<&str> = pretty.lines().take(6).collect();
            for l in &preview_lines {
                lines.push(Line::from(Span::styled(
                    format!("  {}", l),
                    Style::default().fg(colors.fg_muted),
                )));
            }
            if pretty.lines().count() > 6 {
                lines.push(Line::from(Span::styled(
                    "  ...".to_string(),
                    Style::default().fg(colors.fg_muted),
                )));
            }
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "  Allow this action?",
        Style::default().fg(colors.fg_primary),
    )));
    lines.push(Line::from(""));

    // Options - one per line with selection indicator
    for (i, opt) in req.options.iter().enumerate() {
        let selected = i == state.active_permission_selected;
        let marker = if selected { "\u{25B8} " } else { "  " }; // right-pointing triangle
        let style = if selected {
            Style::default()
                .fg(colors.fg_primary)
                .bg(colors.bg_surface)
        } else {
            Style::default().fg(colors.fg_secondary)
        };
        lines.push(Line::from(Span::styled(
            format!("  {}{}", marker, opt.label),
            style,
        )));
    }

    // Guidance input row (after regular options)
    let guidance_selected = state.active_permission_selected == req.options.len();
    lines.push(Line::from(Span::styled(
        "  ──────────────────────",
        Style::default().fg(colors.border_subtle),
    )));

    let guidance_marker = if guidance_selected { "\u{25B8} " } else { "  " };
    let guidance_style = if guidance_selected {
        Style::default()
            .fg(colors.fg_primary)
            .bg(colors.bg_surface)
    } else {
        Style::default().fg(colors.fg_muted)
    };

    if state.permission_guidance_input.is_empty() {
        lines.push(Line::from(vec![
            Span::styled(format!("  {}", guidance_marker), guidance_style),
            Span::styled("Type guidance...", Style::default().fg(colors.fg_muted)),
            if guidance_selected {
                Span::styled("\u{258C}", Style::default().fg(colors.accent))
            } else {
                Span::raw("")
            },
        ]));
    } else {
        lines.push(Line::from(vec![
            Span::styled(format!("  {}", guidance_marker), guidance_style),
            Span::styled(
                state.permission_guidance_input.clone(),
                Style::default().fg(colors.fg_primary),
            ),
            if guidance_selected {
                Span::styled("\u{258C}", Style::default().fg(colors.accent))
            } else {
                Span::raw("")
            },
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "  Up/Down to select, Enter to confirm, Esc to deny",
        Style::default().fg(colors.fg_muted),
    )));

    lines
}

fn focused_block(title: &'static str, focused: bool, theme: Theme) -> Block<'static> {
    let base = Block::default().title(title).borders(Borders::ALL);
    if focused {
        let styles = theme_styles(theme);
        base.border_style(Style::default().fg(styles.focused_border()))
    } else {
        base
    }
}

fn render_palette_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Search input with prompt
    lines.push(Line::from(vec![
        Span::styled("> ", Style::default().fg(colors.accent)),
        Span::styled(
            state.palette_query.clone(),
            Style::default().fg(colors.fg_primary),
        ),
        Span::styled("▌", Style::default().fg(colors.accent)),
    ]));
    lines.push(Line::from(""));

    // Filter and display palette items
    let items = palette_labels(&state.palette_query);
    if items.is_empty() {
        lines.push(Line::from(Span::styled(
            "(no matches)",
            Style::default().fg(colors.fg_muted),
        )));
    } else {
        let idx = state.palette_selected.min(items.len() - 1);
        let window = 12usize;
        let start = idx.saturating_sub(window / 2);
        let end = (start + window).min(items.len());
        for i in start..end {
            let selected = i == idx;
            let marker = if selected { "▸ " } else { "  " };
            let style = if selected {
                Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
            } else {
                Style::default().fg(colors.fg_secondary)
            };
            lines.push(Line::from(Span::styled(
                format!("{}{}", marker, items[i]),
                style,
            )));
        }
        if end < items.len() {
            lines.push(Line::from(Span::styled(
                format!("... (+{} more)", items.len() - end),
                Style::default().fg(colors.fg_muted),
            )));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Esc to close",
        Style::default().fg(colors.fg_muted),
    )));

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_elevated))
        .block(
            Block::default()
                .title("Palette")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(colors.border_subtle))
                .border_type(BorderType::Rounded),
        )
        .wrap(Wrap { trim: true })
}

fn render_help_modal() -> Paragraph<'static> {
    let lines = vec![
        Line::from("Help"),
        Line::from(""),
        Line::from("Ctrl+C   Cancel request / double to quit"),
        Line::from("Ctrl+K   Command palette"),
        Line::from("Ctrl+F   Search"),
        Line::from("Ctrl+A   Toggle activity overlay"),
        Line::from("Ctrl+D   Toggle debug overlay"),
        Line::from("Ctrl+E   Toggle multiline input"),
        Line::from("Tab      Cycle focus"),
        Line::from("Up/Down  Scroll or history (depends on focus)"),
        Line::from("PgUp/Dn  Scroll focused pane (incl. multiline input)"),
        Line::from("Enter    Toggle expand (Activity)"),
        Line::from("Ctrl+Enter  Send (multiline input)"),
        Line::from("g        Jump to turn (Activity)"),
        Line::from("y        Copy selected activity (Activity)"),
        Line::from("e        Jump last error (non-input panes)"),
        Line::from("t        Jump last tool_use (non-input panes)"),
        Line::from("n        Jump last turn_end (non-input panes)"),
        Line::from("F1       Toggle help"),
        Line::from(""),
        Line::from("Permission modal: Up/Down select, Enter decide"),
    ];

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Help").borders(Borders::ALL))
        .wrap(Wrap { trim: true })
}

fn centered_rect(
    percent_x: u16,
    percent_y: u16,
    r: ratatui::layout::Rect,
) -> ratatui::layout::Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints(
            [
                Constraint::Percentage((100 - percent_y) / 2),
                Constraint::Percentage(percent_y),
                Constraint::Percentage((100 - percent_y) / 2),
            ]
            .as_ref(),
        )
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints(
            [
                Constraint::Percentage((100 - percent_x) / 2),
                Constraint::Percentage(percent_x),
                Constraint::Percentage((100 - percent_x) / 2),
            ]
            .as_ref(),
        )
        .split(popup_layout[1])[1]
}

struct TerminalGuard {
    terminal: Terminal<CrosstermBackend<io::Stdout>>,
    restored: bool,
}

impl TerminalGuard {
    fn init() -> io::Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        terminal::enable_raw_mode()?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend)?;
        Ok(Self {
            terminal,
            restored: false,
        })
    }

    fn restore(&mut self) -> io::Result<()> {
        if self.restored {
            return Ok(());
        }
        disable_raw_mode()?;
        execute!(io::stdout(), LeaveAlternateScreen)?;
        self.restored = true;
        Ok(())
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

fn resolve_workdir(workdir: Option<&str>) -> io::Result<PathBuf> {
    if let Some(wd) = workdir {
        return Ok(PathBuf::from(wd));
    }
    std::env::current_dir()
}

fn resolve_tui_dir_for_logs() -> Option<String> {
    crate::app::storage::resolve_tui_state_dir().map(|p| p.display().to_string())
}

fn default_agent_cmd() -> Option<String> {
    Some("lace-agent".to_string())
}

fn update_chat_autoscroll(state: &mut AppState, area: ratatui::layout::Rect) {
    let Some(chat_rect) = compute_chat_rect(state, area) else {
        state.chat_max_scroll = 0;
        state.chat_scroll = 0;
        state.chat_follow = true;
        return;
    };

    let content_width = chat_rect.width.saturating_sub(2) as usize;
    let content_height = chat_rect.height.saturating_sub(2) as usize;

    let total_lines = chat_total_rendered_lines(state, content_width);
    let max_scroll = total_lines
        .saturating_sub(content_height)
        .min(u16::MAX as usize) as u16;

    state.chat_max_scroll = max_scroll;
    if state.chat_follow {
        state.chat_scroll = max_scroll;
    } else {
        state.chat_scroll = state.chat_scroll.min(max_scroll);
    }
}

fn chat_total_rendered_lines(state: &AppState, content_width: usize) -> usize {
    if content_width == 0 {
        return 0;
    }

    let mut total: usize = 0;
    let mut first_message = true;
    for m in &state.messages {
        // Blank line before message (except first)
        if !first_message {
            total += 1;
        }
        first_message = false;

        // Role label line ("you" or "assistant")
        let role_text = match m.role {
            Role::User => "you",
            Role::Assistant => "assistant",
        };
        total += wrapped_line_count(content_width, role_text);

        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        // Markdown rendering is always enabled
        for l in markdown::render_markdownish_lines(&text) {
            total += wrapped_line_count(content_width, &l.text);
        }
    }

    // Add lines for pending tool calls
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        total += 1; // blank line before tool calls
        total += pending_tools.len(); // one line per tool call
    }

    // Add lines for thinking indicator if showing
    if state.is_thinking() {
        total += 2; // blank line + thinking indicator line
    }

    // Add lines for inline permission UI if showing
    if let Some(req) = state.active_permission.as_ref() {
        total += permission_inline_line_count(state, req);
    }

    total
}

/// Calculates the number of lines the inline permission UI will take.
fn permission_inline_line_count(
    state: &AppState,
    req: &crate::app::PermissionRequest,
) -> usize {
    let mut count = 0;

    count += 1; // spacing
    count += 1; // tool name line

    // Resource line
    if req.resource.is_some() {
        count += 1;
    }

    // Tool input preview (up to 6 lines + possible "..." line)
    if let Some(tool_call_id) = &req.tool_call_id {
        if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
            let pretty =
                serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
            let line_count = pretty.lines().count();
            count += line_count.min(6);
            if line_count > 6 {
                count += 1; // "..." line
            }
        }
    }

    count += 1; // blank line
    count += 1; // "Allow this action?" line
    count += 1; // blank line

    // Options
    count += req.options.len();

    // Guidance input (separator + input row)
    count += 1; // separator line
    count += 1; // guidance input line

    count += 1; // blank line
    count += 1; // help text line

    count
}

fn wrapped_line_count(width: usize, line: &str) -> usize {
    let len = line.chars().count();
    ((len.max(1) + width - 1) / width).max(1)
}

/// Computes the rectangle where the chat (conversation) is rendered.
/// The chat is always shown as the primary view now - no split panes.
fn compute_chat_rect(
    state: &AppState,
    area: ratatui::layout::Rect,
) -> Option<ratatui::layout::Rect> {
    // Dynamic input height based on content, capped at 1/3 of screen
    let input_line_count = state.input_buffer.lines().count().max(1);
    let input_line_count = if state.input_buffer.ends_with('\n') {
        input_line_count + 1
    } else {
        input_line_count
    };
    let max_input_height = area.height / 3;
    let input_height = (input_line_count as u16).min(max_input_height).max(1);

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),               // main area (chat)
            Constraint::Length(input_height), // input
            Constraint::Length(1),            // status at BOTTOM
        ])
        .split(area);

    // Chat now takes the entire main_area - no debug/activity split panes
    Some(root[0])
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;
    use serde_json::json;

    #[test]
    fn vim_jk_remap_only_outside_input() {
        assert_eq!(
            remap_key_code(
                KeybindMode::Vim,
                Focus::Chat,
                KeyCode::Char('j'),
                KeyModifiers::NONE
            ),
            KeyCode::Down
        );
        assert_eq!(
            remap_key_code(
                KeybindMode::Vim,
                Focus::Chat,
                KeyCode::Char('k'),
                KeyModifiers::NONE
            ),
            KeyCode::Up
        );
        assert_eq!(
            remap_key_code(
                KeybindMode::Vim,
                Focus::Input,
                KeyCode::Char('j'),
                KeyModifiers::NONE
            ),
            KeyCode::Char('j')
        );
    }

    #[test]
    fn vim_does_not_remap_with_control_modifier() {
        assert_eq!(
            remap_key_code(
                KeybindMode::Vim,
                Focus::Chat,
                KeyCode::Char('j'),
                KeyModifiers::CONTROL
            ),
            KeyCode::Char('j')
        );
    }

    #[test]
    fn help_toggle_requires_f1_with_no_modifiers() {
        assert!(is_help_toggle_key(KeyCode::F(1), KeyModifiers::NONE));
        assert!(!is_help_toggle_key(KeyCode::F(1), KeyModifiers::SHIFT));
        assert!(!is_help_toggle_key(KeyCode::F(1), KeyModifiers::CONTROL));
        assert!(!is_help_toggle_key(KeyCode::Char('?'), KeyModifiers::SHIFT));
    }

    #[test]
    fn overlays_clear_their_rect_to_avoid_bleedthrough() {
        let mut state = AppState::new_with_paths(None, None);
        state.prefs.show_activity = false;
        state.prefs.show_debug = false;
        state.palette_open = true;
        state.messages.push(crate::app::ChatMessage {
            role: Role::Assistant,
            text: "X".repeat(200),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| draw(f, &state)).unwrap();

        let overlay = centered_rect(70, 60, ratatui::layout::Rect::new(0, 0, 80, 24));
        let x = overlay.x + 2;
        let y = overlay.y + overlay.height.saturating_sub(3);
        let cell = terminal.backend().buffer().cell((x, y)).unwrap();
        assert_ne!(cell.symbol(), "X");
    }

    #[test]
    fn auto_opens_config_wizard_when_prompt_requires_provider_config() {
        let mut state = AppState::new_with_paths(None, None);
        assert!(state.connection_id.is_none());
        assert!(state.model_id.is_none());
        assert!(!state.config_wizard.open);

        let out = maybe_open_config_wizard_for_prompt_error(
            &mut state,
            Some("session/prompt"),
            Some("Missing provider configuration: connectionId and modelId are required"),
        );

        assert!(state.config_wizard.open);
        assert_eq!(
            state.config_wizard.step,
            config_wizard::ConfigWizardStep::LoadingConnections
        );
        assert_eq!(out.len(), 1);
        match &out[0] {
            Outbound::JsonRpcRequest { method, .. } => assert_eq!(method, "ent/connections/list"),
            _ => panic!("expected request"),
        }
    }

    #[test]
    fn clears_active_connection_when_missing_from_connections_list() {
        let mut state = AppState::new_with_paths(None, None);
        state.connection_id = Some("c_missing".to_string());
        state.model_id = Some("m1".to_string());

        clear_invalid_active_connection_from_list(
            &mut state,
            &Some(json!({"connections":[{"connectionId":"c1"},{"connectionId":"c2"}]})),
        );

        assert!(state.connection_id.is_none());
        assert!(state.model_id.is_none());
    }

    #[test]
    fn keeps_active_connection_when_present_in_connections_list() {
        let mut state = AppState::new_with_paths(None, None);
        state.connection_id = Some("c1".to_string());
        state.model_id = Some("m1".to_string());

        clear_invalid_active_connection_from_list(
            &mut state,
            &Some(json!({"connections":[{"connectionId":"c1"},{"connectionId":"c2"}]})),
        );

        assert_eq!(state.connection_id.as_deref(), Some("c1"));
        assert_eq!(state.model_id.as_deref(), Some("m1"));
    }

    #[test]
    fn chat_autoscroll_follows_bottom_until_user_scrolls_up() {
        let mut state = AppState::new_with_paths(None, None);
        state.prefs.show_activity = false;
        state.prefs.show_debug = false;

        for i in 0..50 {
            state.messages.push(crate::app::ChatMessage {
                role: Role::Assistant,
                text: format!("line {i}"),
                streaming: false,
                turn_id: None,
                turn_seq: None,
            });
        }

        let area = ratatui::layout::Rect::new(0, 0, 80, 24);
        update_chat_autoscroll(&mut state, area);
        assert_eq!(state.chat_scroll, state.chat_max_scroll);
        assert!(state.chat_max_scroll > 0);

        state.focus = Focus::Chat;
        let _ = crate::app::ui::apply_ui_action(&mut state, crate::app::ui::UiAction::ScrollUp);
        assert!(!state.chat_follow);

        let before = state.chat_scroll;
        update_chat_autoscroll(&mut state, area);
        assert_eq!(state.chat_scroll, before);
    }

    #[test]
    fn format_token_count_uses_appropriate_suffix() {
        // Small numbers - no suffix
        assert_eq!(format_token_count(0), "0");
        assert_eq!(format_token_count(500), "500");
        assert_eq!(format_token_count(999), "999");

        // Thousands - k suffix
        assert_eq!(format_token_count(1000), "1.0k");
        assert_eq!(format_token_count(1500), "1.5k");
        assert_eq!(format_token_count(12345), "12.3k");
        assert_eq!(format_token_count(999_999), "1000.0k");

        // Millions - M suffix
        assert_eq!(format_token_count(1_000_000), "1.0M");
        assert_eq!(format_token_count(1_500_000), "1.5M");
        assert_eq!(format_token_count(10_000_000), "10.0M");
    }

    #[test]
    fn connections_models_modal_shows_legend_after_toggle() {
        use crate::app::connections::{ConnectionModelItem, toggle_selected_model};

        let mut state = AppState::new_with_paths(None, None);
        state.connections.open = true;
        state.connections.models.open = true;
        state.connections.models.loading = false;
        state.connections.models.connection_id = Some("conn-1".to_string());
        state.connections.models.connection_name = Some("Test Connection".to_string());
        state.connections.models.models = vec![
            ConnectionModelItem {
                model_id: "model-1".to_string(),
                name: "Model One".to_string(),
                disabled: false,
            },
            ConnectionModelItem {
                model_id: "model-2".to_string(),
                name: "Model Two".to_string(),
                disabled: false,
            },
        ];
        state.connections.models.selected = 0;

        // Render before toggle and check for legend
        let backend = TestBackend::new(80, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| draw(f, &state)).unwrap();

        let buffer = terminal.backend().buffer();
        let buffer_str: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        assert!(
            buffer_str.contains("Enter/Space toggle"),
            "Legend should be visible before toggle. Buffer content:\n{}",
            buffer_str
        );

        // Toggle the model
        let _out = toggle_selected_model(&mut state);

        // loading is now true, render again
        terminal.draw(|f| draw(f, &state)).unwrap();
        let buffer = terminal.backend().buffer();
        let buffer_str_loading: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        assert!(
            buffer_str_loading.contains("Enter/Space toggle"),
            "Legend should be visible during loading. Buffer content:\n{}",
            buffer_str_loading
        );

        // Simulate response: loading = false
        state.connections.models.loading = false;

        terminal.draw(|f| draw(f, &state)).unwrap();
        let buffer = terminal.backend().buffer();
        let buffer_str_after: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        assert!(
            buffer_str_after.contains("Enter/Space toggle"),
            "Legend should be visible after toggle. Buffer content:\n{}",
            buffer_str_after
        );
    }

    #[test]
    fn connections_models_modal_shows_legend_with_many_models() {
        use crate::app::connections::{ConnectionModelItem, toggle_selected_model};

        let mut state = AppState::new_with_paths(None, None);
        state.connections.open = true;
        state.connections.models.open = true;
        state.connections.models.loading = false;
        state.connections.models.connection_id = Some("conn-1".to_string());
        state.connections.models.connection_name = Some("Test Connection".to_string());

        // Create 20 models to test windowing
        state.connections.models.models = (0..20)
            .map(|i| ConnectionModelItem {
                model_id: format!("model-{}", i),
                name: format!("Model Number {}", i),
                disabled: false,
            })
            .collect();
        state.connections.models.selected = 10; // Select middle model

        // Render with a smaller terminal to trigger potential overflow
        let backend = TestBackend::new(80, 24);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|f| draw(f, &state)).unwrap();

        let buffer = terminal.backend().buffer();
        let buffer_str: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        // Before fix: This assertion would fail because max=18 is too large
        // After fix: max=12 should ensure legend is visible
        assert!(
            buffer_str.contains("Enter/Space toggle"),
            "Legend should be visible with many models before toggle. Buffer:\n{}",
            buffer_str
        );

        // Toggle the selected model
        let _out = toggle_selected_model(&mut state);

        // During loading, content shrinks significantly
        assert!(state.connections.models.loading);
        terminal.draw(|f| draw(f, &state)).unwrap();
        let buffer = terminal.backend().buffer();
        let buffer_str_loading: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        assert!(
            buffer_str_loading.contains("Enter/Space toggle"),
            "Legend should be visible during loading. Buffer:\n{}",
            buffer_str_loading
        );

        // After response, loading = false
        state.connections.models.loading = false;

        terminal.draw(|f| draw(f, &state)).unwrap();
        let buffer = terminal.backend().buffer();
        let buffer_str_after: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        assert!(
            buffer_str_after.contains("Enter/Space toggle"),
            "Legend should be visible with many models after toggle. Buffer:\n{}",
            buffer_str_after
        );
    }
}
