mod markdown;
pub mod theme;

use crate::app::activity;
use crate::app::config_wizard;
use crate::app::connections;
use crate::app::prefs::{KeybindMode, Theme};
use crate::app::reducer::{reduce, AppEvent, Outbound};
use crate::app::sessions;
use crate::app::ui::{all_slash_commands, apply_ui_action, UiAction};
use crate::app::AppState;
use crate::app::{Focus, Role};
use crate::args::Args;
use crate::protocol::bootstrap::bootstrap_session;
use crate::protocol::transport::AgentTransport;
use crate::protocol::{ent, jsonrpc};
use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyEventKind, KeyModifiers,
};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::execute;
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
fn input_text(state: &AppState) -> String {
    state.input.lines().join("\n")
}

fn prefetch_models_if_needed(
    transport: &AgentTransport,
    state: &mut AppState,
    timeout_ms: u64,
) -> io::Result<()> {
    if state.models_prefetched || state.connections.models.loading {
        return Ok(());
    }
    if let Some(_) = crate::app::connections::current_connection_id(state) {
        let out = crate::app::connections::request_models_for_current_connection(state);
        if !out.is_empty() {
            state.models_prefetched = true;
            send_outbound(transport, state, out, timeout_ms)?;
        }
    }
    Ok(())
}

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
    state.focus = Focus::Input; // Ensure typing works immediately on launch
    state.session_id = Some(bootstrap_result.session_id);
    state.slash_commands = bootstrap_result.slash_commands;
    state.messages = bootstrap_result.history;
    state.workdir = workdir.to_string_lossy().to_string();

    // Apply tool use history to activity list (for session reload)
    for tool in bootstrap_result.tool_history {
        activity::upsert_tool_use(
            &mut state,
            tool.tool_call_id,
            tool.name,
            tool.status,
            tool.input,
            tool.result,
            tool.job_id,
            tool.turn_id,
            tool.turn_seq,
        );
    }
    state.next_client_seq = 4; // Updated since we now send c_history request
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
    // Prefetch models if we already know a connection (from prefs/status)
    let _ = prefetch_models_if_needed(&transport, &mut state, args.timeout_ms);

    let mut terminal = TerminalGuard::init()?;
    let res = run_loop(
        &mut terminal.terminal,
        &transport,
        &mut state,
        args.timeout_ms,
    );
    terminal.restore()?;

    // Print session ID for resumption
    if let Some(session_id) = &state.session_id {
        eprintln!();
        eprintln!("Session: {session_id}");
        eprintln!("Resume with: lace-tui --load {session_id}");
    }

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
    let _log_keys = std::env::var("LACE_TUI_KEYLOG")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);

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
                Event::Key(key)
                    if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) =>
                {
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

                    // Debug: log all key events
                    state.push_debug_line(format!(
                        "key: {:?} mod: {:?} focus: {:?}",
                        key.code, key.modifiers, state.focus
                    ));

                    // Ctrl+V for image paste when in Input focus
                    if key.modifiers.contains(KeyModifiers::CONTROL)
                        && key.code == KeyCode::Char('v')
                        && state.focus == Focus::Input
                    {
                        state.push_debug_line("Ctrl+V detected, trying image paste".to_string());
                        let out = apply_ui_action(state, UiAction::PasteImage);
                        send_outbound(transport, state, out, timeout_ms)?;
                        continue;
                    }

                    if state.mcp_panel.open {
                        use crate::app::config_panels::McpPanelView;
                        let action = match state.mcp_panel.view {
                            McpPanelView::List => match key.code {
                                KeyCode::Esc => Some(UiAction::McpClose),
                                KeyCode::Up => Some(UiAction::McpPrev),
                                KeyCode::Down => Some(UiAction::McpNext),
                                KeyCode::Char('a') => Some(UiAction::McpAdd),
                                KeyCode::Char('e') => Some(UiAction::McpEdit),
                                KeyCode::Enter => Some(UiAction::McpEdit),
                                KeyCode::Char('d') => Some(UiAction::McpDelete),
                                KeyCode::Char('t') => Some(UiAction::McpTest),
                                _ => None,
                            },
                            McpPanelView::AddEdit => match key.code {
                                KeyCode::Esc => Some(UiAction::McpFormCancel),
                                KeyCode::Tab | KeyCode::Down => Some(UiAction::McpFormNext),
                                KeyCode::BackTab | KeyCode::Up => Some(UiAction::McpFormPrev),
                                KeyCode::Enter => {
                                    // In env field, Ctrl+Enter submits; Enter adds newline
                                    if state.mcp_panel.form_field == 4
                                        && !key.modifiers.contains(KeyModifiers::CONTROL) {
                                        Some(UiAction::McpFormNewline)
                                    } else {
                                        Some(UiAction::McpFormSubmit)
                                    }
                                }
                                KeyCode::Char(' ') if state.mcp_panel.form_field == 5 => {
                                    Some(UiAction::McpFormToggleEnabled)
                                }
                                KeyCode::Backspace => Some(UiAction::McpFormBackspace),
                                KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                                    Some(UiAction::McpFormChar(ch))
                                }
                                _ => None,
                            },
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
                        }
                        continue;
                    }

                    if state.context_viewer.open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::ContextViewerClose),
                            KeyCode::Up | KeyCode::PageUp => Some(UiAction::ContextViewerScrollUp),
                            KeyCode::Down | KeyCode::PageDown => Some(UiAction::ContextViewerScrollDown),
                            _ => None,
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

                    if state.active_permission.is_some() {
                        // Single-key shortcuts: Y/S/N/D for quick permission responses
                        // These only activate when the guidance input is empty
                        let action = if state.permission_guidance_input.is_empty()
                            && !key.modifiers.contains(KeyModifiers::CONTROL)
                        {
                            match key.code {
                                KeyCode::Char('y') | KeyCode::Char('Y') => {
                                    // Allow once (index 0)
                                    state.active_permission_selected = 0;
                                    Some(UiAction::PermissionSubmit)
                                }
                                KeyCode::Char('s') | KeyCode::Char('S') => {
                                    // Allow for session (index 1)
                                    state.active_permission_selected = 1;
                                    Some(UiAction::PermissionSubmit)
                                }
                                KeyCode::Char('n') | KeyCode::Char('N') => {
                                    Some(UiAction::PermissionCancel)
                                }
                                KeyCode::Char('d') | KeyCode::Char('D') => {
                                    Some(UiAction::PermissionToggleDetails)
                                }
                                KeyCode::Esc => Some(UiAction::PermissionCancel),
                                KeyCode::Enter => Some(UiAction::PermissionSubmit),
                                KeyCode::Up => Some(UiAction::PermissionPrev),
                                KeyCode::Down => Some(UiAction::PermissionNext),
                                KeyCode::Backspace => Some(UiAction::PermissionGuidanceBackspace),
                                KeyCode::Char(ch) => Some(UiAction::PermissionGuidanceChar(ch)),
                                _ => None,
                            }
                        } else {
                            // When guidance is being typed, process all keys normally
                            match key.code {
                                KeyCode::Esc => Some(UiAction::PermissionCancel),
                                KeyCode::Enter => Some(UiAction::PermissionSubmit),
                                KeyCode::Up => Some(UiAction::PermissionPrev),
                                KeyCode::Down => Some(UiAction::PermissionNext),
                                KeyCode::Backspace => Some(UiAction::PermissionGuidanceBackspace),
                                KeyCode::Char(ch)
                                    if !key.modifiers.contains(KeyModifiers::CONTROL) =>
                                {
                                    Some(UiAction::PermissionGuidanceChar(ch))
                                }
                                _ => None,
                            }
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

                    if state.tool_details_overlay_open {
                        match key.code {
                            KeyCode::Esc => {
                                state.tool_details_overlay_open = false;
                            }
                            KeyCode::Up | KeyCode::Char('k') => {
                                state.tool_details_overlay_scroll =
                                    state.tool_details_overlay_scroll.saturating_sub(1);
                            }
                            KeyCode::Down | KeyCode::Char('j') => {
                                state.tool_details_overlay_scroll =
                                    state.tool_details_overlay_scroll.saturating_add(1);
                            }
                            KeyCode::PageUp => {
                                state.tool_details_overlay_scroll =
                                    state.tool_details_overlay_scroll.saturating_sub(20);
                            }
                            KeyCode::PageDown => {
                                state.tool_details_overlay_scroll =
                                    state.tool_details_overlay_scroll.saturating_add(20);
                            }
                            _ => {}
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

                    // Slash command picker - shows when typing `/` commands
                    if state.slash_picker_open {
                        let action = match key.code {
                            KeyCode::Esc => Some(UiAction::SlashPickerClose),
                            KeyCode::Enter | KeyCode::Tab => Some(UiAction::SlashPickerSelect),
                            KeyCode::Up => Some(UiAction::SlashPickerPrev),
                            KeyCode::Down => Some(UiAction::SlashPickerNext),
                            KeyCode::Backspace => {
                                // Backspace in picker: update input and close if no longer starts with /
                                state.input.delete_char();
                                if !input_text(state).starts_with('/') {
                                    state.slash_picker_open = false;
                                } else {
                                    // Re-filter and reset selection
                                    state.slash_picker_selected = 0;
                                }
                                None
                            }
                        KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                            // Type into input while picker is open
                            state.input.insert_char(ch);
                            state.slash_picker_selected = 0;
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

                    // If user types a character while focus is elsewhere (and no modal is open),
                    // jump focus back to Input so typing always works from a blank screen.
                    if state.focus != Focus::Input
                        && !key.modifiers.contains(KeyModifiers::CONTROL)
                        && matches!(key.code, KeyCode::Char(_) | KeyCode::Backspace)
                    {
                        state.focus = Focus::Input;
                    }

                    if key.modifiers.contains(KeyModifiers::CONTROL) {
                        match key.code {
                            KeyCode::Char('f') => {
                                let _ = apply_ui_action(state, UiAction::OpenSearch);
                                continue;
                            }
                            KeyCode::Char('d') => {
                                state.debug_overlay_open = !state.debug_overlay_open;
                                state.activity_overlay_open = false; // Close activity if opening debug
                                continue;
                            }
                            KeyCode::Char('`') => {
                                // Cycle focus: Input -> Chat -> Input
                                // (Activity and Debug are overlays, not focus targets)
                                state.focus = match state.focus {
                                    Focus::Input => Focus::Chat,
                                    Focus::Chat | Focus::Activity | Focus::Debug => Focus::Input,
                                };
                                continue;
                            }
                            _ => {}
                        }
                    }

                    if is_help_toggle_key(key.code, key.modifiers) {
                        let _ = apply_ui_action(state, UiAction::ToggleHelp);
                        continue;
                    }

                    // F2 toggles activity overlay
                    if key.code == KeyCode::F(2) && key.modifiers.is_empty() {
                        state.activity_overlay_open = !state.activity_overlay_open;
                        state.debug_overlay_open = false;
                        continue;
                    }

                    let code = remap_key_code(
                        state.prefs.keybind_mode,
                        state.focus,
                        key.code,
                        key.modifiers,
                    );
                    let action = match code {
                        // Tab cycles options for slash commands, fallback to picker
                        KeyCode::Tab if state.focus == Focus::Input => {
                            if input_text(state).starts_with('/') {
                                let stripped =
                                    input_text(state).trim_start_matches('/').to_string();
                                let mut parts = stripped.split_whitespace();
                                let head_raw = parts.next().unwrap_or("");
                                let head = head_raw.to_lowercase();
                                let has_option_set = !head.is_empty()
                                    && all_slash_commands(state).into_iter().any(|cmd| {
                                        cmd.name
                                            .to_lowercase()
                                            .starts_with(&format!("{head} "))
                                    });

                                let suffix = parts.collect::<Vec<_>>().join(" ");
                                if has_option_set && suffix.is_empty() {
                                    // Show picker with sub-options instead of closing on space
                                    Some(UiAction::SlashPickerOpen)
                                } else if has_option_set {
                                    Some(UiAction::SlashCycleOption)
                                } else if !state.slash_commands.is_empty() {
                                    Some(UiAction::SlashPickerOpen)
                                } else {
                                    None
                                }
                            } else {
                                None // Tab does nothing without "/" prefix
                            }
                        }
                        KeyCode::PageUp => Some(UiAction::ScrollUp),
                        KeyCode::PageDown => Some(UiAction::ScrollDown),
                        KeyCode::Left if state.focus == Focus::Input => Some(UiAction::CursorLeft),
                        KeyCode::Right if state.focus == Focus::Input => Some(UiAction::CursorRight),
                        KeyCode::Home if state.focus == Focus::Input => Some(UiAction::CursorHome),
                        KeyCode::End if state.focus == Focus::Input => Some(UiAction::CursorEnd),
                        KeyCode::Delete if state.focus == Focus::Input => Some(UiAction::Delete),
                        KeyCode::Up => match state.focus {
                            Focus::Input => {
                                // In multi-line: up on first line goes to history, else moves cursor
                                let (row, _) = state.input.cursor();
                                let on_first_line = row == 0;
                                if on_first_line {
                                    Some(UiAction::HistoryPrev)
                                } else {
                                    Some(UiAction::CursorUp)
                                }
                            }
                            Focus::Activity => Some(UiAction::ActivityPrev),
                            Focus::Chat => Some(UiAction::ChatToolPrev),
                            Focus::Debug => Some(UiAction::ScrollUp),
                        },
                        KeyCode::Down => match state.focus {
                            Focus::Input => {
                                // In multi-line: down on last line goes to history, else moves cursor
                                let (row, _) = state.input.cursor();
                                let last_line = state.input.lines().len().saturating_sub(1);
                                let on_last_line = row >= last_line;
                                if on_last_line {
                                    Some(UiAction::HistoryNext)
                                } else {
                                    Some(UiAction::CursorDown)
                                }
                            }
                            Focus::Activity => Some(UiAction::ActivityNext),
                            Focus::Chat => Some(UiAction::ChatToolNext),
                            Focus::Debug => Some(UiAction::ScrollDown),
                        },
                        KeyCode::Enter => match state.focus {
                            // Alt+Enter inserts newline (Terminal.app sends Alt, not Shift)
                            Focus::Input if key.modifiers.contains(KeyModifiers::ALT) => {
                                Some(UiAction::InsertNewline)
                            }
                            // Ctrl+Enter sends
                            Focus::Input if key.modifiers.contains(KeyModifiers::CONTROL) => {
                                Some(UiAction::SendInput)
                            }
                            // Plain Enter sends
                            Focus::Input => Some(UiAction::Enter),
                            Focus::Activity => Some(UiAction::ActivityToggleExpanded),
                            Focus::Chat => Some(UiAction::ChatToolToggleExpanded),
                            Focus::Debug => None,
                        },
                        KeyCode::Backspace => match state.focus {
                            Focus::Input => Some(UiAction::Backspace),
                            _ => None,
                        },
                        // Emacs bindings for input field
                        KeyCode::Char('a')
                            if state.focus == Focus::Input
                                && key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::CursorHome)
                        }
                        KeyCode::Char('e')
                            if state.focus == Focus::Input
                                && key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::CursorEnd)
                        }
                        KeyCode::Char('k')
                            if state.focus == Focus::Input
                                && key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::KillToEnd)
                        }
                        KeyCode::Char('u')
                            if state.focus == Focus::Input
                                && key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::KillToStart)
                        }
                        KeyCode::Char('w')
                            if state.focus == Focus::Input
                                && key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::KillWordBack)
                        }
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
                        KeyCode::Esc if state.focus == Focus::Chat => {
                            Some(UiAction::ChatToolClearSelection)
                        }
                        KeyCode::Char('d') | KeyCode::Char('D')
                            if state.focus == Focus::Chat
                                && state.chat_selected_tool_idx.is_some()
                                && !key.modifiers.contains(KeyModifiers::CONTROL) =>
                        {
                            Some(UiAction::ChatToolOpenDetails)
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
                Event::Paste(text) => {
                    // Handle pasted text - insert directly without triggering submit
                    if state.focus == Focus::Input {
                        let out = apply_ui_action(state, UiAction::PasteText(text));
                        send_outbound(transport, state, out, timeout_ms)?;
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
                    let _ = prefetch_models_if_needed(transport, state, timeout_ms);
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
                        let _ = prefetch_models_if_needed(transport, state, timeout_ms);
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
                if method == "ent/models/list" {
                    // Always cache models for autocomplete; also update panel if open.
                    crate::app::connections::handle_models_list_response(
                        state,
                        &result,
                        error_message,
                    );
                    state.connections.models.loading = false;
                    state.models_prefetched = true;
                }
                // Note: Model toggling now uses ent/connections/upsert instead of
                // ent/models/enable/disable, which operates at the connection level
                // rather than provider level, avoiding issues with dynamic model catalogs.
                if method == "ent/models/refresh" && state.connections.models.open {
                    let out = crate::app::connections::open_models(state);
                    send_outbound(transport, state, out, timeout_ms)?;
                }

                // === MCP methods ===
                if method == "ent/mcp/servers/list" && state.mcp_panel.open {
                    crate::app::config_panels::mcp_handle_list_response(state, &result);
                }
                if method == "ent/mcp/servers/upsert" && state.mcp_panel.open {
                    crate::app::config_panels::mcp_handle_upsert_response(state, &result);
                    // Refresh list after upsert
                    if result.is_some() {
                        let out = crate::app::config_panels::mcp_open(state);
                        send_outbound(transport, state, out, timeout_ms)?;
                    }
                }
                if method == "ent/mcp/servers/delete" && state.mcp_panel.open {
                    crate::app::config_panels::mcp_handle_delete_response(state, &result);
                }
                if method == "ent/mcp/servers/test" && state.mcp_panel.open {
                    // Extract serverId from pending params to identify which server
                    if let Some(params) = pending_params.as_ref() {
                        if let Some(sid) = params.get("serverId").and_then(|v| v.as_str()) {
                            crate::app::config_panels::mcp_handle_test_response(state, sid, &result);
                        }
                    }
                }

                // === Context viewer ===
                if method == "ent/session/context_breakdown" && state.context_viewer.open {
                    crate::app::config_panels::context_handle_response(state, &result);
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
            AppEvent::TurnStart { .. } => {
                // TurnStart is handled by reduce() which updates current_turn_id/seq
            }
            AppEvent::TextDelta { .. } => {
                // TextDelta is handled by reduce() which appends to streaming message
            }
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
                // Use current turn context as fallback when event doesn't have turn_id
                let effective_turn_id = turn_id
                    .clone()
                    .or_else(|| state.current_turn_id.clone());
                let effective_turn_seq = turn_seq.or(state.current_turn_seq);

                activity::upsert_tool_use(
                    state,
                    tool_call_id.clone(),
                    name.clone(),
                    status.clone(),
                    input.clone(),
                    result.clone(),
                    job_id.clone(),
                    effective_turn_id,
                    effective_turn_seq,
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

fn input_lines_with_cursor(state: &AppState) -> Vec<String> {
    let mut lines: Vec<String> = state.input.lines().to_vec();
    if lines.is_empty() {
        lines.push(String::new());
    }
    let (row, _) = state.input.cursor();
    if row >= lines.len() {
        lines.resize(row + 1, String::new());
    }
    lines
}

/// Count how many visual lines the input buffer will take when wrapped.
/// Accounts for the prompt prefix ("> " or "  ") on each line.
fn count_input_wrapped_lines(lines: &[String], cursor_row: usize, content_width: usize) -> usize {
    if content_width == 0 {
        return 1;
    }

    let mut total = 0;
    for line in lines {
        // Each logical line takes at least 1 visual line
        // Additional lines are needed if the content wraps
        let line_len = line.chars().count();
        if line_len == 0 {
            total += 1;
        } else {
            // Calculate wrapped lines: ceiling division
            total += (line_len + content_width - 1) / content_width;
        }
    }

    total = total.max(cursor_row + 1);

    total.max(1)
}

fn draw(f: &mut ratatui::Frame, state: &AppState) {
    // Dynamic input height based on content, accounting for wrapped lines
    // Input width is roughly the terminal width minus prompt prefix ("> " or "N> " for images)
    let prompt_width = if state.pending_images.is_empty() {
        2 // "> "
    } else {
        state.pending_images.len().to_string().len() + 2 // "N> "
    };
    let input_content_width = f.area().width.saturating_sub(prompt_width as u16 + 1) as usize;
    let lines = input_lines_with_cursor(state);
    let (cursor_row, _) = state.input.cursor();
    let input_line_count = count_input_wrapped_lines(&lines, cursor_row, input_content_width);
    let max_input_height = f.area().height / 3;
    let input_height = (input_line_count as u16).min(max_input_height).max(1);

    // Permission bar: dynamic height based on expanded state
    let permission_height = permission_bar_height(state);

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),                    // main area
            Constraint::Length(permission_height), // permission bar (when active)
            Constraint::Length(1),                 // status (above input)
            Constraint::Length(input_height),      // input at BOTTOM
        ])
        .split(f.area());

    let main_area = root[0];
    let permission_area = root[1];
    let status_area = root[2];
    let input_area = root[3];

    // Split status area into left (info) and right (progress indicator)
    let right_width = status_right_width(state);
    let status_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(right_width),
        ])
        .split(status_area);

    f.render_widget(render_status_left(state), status_layout[0]);
    f.render_widget(render_status_right(state), status_layout[1]);

    // Main area: show overlays if open, otherwise conversation
    if state.tool_details_overlay_open {
        f.render_widget(render_tool_details_overlay(state), main_area);
    } else if state.debug_overlay_open {
        f.render_widget(render_debug_overlay(state), main_area);
    } else if state.activity_overlay_open {
        f.render_widget(render_activity_overlay(state), main_area);
    } else {
        render_main(f, state, main_area);
    }
    render_input(f, state, input_area);

    // Render permission bar when active (above input area)
    if state.active_permission.is_some() {
        f.render_widget(render_permission_bar(state), permission_area);
    }

    // Slash command picker appears just above the input area
    if state.slash_picker_open {
        // Calculate picker area: above the input, same width, 12 lines tall
        let picker_height = 12u16;
        let picker_y = input_area.y.saturating_sub(picker_height);
        // Dynamic width: use longest line up to input width
        let max_line = crate::app::ui::filtered_slash_commands(state)
            .iter()
            .map(|c| c.name.len() + c.description.len() + 6) // rough estimate with markers
            .max()
            .unwrap_or(20) as u16;
        let picker_width = max_line
            .saturating_add(4)
            .min(input_area.width)
            .max(30);
        let picker_area = ratatui::layout::Rect {
            x: input_area.x,
            y: picker_y,
            width: picker_width,
            height: picker_height,
        };
        f.render_widget(Clear, picker_area);
        f.render_widget(render_slash_picker(state), picker_area);
    }

    // Centered modal overlays (permission is now rendered as a bottom bar, not here)
    if state.context_viewer.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_context_modal(state), area);
    } else if state.mcp_panel.open {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_mcp_modal(state), area);
    } else if state.env_editor.open {
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
    } else if state.help_open {
        let area = centered_rect(70, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_help_modal(state), area);
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

/// Renders the left part of status bar (model, provider, tokens, workdir)
fn render_status_left(state: &AppState) -> Paragraph<'static> {
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

    let spans = vec![
        Span::raw(" "),
        Span::styled(model, Style::default().fg(colors.fg_primary)),
        sep.clone(),
        Span::styled(provider, Style::default().fg(colors.fg_muted)),
        sep.clone(),
        Span::styled(
            format!("{tokens} tokens"),
            Style::default().fg(colors.fg_muted),
        ),
        sep,
        Span::styled(short_workdir, Style::default().fg(colors.fg_muted)),
    ];

    let text = Line::from(spans);
    Paragraph::new(text).style(Style::default().bg(colors.bg_surface))
}

/// Renders the right part of status bar (progress indicator)
fn render_status_right(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut spans: Vec<Span> = Vec::new();

    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        if let Some(tool) = pending_tools.first() {
            let tool_name = tool
                .tool_name
                .clone()
                .unwrap_or_else(|| "working".to_string());
            spans.push(Span::styled(
                format!("{} {} ", spinning_char(), tool_name),
                Style::default().fg(colors.spinner),
            ));
        }
    } else if state.is_thinking() {
        spans.push(Span::styled(
            format!("{} ", spinning_char()),
            Style::default().fg(colors.spinner),
        ));
    }
    // No hints or key display when idle - keep it clean

    Paragraph::new(Line::from(spans)).style(Style::default().bg(colors.bg_surface))
}

/// Calculate the width needed for the right status bar section
fn status_right_width(state: &AppState) -> u16 {
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        if let Some(tool) = pending_tools.first() {
            let tool_name = tool
                .tool_name
                .clone()
                .unwrap_or_else(|| "working".to_string());
            // "⠋ tool_name " = spinner(1) + space(1) + name + space(1)
            (3 + tool_name.len()) as u16
        } else {
            0
        }
    } else if state.is_thinking() {
        2 // "⠋ " = spinner + space
    } else {
        0 // Nothing when idle
    }
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
            // Show filter input
            lines.push(Line::from(vec![
                Span::styled("Filter: ", Style::default().fg(colors.fg_muted)),
                Span::styled(w.model_filter.clone(), Style::default().fg(colors.fg_primary)),
                Span::styled("▌", Style::default().fg(colors.accent)),
            ]));
            lines.push(Line::from(""));

            // Get filtered models (clone names for 'static lifetime)
            let filtered: Vec<String> = config_wizard::filtered_models(state)
                .iter()
                .map(|m| m.name.clone())
                .collect();
            if filtered.is_empty() {
                lines.push(Line::from(Span::styled(
                    "No matching models",
                    Style::default().fg(colors.fg_muted),
                )));
            } else {
                lines.push(Line::from(Span::styled(
                    format!("Select model ({} available):", filtered.len()),
                    Style::default().fg(colors.fg_secondary),
                )));
                let max = 16usize;
                let start = w.selected.saturating_sub(max / 2);
                let end = (start + max).min(filtered.len());
                for i in start..end {
                    let selected = i == w.selected;
                    let marker = if selected { "▸ " } else { "  " };
                    let style = if selected {
                        Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                    } else {
                        Style::default().fg(colors.fg_secondary)
                    };
                    lines.push(Line::from(Span::styled(format!("{marker}{}", filtered[i]), style)));
                }
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

fn render_context_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Title
    lines.push(Line::from(Span::styled(
        "Context Usage",
        Style::default()
            .fg(colors.fg_primary)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    if state.context_viewer.loading {
        lines.push(Line::from(Span::styled(
            "Loading context breakdown...",
            Style::default().fg(colors.fg_muted),
        )));
    } else if let Some(err) = &state.context_viewer.error {
        lines.push(Line::from(Span::styled(
            format!("Error: {err}"),
            Style::default().fg(colors.error),
        )));
    } else if let Some(breakdown) = &state.context_viewer.breakdown {
        // Summary stats
        let used_pct = breakdown.percent_used;
        let bar_width = 40;
        let filled = ((used_pct as usize) * bar_width / 100).min(bar_width);
        let bar: String = "█".repeat(filled) + &"░".repeat(bar_width - filled);

        lines.push(Line::from(vec![
            Span::styled("Model: ", Style::default().fg(colors.fg_muted)),
            Span::styled(breakdown.model_id.clone(), Style::default().fg(colors.fg_primary)),
        ]));
        lines.push(Line::from(""));

        lines.push(Line::from(vec![
            Span::styled(
                format!("{bar} {used_pct}%"),
                if used_pct > 80 {
                    Style::default().fg(colors.warning)
                } else {
                    Style::default().fg(colors.accent)
                },
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                format!(
                    "{} / {} tokens",
                    format_tokens(breakdown.total_used_tokens),
                    format_tokens(breakdown.context_limit)
                ),
                Style::default().fg(colors.fg_muted),
            ),
        ]));
        lines.push(Line::from(""));

        // Category breakdown with bars
        let categories = [
            ("System Prompt", breakdown.system_prompt.tokens, colors.accent),
            ("Core Tools", breakdown.core_tools.tokens, colors.fg_secondary),
            ("MCP Tools", breakdown.mcp_tools.tokens, colors.warning),
            ("Messages", breakdown.messages.tokens, colors.success),
            ("Reserved", breakdown.reserved_for_response.tokens, colors.fg_muted),
            ("Free Space", breakdown.free_space.tokens, colors.border_subtle),
        ];

        let max_tokens = breakdown.context_limit.max(1);
        for (label, tokens, color) in categories {
            if tokens > 0 || label == "Free Space" {
                let pct = (tokens * 100 / max_tokens) as usize;
                let mini_bar_filled = (pct * 20 / 100).min(20);
                let mini_bar: String = "▓".repeat(mini_bar_filled) + &"░".repeat(20 - mini_bar_filled);

                lines.push(Line::from(vec![
                    Span::styled(format!("{label:<16}"), Style::default().fg(colors.fg_muted)),
                    Span::styled(mini_bar, Style::default().fg(color)),
                    Span::styled(
                        format!(" {:>8} ({:>2}%)", format_tokens(tokens), pct),
                        Style::default().fg(colors.fg_secondary),
                    ),
                ]));
            }
        }

        // Message subcategories if messages have tokens
        if breakdown.messages.tokens > 0 {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Message Breakdown:",
                Style::default().fg(colors.fg_muted),
            )));

            let subs = &breakdown.message_subcategories;
            let sub_items = [
                ("  User Messages", subs.user_messages),
                ("  Agent Messages", subs.agent_messages),
                ("  Tool Calls", subs.tool_calls),
                ("  Tool Results", subs.tool_results),
            ];

            for (label, tokens) in sub_items {
                if tokens > 0 {
                    lines.push(Line::from(vec![
                        Span::styled(format!("{label:<18}"), Style::default().fg(colors.fg_muted)),
                        Span::styled(
                            format!("{:>8}", format_tokens(tokens)),
                            Style::default().fg(colors.fg_secondary),
                        ),
                    ]));
                }
            }
        }

        // Show all core tools
        if !breakdown.core_tools.items.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                format!("Core Tools ({}):", breakdown.core_tools.items.len()),
                Style::default().fg(colors.fg_muted),
            )));

            for tool in &breakdown.core_tools.items {
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {}", tool.name),
                        Style::default().fg(colors.fg_secondary),
                    ),
                    Span::styled(
                        format!("  {:>8}", format_tokens(tool.tokens)),
                        Style::default().fg(colors.fg_muted),
                    ),
                ]));
            }
        }

        // Show all MCP tools
        if !breakdown.mcp_tools.items.is_empty() {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                format!("MCP Tools ({}):", breakdown.mcp_tools.items.len()),
                Style::default().fg(colors.fg_muted),
            )));

            for tool in &breakdown.mcp_tools.items {
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {}", tool.name),
                        Style::default().fg(colors.fg_secondary),
                    ),
                    Span::styled(
                        format!("  {:>8}", format_tokens(tool.tokens)),
                        Style::default().fg(colors.fg_muted),
                    ),
                ]));
            }
        }
    } else {
        lines.push(Line::from(Span::styled(
            "No context data available",
            Style::default().fg(colors.fg_muted),
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "Esc close",
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

fn format_tokens(tokens: u64) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}K", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

fn render_mcp_modal(state: &AppState) -> Paragraph<'static> {
    use crate::app::config_panels::McpPanelView;

    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    match state.mcp_panel.view {
        McpPanelView::List => {
            // Title
            lines.push(Line::from(Span::styled(
                "MCP Servers",
                Style::default()
                    .fg(colors.fg_primary)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            if state.mcp_panel.loading {
                lines.push(Line::from(Span::styled(
                    "Loading...",
                    Style::default().fg(colors.fg_muted),
                )));
            } else if state.mcp_panel.servers.is_empty() {
                lines.push(Line::from(Span::styled(
                    "No MCP servers configured",
                    Style::default().fg(colors.fg_muted),
                )));
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "Press 'a' to add a server",
                    Style::default().fg(colors.fg_secondary),
                )));
            } else {
                let max = 15usize;
                let start = state.mcp_panel.selected.saturating_sub(max / 2);
                let end = (start + max).min(state.mcp_panel.servers.len());
                for i in start..end {
                    let selected = i == state.mcp_panel.selected;
                    let marker = if selected { "▸ " } else { "  " };
                    let server = &state.mcp_panel.servers[i];

                    let status_str = server.status.as_str();
                    let enabled_str = if server.enabled { "" } else { " [disabled]" };
                    let tools_str = server
                        .tool_count
                        .map(|n| format!(" ({n} tools)"))
                        .unwrap_or_default();
                    let cmd_str = if server.args.is_empty() {
                        server.command.clone()
                    } else {
                        format!("{} {}", server.command, server.args.join(" "))
                    };

                    let style = if selected {
                        Style::default().fg(colors.fg_primary).bg(colors.bg_surface)
                    } else {
                        Style::default().fg(colors.fg_secondary)
                    };

                    lines.push(Line::from(vec![
                        Span::styled(marker.to_string(), style),
                        Span::styled(format!("[{}] ", status_str), Style::default().fg(colors.fg_muted)),
                        Span::styled(server.name.clone(), style.add_modifier(Modifier::BOLD)),
                        Span::styled(format!("{enabled_str}{tools_str}"), Style::default().fg(colors.fg_muted)),
                    ]));
                    lines.push(Line::from(vec![
                        Span::styled("    ", style),
                        Span::styled(cmd_str, Style::default().fg(colors.fg_muted)),
                    ]));

                    if let Some(err) = &server.error {
                        lines.push(Line::from(vec![
                            Span::styled("    ", style),
                            Span::styled(format!("Error: {err}"), Style::default().fg(colors.error)),
                        ]));
                    }
                }
            }

            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "a add • e edit • d delete • t test • Esc close",
                Style::default().fg(colors.fg_muted),
            )));
        }

        McpPanelView::AddEdit => {
            let is_edit = state.mcp_panel.edit_server_id.is_some();
            let title = if is_edit { "Edit MCP Server" } else { "Add MCP Server" };

            lines.push(Line::from(Span::styled(
                title,
                Style::default()
                    .fg(colors.fg_primary)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));

            // Form fields
            let fields = [
                ("ID", &state.mcp_panel.form_id, 0, is_edit),
                ("Name", &state.mcp_panel.form_name, 1, false),
                ("Command", &state.mcp_panel.form_command, 2, false),
                ("Args", &state.mcp_panel.form_args, 3, false),
            ];

            for (label, value, field_idx, readonly) in &fields {
                let is_selected = state.mcp_panel.form_field == *field_idx;
                let label_style = if is_selected {
                    Style::default().fg(colors.accent)
                } else {
                    Style::default().fg(colors.fg_muted)
                };
                let value_style = if is_selected {
                    Style::default().fg(colors.fg_primary)
                } else if *readonly {
                    Style::default().fg(colors.fg_muted)
                } else {
                    Style::default().fg(colors.fg_secondary)
                };

                let readonly_marker = if *readonly { " (readonly)" } else { "" };
                let cursor = if is_selected { "▌" } else { "" };

                lines.push(Line::from(vec![
                    Span::styled(format!("{label}{readonly_marker}: "), label_style),
                    Span::styled(value.to_string(), value_style),
                    Span::styled(cursor, Style::default().fg(colors.accent)),
                ]));
            }

            // Env field (multi-line)
            let is_env_selected = state.mcp_panel.form_field == 4;
            let env_label_style = if is_env_selected {
                Style::default().fg(colors.accent)
            } else {
                Style::default().fg(colors.fg_muted)
            };
            lines.push(Line::from(Span::styled("Env (KEY=VALUE, one per line):", env_label_style)));
            let env_lines: Vec<&str> = state.mcp_panel.form_env.lines().collect();
            if env_lines.is_empty() {
                let cursor = if is_env_selected { "▌" } else { "" };
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(cursor, Style::default().fg(colors.accent)),
                ]));
            } else {
                for (i, line) in env_lines.iter().enumerate() {
                    let is_last = i == env_lines.len() - 1;
                    let cursor = if is_env_selected && is_last { "▌" } else { "" };
                    lines.push(Line::from(vec![
                        Span::styled(format!("  {line}"), Style::default().fg(colors.fg_secondary)),
                        Span::styled(cursor, Style::default().fg(colors.accent)),
                    ]));
                }
            }

            // Enabled checkbox
            let is_enabled_selected = state.mcp_panel.form_field == 5;
            let enabled_style = if is_enabled_selected {
                Style::default().fg(colors.accent)
            } else {
                Style::default().fg(colors.fg_muted)
            };
            let checkbox = if state.mcp_panel.form_enabled { "[x]" } else { "[ ]" };
            lines.push(Line::from(Span::styled(
                format!("{checkbox} Enabled"),
                enabled_style,
            )));

            if let Some(err) = &state.mcp_panel.form_error {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    format!("Error: {err}"),
                    Style::default().fg(colors.error),
                )));
            }

            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Tab/↑↓ navigate • Space toggle enabled • Enter submit • Esc cancel",
                Style::default().fg(colors.fg_muted),
            )));
        }
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

fn render_slash_picker(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Filter slash commands (agent + local) based on current input
    let filtered = crate::app::ui::filtered_slash_commands(state);

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

        // Build spans for the command line
        let mut spans = vec![
            Span::styled(marker, style),
            Span::styled(format!("/{}", cmd.name), name_style),
            Span::styled(format!(" - {}", cmd.description), desc_style),
        ];

        // Add source badge for user commands
        if cmd.source.as_deref() == Some("user") {
            let badge_style = if selected {
                Style::default().fg(colors.accent).bg(colors.bg_surface)
            } else {
                Style::default().fg(colors.accent)
            };
            spans.push(Span::styled(" (user)", badge_style));
        }

        lines.push(Line::from(spans));
    }

    if filtered.is_empty() {
        if input_text(state)
            .trim_start()
            .starts_with("/model")
            && state.connections.models.loading
        {
            lines.push(Line::from(Span::styled(
                "  Loading models…",
                Style::default().fg(colors.fg_muted),
            )));
        } else {
            lines.push(Line::from(Span::styled(
                "  No matching commands",
                Style::default().fg(colors.fg_muted),
            )));
        }
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

/// Calculate permission bar height (for layout)
fn permission_bar_height(state: &AppState) -> u16 {
    if state.active_permission.is_none() {
        return 0;
    }
    if state.permission_details_expanded {
        // Base (3) + detail lines (up to 10)
        let detail_lines = state
            .active_permission
            .as_ref()
            .and_then(|req| req.tool_call_id.as_ref())
            .and_then(|id| state.tool_inputs_by_tool_call_id.get(id))
            .map(|input| {
                let pretty = serde_json::to_string_pretty(input).unwrap_or_default();
                pretty.lines().count().min(9) + 2 // +2 for resource and ... line
            })
            .unwrap_or(1) as u16;
        3 + detail_lines
    } else {
        3 // Compact: top border, shortcuts, bottom border
    }
}

/// Renders a compact permission bar for bottom-anchored display.
/// Shows tool name, resource preview, and keyboard shortcuts.
/// When expanded, shows full resource and tool input JSON.
fn render_permission_bar(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let Some(req) = &state.active_permission else {
        return Paragraph::new(Text::from(""));
    };

    let tool = req.tool.clone().unwrap_or_else(|| "unknown".to_string());
    let resource = req.resource.clone().unwrap_or_default();
    let resource_preview = if state.permission_details_expanded {
        resource.clone() // Show full resource when expanded
    } else if resource.len() > 40 {
        format!("{}...", &resource[..37])
    } else {
        resource.clone()
    };

    let mut lines: Vec<Line> = Vec::new();

    // Subtle top border line
    lines.push(Line::from(vec![Span::styled(
        "────────────────────────────────────────────────────────────────────",
        Style::default().fg(colors.border_subtle),
    )]));

    // Tool name line with colored background
    lines.push(Line::from(vec![
        Span::styled("  Allow ", Style::default().fg(colors.fg_primary)),
        Span::styled(
            tool,
            Style::default()
                .fg(colors.accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" {} ", resource_preview),
            Style::default().fg(colors.fg_muted),
        ),
        Span::styled("?", Style::default().fg(colors.fg_primary)),
    ]));

    // Shortcut line - change [D] label based on expanded state
    let details_label = if state.permission_details_expanded {
        " Hide"
    } else {
        " Details"
    };
    lines.push(Line::from(vec![
        Span::styled("  ", Style::default()),
        Span::styled(
            "[Y]",
            Style::default()
                .fg(colors.success)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Allow   ", Style::default().fg(colors.fg_secondary)),
        Span::styled(
            "[S]",
            Style::default()
                .fg(colors.accent)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Session   ", Style::default().fg(colors.fg_secondary)),
        Span::styled(
            "[N]",
            Style::default()
                .fg(colors.error)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Deny   ", Style::default().fg(colors.fg_secondary)),
        Span::styled("[D]", Style::default().fg(colors.fg_muted)),
        Span::styled(details_label, Style::default().fg(colors.fg_muted)),
    ]));

    // When expanded, show resource and tool input details
    if state.permission_details_expanded {
        // Resource line (full, not truncated)
        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled("Resource: ", Style::default().fg(colors.fg_secondary)),
            Span::styled(resource, Style::default().fg(colors.fg_primary)),
        ]));

        // Tool input JSON from tool_inputs_by_tool_call_id
        if let Some(tool_call_id) = &req.tool_call_id {
            if let Some(input) = state.tool_inputs_by_tool_call_id.get(tool_call_id) {
                let pretty = serde_json::to_string_pretty(input).unwrap_or_default();
                let input_lines: Vec<&str> = pretty.lines().collect();
                let max_lines = 8;
                let show_truncation = input_lines.len() > max_lines;

                for (i, line) in input_lines.iter().take(max_lines).enumerate() {
                    let prefix = if i == 0 { "Input: " } else { "       " };
                    lines.push(Line::from(vec![
                        Span::styled("  ", Style::default()),
                        Span::styled(prefix, Style::default().fg(colors.fg_secondary)),
                        Span::styled(
                            (*line).to_string(),
                            Style::default().fg(colors.fg_muted),
                        ),
                    ]));
                }

                if show_truncation {
                    lines.push(Line::from(vec![
                        Span::styled("  ", Style::default()),
                        Span::styled(
                            "       ... (truncated)",
                            Style::default().fg(colors.fg_muted),
                        ),
                    ]));
                }
            }
        }
    }

    Paragraph::new(Text::from(lines)).style(Style::default().bg(colors.bg_surface))
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

/// Extracts items array from a todo_read result.
/// The result structure is: { content: [{ type: "text", text: "{\"items\": [...]}" }] }
fn extract_todo_items(result: &Value) -> Option<Vec<Value>> {
    // Try direct items field first (for tests and simpler cases)
    if let Some(items) = result.get("items").and_then(|v| v.as_array()) {
        return Some(items.clone());
    }

    // Extract from content array: content[].text is a JSON string containing { items: [...] }
    let content = result.get("content")?.as_array()?;
    let text_content = content.iter().find_map(|c| {
        if c.get("type").and_then(|t| t.as_str()) == Some("text") {
            c.get("text").and_then(|t| t.as_str())
        } else {
            None
        }
    })?;

    // Parse the JSON string
    let parsed: Value = serde_json::from_str(text_content).ok()?;
    parsed.get("items")?.as_array().cloned()
}

/// Formats todo_read result as pretty-printed lines.
/// Returns None if the result doesn't look like a todo list.
fn format_todo_read_result(result: &Value, colors: &theme::ThemeColors) -> Option<Vec<Line<'static>>> {
    let items = extract_todo_items(result)?;
    if items.is_empty() {
        return Some(vec![Line::from(Span::styled(
            "  (no items)",
            Style::default().fg(colors.fg_muted),
        ))]);
    }

    let mut lines = Vec::new();
    for item in &items {
        let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("pending");
        // Support both "title" and "content" field names (Claude Code uses "content")
        let title = item
            .get("content")
            .or_else(|| item.get("title"))
            .and_then(|v| v.as_str())
            .unwrap_or("(untitled)");

        // Support both "done"/"completed" for done state
        let is_done = status == "done" || status == "completed";
        let is_in_progress = status == "in_progress";

        let (checkbox, status_color) = if is_done {
            ("[x]", colors.success)
        } else if is_in_progress {
            ("[>]", colors.accent) // in-progress indicator
        } else {
            ("[ ]", colors.fg_muted)
        };

        lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(checkbox, Style::default().fg(status_color)),
            Span::styled(" ", Style::default()),
            Span::styled(title.to_string(), Style::default().fg(colors.fg_primary)),
        ]));

        // Add activeForm if present (shows what's currently happening)
        if let Some(active_form) = item.get("activeForm").and_then(|v| v.as_str()) {
            if is_in_progress {
                lines.push(Line::from(Span::styled(
                    format!("      {active_form}"),
                    Style::default().fg(colors.accent),
                )));
            }
        }
    }
    Some(lines)
}

/// Formats todo_write input/result as a summary line.
fn format_todo_write_summary(input: &Value, _result: Option<&Value>) -> String {
    // Claude Code TodoWrite takes { todos: [{content, status, activeForm}] }
    if let Some(todos) = input.get("todos").and_then(|v| v.as_array()) {
        if todos.is_empty() {
            return "clear all".to_string();
        }

        // Count items by status
        let mut pending = 0;
        let mut in_progress = 0;
        let mut completed = 0;

        for todo in todos {
            match todo.get("status").and_then(|v| v.as_str()) {
                Some("completed") | Some("done") => completed += 1,
                Some("in_progress") => in_progress += 1,
                _ => pending += 1,
            }
        }

        // Build summary
        let mut parts = Vec::new();
        if in_progress > 0 {
            parts.push(format!("{} active", in_progress));
        }
        if pending > 0 {
            parts.push(format!("{} pending", pending));
        }
        if completed > 0 {
            parts.push(format!("{} done", completed));
        }

        if parts.is_empty() {
            format!("{} items", todos.len())
        } else {
            parts.join(", ")
        }
    } else {
        // Fallback for legacy single-item format
        "update".to_string()
    }
}

/// Counts the number of lines a tool call will render to.
/// This mirrors the logic of `render_tool_call_line` but only counts lines.
/// Used by `chat_total_rendered_lines` to calculate scroll height.
fn tool_call_line_count(item: &activity::ActivityItem, selected: bool, expanded: bool) -> usize {
    let mut count = 1; // Always one base line for tool summary

    let tool_name = item
        .tool_name
        .as_ref()
        .map(|s| s.as_str())
        .unwrap_or("unknown");
    let is_complete =
        item.status.as_deref() == Some("completed") || item.status.as_deref() == Some("success");

    if selected && expanded {
        // When expanded: up to 16 detail lines (15 JSON lines + maybe truncation)
        if let Some(details) = &item.details {
            let pretty =
                serde_json::to_string_pretty(details).unwrap_or_else(|_| details.to_string());
            let line_count = pretty.lines().count();
            if line_count > 15 {
                count += 16; // 15 lines + truncation indicator
            } else {
                count += line_count;
            }
        }
    } else if is_complete {
        // Folded result preview for completed tools
        if tool_name == "todo_read" {
            // Count todo items (each item = 1 line, +1 for activeForm if in_progress)
            let result = item.details.as_ref().and_then(|d| d.get("result"));
            if let Some(res) = result {
                if let Some(items) = extract_todo_items(res) {
                    if items.is_empty() {
                        count += 1; // "(no items)" line
                    } else {
                        for todo_item in &items {
                            count += 1; // content line
                            // Add line for activeForm if in_progress
                            let status = todo_item
                                .get("status")
                                .and_then(|v| v.as_str())
                                .unwrap_or("pending");
                            if status == "in_progress"
                                && todo_item.get("activeForm").is_some()
                            {
                                count += 1;
                            }
                        }
                    }
                }
            }
        } else if item.result_preview.is_some() {
            count += 1; // Result preview line
        }
    }

    count
}

/// Renders a tool call with status indicator and optional folded result.
/// When `selected` is true, adds a selection marker and background.
/// When `expanded` is true (and selected), shows detailed JSON output.
fn render_tool_call_line(
    item: &activity::ActivityItem,
    colors: &theme::ThemeColors,
    selected: bool,
    expanded: bool,
) -> Vec<Line<'static>> {
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

    let mut lines = Vec::new();

    // Subagent/job indent: add visual nesting for delegated tool calls
    let job_indent = if item.job_id.is_some() { "  " } else { "" };

    // Selection prefix
    let sel_prefix = if selected { "\u{25B8} " } else { "  " }; // ▸ when selected

    // Base style with optional background for selection
    let base_style = if selected {
        Style::default().bg(colors.bg_surface)
    } else {
        Style::default()
    };

    // Extract input/result for special tool handling
    let input = item.details.as_ref().and_then(|d| d.get("input"));
    let result = item.details.as_ref().and_then(|d| d.get("result"));

    // Main tool line with command/summary
    let summary = if tool_name == "todo_write" {
        // Use custom summary for todo_write
        if let Some(inp) = input {
            format!(" {}", format_todo_write_summary(inp, result))
        } else {
            String::new()
        }
    } else if tool_name == "todo_read" {
        // For todo_read, just show "reading..." or item count
        if let Some(res) = result {
            // Use extract_todo_items to handle both direct and protocol formats
            if let Some(items) = extract_todo_items(res) {
                format!(" ({} items)", items.len())
            } else {
                String::new()
            }
        } else {
            " reading...".to_string()
        }
    } else if item.summary.is_empty() {
        String::new()
    } else {
        // Truncate long summaries
        let s = &item.summary;
        if s.len() > 60 {
            format!(" {}...", &s[..57])
        } else {
            format!(" {}", s)
        }
    };

    lines.push(Line::from(vec![
        Span::styled(job_indent, base_style),
        Span::styled(sel_prefix, base_style.fg(colors.accent)),
        Span::styled(format!("{} ", status_char), base_style.fg(status_color)),
        Span::styled(tool_name.clone(), base_style.fg(colors.fg_primary)),
        Span::styled(summary, base_style.fg(colors.fg_muted)),
    ]));

    // Detail indent includes the job indent
    let detail_indent = format!("{job_indent}    ");

    // When expanded and selected, show detailed JSON (up to 15 lines)
    if selected && expanded {
        if let Some(details) = &item.details {
            let pretty =
                serde_json::to_string_pretty(details).unwrap_or_else(|_| details.to_string());
            for (i, line) in pretty.lines().enumerate() {
                if i >= 15 {
                    lines.push(Line::from(vec![Span::styled(
                        format!("{detail_indent}... (truncated)"),
                        base_style.fg(colors.fg_muted),
                    )]));
                    break;
                }
                lines.push(Line::from(vec![Span::styled(
                    format!("{detail_indent}{line}"),
                    base_style.fg(colors.fg_muted),
                )]));
            }
        }
    } else {
        // Folded result preview (if completed)
        let is_complete = item.status.as_deref() == Some("completed")
            || item.status.as_deref() == Some("success");
        if is_complete {
            // Special handling for todo_read: show pretty-printed todo list
            if tool_name == "todo_read" {
                if let Some(res) = result {
                    if let Some(todo_lines) = format_todo_read_result(res, colors) {
                        for todo_line in todo_lines {
                            lines.push(todo_line);
                        }
                    }
                }
            } else if let Some(preview) = &item.result_preview {
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("{job_indent}  \u{2514}\u{2500} "),
                        base_style.fg(colors.border_subtle),
                    ),
                    Span::styled(truncate_preview(preview, 50), base_style.fg(colors.fg_muted)),
                ]));
            }
        }
    }

    lines
}

/// Truncates a preview string to max_len characters, taking the first line only.
fn truncate_preview(s: &str, max_len: usize) -> String {
    let first_line = s.lines().next().unwrap_or(s);
    if first_line.len() > max_len {
        format!("{}...", &first_line[..max_len - 3])
    } else {
        first_line.to_string()
    }
}

/// Converts a markdown style hint to a ratatui Style.
fn markdown_span_style(
    md_style: &markdown::MarkdownStyle,
    is_code_block: bool,
    colors: &theme::ThemeColors,
) -> Style {
    use markdown::MarkdownStyle;

    // Code blocks always get a surface background
    let base = if is_code_block {
        Style::default().bg(colors.bg_surface)
    } else {
        Style::default()
    };

    match md_style {
        MarkdownStyle::Normal => base.fg(colors.fg_primary),
        MarkdownStyle::Bold => base.fg(colors.fg_primary).add_modifier(Modifier::BOLD),
        MarkdownStyle::InlineCode => Style::default()
            .fg(colors.accent)
            .bg(colors.bg_surface),
        MarkdownStyle::Header(level) => {
            // Headers get bold, with h1 being brighter
            let fg = if *level == 1 {
                colors.fg_primary
            } else {
                colors.fg_secondary
            };
            base.fg(fg).add_modifier(Modifier::BOLD)
        }
        MarkdownStyle::BulletMarker => base.fg(colors.accent),
        MarkdownStyle::BulletContent => base.fg(colors.fg_primary),
        MarkdownStyle::CodeBlock => base.fg(colors.fg_primary),
        MarkdownStyle::CodeBorder => base.fg(colors.border_subtle),
    }
}

fn render_chat(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();
    let mut prev_role: Option<&Role> = None;

    // Build map of turn_id -> tools for matching tool calls to messages.
    // turn_id is the same for all events in a turn, unlike turn_seq which is
    // a sequence counter within the turn (text_delta gets 0, tool_use gets 1, etc.)
    let completed_tools = state.completed_tool_calls();
    let mut tools_by_turn_id: std::collections::HashMap<String, Vec<(usize, &activity::ActivityItem)>> =
        std::collections::HashMap::new();
    for (i, tool) in completed_tools.iter().enumerate() {
        if let Some(id) = &tool.turn_id {
            tools_by_turn_id.entry(id.clone()).or_default().push((i, tool));
        }
    }

    // Track which tools we've rendered (for any without turn_id, render at end)
    let mut rendered_tool_indices: std::collections::HashSet<usize> =
        std::collections::HashSet::new();

    for m in &state.messages {
        // Add spacing only when the role changes (not between consecutive same-role messages)
        if let Some(prev) = prev_role {
            if prev != &m.role {
                lines.push(Line::from(""));
            }
        }
        prev_role = Some(&m.role);

        // For assistant messages, render tool calls FIRST (before message text)
        // This ensures the tool header appears before any tool output in the message
        if m.role == Role::Assistant {
            if let Some(turn_id) = &m.turn_id {
                if let Some(tools) = tools_by_turn_id.get(turn_id) {
                    for (idx, tool) in tools {
                        let is_selected = state.chat_selected_tool_idx == Some(*idx);
                        let is_expanded = is_selected && state.chat_tool_expanded;
                        lines.extend(render_tool_call_line(tool, colors, is_selected, is_expanded));
                        rendered_tool_indices.insert(*idx);
                    }
                }
            }
        }

        // Message content with streaming cursor if applicable
        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        // Markdown rendering is always enabled
        // User messages get a colored left border; assistant messages have no border
        for md_line in markdown::render_markdownish_lines(&text) {
            let mut spans: Vec<Span> = Vec::new();

            // Add user message border prefix
            if m.role == Role::User {
                spans.push(Span::styled("┃ ", Style::default().fg(colors.accent)));
            }

            // Convert markdown spans to styled ratatui spans
            for md_span in &md_line.spans {
                let style = markdown_span_style(&md_span.style, md_line.is_code_block, colors);
                spans.push(Span::styled(md_span.text.clone(), style));
            }

            lines.push(Line::from(spans));
        }
    }

    // Render any remaining completed tools (without turn_id or orphaned) at the end
    let orphaned_tools: Vec<_> = completed_tools
        .iter()
        .enumerate()
        .filter(|(i, _)| !rendered_tool_indices.contains(i))
        .collect();
    if !orphaned_tools.is_empty() {
        lines.push(Line::from(""));
        for (i, item) in orphaned_tools {
            let is_selected = state.chat_selected_tool_idx == Some(i);
            let is_expanded = is_selected && state.chat_tool_expanded;
            lines.extend(render_tool_call_line(item, colors, is_selected, is_expanded));
        }
    }

    // Show in-progress tool calls at the end (not selectable)
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        lines.push(Line::from(""));
        for item in pending_tools {
            lines.extend(render_tool_call_line(item, colors, false, false));
        }
    }

    // Thinking indicator is now shown in the status bar

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
/// Toggled with F2, closed with Esc.
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

/// Renders a full-screen tool details overlay.
/// Opened with D when a tool is selected in Chat, closed with Esc.
fn render_tool_details_overlay(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;
    let mut lines: Vec<Line> = Vec::new();

    // Header
    lines.push(Line::from(Span::styled(
        "Tool Details                                     [Esc to close]",
        Style::default().fg(colors.fg_muted),
    )));
    lines.push(Line::from(""));

    // Get the selected tool
    let tools = state.completed_tool_calls();
    let selected_tool = state
        .chat_selected_tool_idx
        .and_then(|idx| tools.get(idx).copied());

    if let Some(tool) = selected_tool {
        // Tool name and status
        let tool_name = tool.tool_name.clone().unwrap_or_else(|| "unknown".to_string());
        let status = tool.status.clone().unwrap_or_else(|| "unknown".to_string());
        let status_color = match status.as_str() {
            "completed" | "success" => colors.success,
            "error" => colors.error,
            _ => colors.fg_muted,
        };

        lines.push(Line::from(vec![
            Span::styled("Tool: ", Style::default().fg(colors.fg_muted)),
            Span::styled(tool_name, Style::default().fg(colors.fg_primary).add_modifier(Modifier::BOLD)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("Status: ", Style::default().fg(colors.fg_muted)),
            Span::styled(status, Style::default().fg(status_color)),
        ]));
        lines.push(Line::from(""));

        // Input section
        lines.push(Line::from(Span::styled(
            "\u{2500}\u{2500}\u{2500} Input \u{2500}\u{2500}\u{2500}",
            Style::default().fg(colors.fg_secondary),
        )));
        lines.push(Line::from(""));

        // Get input from tool_inputs_by_tool_call_id or from details
        let input_json = tool
            .tool_call_id
            .as_ref()
            .and_then(|id| state.tool_inputs_by_tool_call_id.get(id))
            .or_else(|| {
                tool.details.as_ref().and_then(|d| d.get("input"))
            });

        if let Some(input) = input_json {
            let pretty = serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
            for line in pretty.lines() {
                lines.push(Line::from(Span::styled(
                    line.to_string(),
                    Style::default().fg(colors.fg_primary),
                )));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "(no input available)",
                Style::default().fg(colors.fg_muted),
            )));
        }

        lines.push(Line::from(""));

        // Result section
        lines.push(Line::from(Span::styled(
            "\u{2500}\u{2500}\u{2500} Result \u{2500}\u{2500}\u{2500}",
            Style::default().fg(colors.fg_secondary),
        )));
        lines.push(Line::from(""));

        // Get result from details
        let result_json = tool.details.as_ref().and_then(|d| d.get("result"));

        if let Some(result) = result_json {
            let pretty = serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string());
            for line in pretty.lines() {
                lines.push(Line::from(Span::styled(
                    line.to_string(),
                    Style::default().fg(colors.fg_primary),
                )));
            }
        } else {
            lines.push(Line::from(Span::styled(
                "(no result available)",
                Style::default().fg(colors.fg_muted),
            )));
        }
    } else {
        lines.push(Line::from(Span::styled(
            "(no tool selected)",
            Style::default().fg(colors.fg_muted),
        )));
    }

    Paragraph::new(Text::from(lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false })
        .scroll((state.tool_details_overlay_scroll, 0))
}

fn render_input(f: &mut ratatui::Frame, state: &AppState, area: ratatui::layout::Rect) {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let input_lines = input_lines_with_cursor(state);
    let line_count = input_lines.len() as u16;

    // Determine prompt prefix based on pending images
    let image_count = state.pending_images.len();
    let (first_prefix, prompt_width) = if image_count > 0 {
        // Show count in prompt: "2> " for 2 images
        let prefix = format!("{}> ", image_count);
        let width = prefix.len() as u16;
        (prefix, width)
    } else {
        ("> ".to_string(), 2)
    };

    // Split prompt column and text column
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(prompt_width), Constraint::Min(1)])
        .split(area);

    // Render prompts (first line shows image count if any, then continuations)
    let mut prompt_lines: Vec<Line> = Vec::new();
    for i in 0..line_count {
        let (prefix, style) = if i == 0 {
            // First line: use accent color, styled differently when images attached
            let style = if image_count > 0 {
                Style::default().fg(colors.accent).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(colors.accent)
            };
            (first_prefix.clone(), style)
        } else {
            // Continuation lines: spaces to match width
            (" ".repeat(prompt_width as usize), Style::default().fg(colors.accent))
        };
        prompt_lines.push(Line::from(Span::styled(prefix, style)));
    }
    let prompts = Paragraph::new(Text::from(prompt_lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false });
    f.render_widget(prompts, columns[0]);

    // Render text lines manually (no inline cursor glyph to avoid double cursor)
    let mut content_lines: Vec<Line> = Vec::new();
    for line in input_lines.iter() {
        content_lines.push(Line::from(Span::styled(
            line.clone(),
            Style::default().fg(colors.fg_primary),
        )));
    }
    let content = Paragraph::new(Text::from(content_lines))
        .style(Style::default().bg(colors.bg_base))
        .wrap(Wrap { trim: false });
    f.render_widget(content, columns[1]);

    // Terminal cursor
    if state.focus == crate::app::Focus::Input && area.height > 0 {
        let (row, col) = state.input.cursor();
        let cursor_y = columns[1].y + row as u16;
        let cursor_x = columns[1].x + col as u16;
        // Clamp inside area to avoid crossterm panic on narrow widths
        let cx = cursor_x.min(columns[1].right().saturating_sub(1));
        let cy = cursor_y.min(columns[1].bottom().saturating_sub(1));
        f.set_cursor_position((cx, cy));
    }
}

/// Renders permission request inline in the conversation flow.
/// Returns lines to be appended to the conversation view.
fn focused_block(title: &'static str, focused: bool, theme: Theme) -> Block<'static> {
    let base = Block::default().title(title).borders(Borders::ALL);
    if focused {
        let styles = theme_styles(theme);
        base.border_style(Style::default().fg(styles.focused_border()))
    } else {
        base
    }
}

fn render_help_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let colors = &styles.colors;

    let mut lines: Vec<Line> = vec![
        Line::from(Span::styled(
            "Help",
            Style::default()
                .fg(colors.fg_primary)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from("Ctrl+C   Cancel request / double to quit"),
        Line::from("Ctrl+F   Search"),
        Line::from("Ctrl+V   Paste image from clipboard (macOS)"),
        Line::from("F2       Toggle activity overlay"),
        Line::from("Ctrl+D   Toggle debug overlay"),
        Line::from("Ctrl+`   Switch focus (Input/Chat)"),
        Line::from("Tab      Cycle slash options or open picker"),
        Line::from("Alt+Enter  Newline in input"),
        Line::from("Enter/Ctrl+Enter  Send message"),
        Line::from("Up/Down  Scroll or history (in input)"),
        Line::from("PgUp/Dn  Scroll focused pane"),
        Line::from("j/k      Navigate tool calls in chat"),
        Line::from("D        Show tool details (when tool selected)"),
        Line::from("F1       Toggle help"),
        Line::from(""),
        Line::from(Span::styled(
            "Permissions",
            Style::default()
                .fg(colors.fg_primary)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from("Y        Allow once"),
        Line::from("S        Allow for session"),
        Line::from("N        Deny"),
        Line::from("↑/↓      Select option"),
        Line::from("Enter    Confirm selection"),
        Line::from("Esc      Deny"),
        Line::from(""),
        Line::from(Span::styled(
            "Slash commands",
            Style::default()
                .fg(colors.fg_primary)
                .add_modifier(Modifier::BOLD),
        )),
    ];

    // Group slash commands by first token for compact help
    let mut grouped: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for cmd in all_slash_commands(state) {
        if cmd.source.as_deref() == Some("permission") {
            continue;
        }
        let mut parts = cmd.name.split_whitespace();
        let head = parts.next().unwrap_or("").to_string();
        let tail = parts.collect::<Vec<_>>().join(" ");
        if head.is_empty() {
            continue;
        }
        if tail.is_empty() {
            grouped.entry(head).or_default();
        } else {
            grouped.entry(head).or_default().push(tail);
        }
    }

    for (head, tails) in grouped {
        if tails.is_empty() {
            lines.push(Line::from(vec![
                Span::styled("/", Style::default().fg(colors.fg_muted)),
                Span::styled(head, Style::default().fg(colors.fg_primary)),
            ]));
        } else {
            let opts = tails
                .into_iter()
                .filter(|t| !t.is_empty())
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let opts_str = opts.join(" | ");
            lines.push(Line::from(vec![
                Span::styled("/", Style::default().fg(colors.fg_muted)),
                Span::styled(head.clone(), Style::default().fg(colors.fg_primary)),
                Span::styled(format!(" ({opts_str})"), Style::default().fg(colors.fg_secondary)),
            ]));
        }
    }

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
        execute!(stdout, EnterAlternateScreen, EnableBracketedPaste)?;
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
        execute!(io::stdout(), DisableBracketedPaste, LeaveAlternateScreen)?;
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
    let mut prev_role: Option<&Role> = None;

    // Build map of turn_id -> tools for matching (same as render_chat)
    let completed_tools = state.completed_tool_calls();
    let mut tools_by_turn_id: std::collections::HashMap<String, Vec<(usize, &activity::ActivityItem)>> =
        std::collections::HashMap::new();
    for (i, tool) in completed_tools.iter().enumerate() {
        if let Some(id) = &tool.turn_id {
            tools_by_turn_id.entry(id.clone()).or_default().push((i, tool));
        }
    }

    // Track which tools we've counted (for orphaned tools at end)
    let mut counted_tool_indices: std::collections::HashSet<usize> =
        std::collections::HashSet::new();

    for m in &state.messages {
        // Blank line only on role change (matching render_chat's grouping logic)
        if let Some(prev) = prev_role {
            if prev != &m.role {
                total += 1;
            }
        }
        prev_role = Some(&m.role);

        // For assistant messages, count inline tools FIRST (before message text)
        if m.role == Role::Assistant {
            if let Some(turn_id) = &m.turn_id {
                if let Some(tools) = tools_by_turn_id.get(turn_id) {
                    for (idx, tool) in tools {
                        let is_selected = state.chat_selected_tool_idx == Some(*idx);
                        let is_expanded = is_selected && state.chat_tool_expanded;
                        total += tool_call_line_count(tool, is_selected, is_expanded);
                        counted_tool_indices.insert(*idx);
                    }
                }
            }
        }

        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str(" ▌");
        }

        // Markdown rendering is always enabled
        // User messages have a "┃ " border prefix (2 chars), so effective width is reduced
        let effective_width = match m.role {
            Role::User => content_width.saturating_sub(2),
            Role::Assistant => content_width,
        };
        for l in markdown::render_markdownish_lines(&text) {
            total += wrapped_line_count(effective_width.max(1), &l.text());
        }
    }

    // Count orphaned completed tools (without turn_id or not matched)
    let orphaned_tools: Vec<_> = completed_tools
        .iter()
        .enumerate()
        .filter(|(i, _)| !counted_tool_indices.contains(i))
        .collect();
    if !orphaned_tools.is_empty() {
        total += 1; // blank line before orphaned tools
        for (i, tool) in orphaned_tools {
            let is_selected = state.chat_selected_tool_idx == Some(i);
            let is_expanded = is_selected && state.chat_tool_expanded;
            total += tool_call_line_count(tool, is_selected, is_expanded);
        }
    }

    // Add lines for pending tool calls
    let pending_tools = state.pending_tool_calls();
    if !pending_tools.is_empty() {
        total += 1; // blank line before pending tools
        for tool in pending_tools {
            // Pending tools are never selected/expanded
            total += tool_call_line_count(tool, false, false);
        }
    }

    // Thinking indicator is now in the status bar, not the chat

    total
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
    // Dynamic input height based on content, accounting for wrapped lines
    // Prompt width varies: "> " normally, "N> " when images are attached
    let prompt_width = if state.pending_images.is_empty() {
        2 // "> "
    } else {
        state.pending_images.len().to_string().len() + 2 // "N> "
    };
    let input_content_width = area.width.saturating_sub(prompt_width as u16 + 1) as usize;
    let lines = input_lines_with_cursor(state);
    let (cursor_row, _) = state.input.cursor();
    let input_line_count = count_input_wrapped_lines(&lines, cursor_row, input_content_width);
    let max_input_height = area.height / 3;
    let input_height = (input_line_count as u16).min(max_input_height).max(1);

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),               // main area (chat)
            Constraint::Length(1),            // status (above input)
            Constraint::Length(input_height), // input at BOTTOM
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
        state.help_open = true;
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

    #[test]
    fn user_messages_render_with_border_prefix() {
        let mut state = AppState::new_with_paths(None, None);
        state.prefs.show_activity = false;
        state.prefs.show_debug = false;
        state.messages.push(crate::app::ChatMessage {
            role: Role::User,
            text: "hello".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });
        state.messages.push(crate::app::ChatMessage {
            role: Role::Assistant,
            text: "world".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

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

        // User message should have border prefix
        assert!(
            buffer_str.contains("┃ hello"),
            "User message should have border prefix. Buffer content:\n{}",
            buffer_str
        );
        // Assistant message should not have border prefix
        assert!(
            !buffer_str.contains("┃ world"),
            "Assistant message should not have border prefix. Buffer content:\n{}",
            buffer_str
        );
        // Old labels should not appear
        assert!(
            !buffer_str.contains("you"),
            "Old 'you' label should not appear. Buffer content:\n{}",
            buffer_str
        );
    }

    #[test]
    fn consecutive_same_role_messages_grouped_without_separator() {
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;
        use ratatui::widgets::Widget;

        let mut state = AppState::new_with_paths(None, None);

        // Add two consecutive user messages
        state.messages.push(crate::app::ChatMessage {
            role: Role::User,
            text: "First".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });
        state.messages.push(crate::app::ChatMessage {
            role: Role::User,
            text: "Second".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

        // Add an assistant message (should have blank line before it)
        state.messages.push(crate::app::ChatMessage {
            role: Role::Assistant,
            text: "Response".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

        // Add another assistant message (should NOT have blank line before it)
        state.messages.push(crate::app::ChatMessage {
            role: Role::Assistant,
            text: "More response".to_string(),
            streaming: false,
            turn_id: None,
            turn_seq: None,
        });

        let paragraph = render_chat(&state);

        // Render to a buffer to inspect the output
        let area = Rect::new(0, 0, 80, 20);
        let mut buffer = Buffer::empty(area);
        paragraph.render(area, &mut buffer);

        // Extract the rendered lines
        let mut lines: Vec<String> = Vec::new();
        for y in 0..area.height {
            let line: String = (0..area.width)
                .map(|x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
                .collect::<String>()
                .trim_end()
                .to_string();
            lines.push(line);
        }

        // Remove trailing empty lines from the buffer
        while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            lines.pop();
        }

        // Expected output (only blank line on role change):
        // Line 0: "┃ First"
        // Line 1: "┃ Second"       (no blank line - same role as previous)
        // Line 2: ""               (blank line - role changed from User to Assistant)
        // Line 3: "Response"
        // Line 4: "More response"  (no blank line - same role as previous)
        //
        // Total: 5 lines

        // If the bug exists (blank line between ALL messages), we'd have:
        // Line 0: "┃ First"
        // Line 1: ""               (unwanted blank line)
        // Line 2: "┃ Second"
        // Line 3: ""               (blank line)
        // Line 4: "Response"
        // Line 5: ""               (unwanted blank line)
        // Line 6: "More response"
        //
        // Total: 7 lines

        assert_eq!(
            lines.len(),
            5,
            "Expected 5 lines (only blank lines on role change), got {}.\nActual lines:\n{}",
            lines.len(),
            lines
                .iter()
                .enumerate()
                .map(|(i, l)| format!("{}: {:?}", i, l))
                .collect::<Vec<_>>()
                .join("\n")
        );

        // Also verify the structure:
        // - Line 0 should be user message "First"
        // - Line 1 should be user message "Second" (no blank between consecutive user)
        // - Line 2 should be blank (role change)
        // - Line 3 should be assistant message "Response"
        // - Line 4 should be assistant message "More response" (no blank between consecutive assistant)
        assert!(lines[0].contains("First"), "Line 0 should contain 'First'");
        assert!(
            lines[1].contains("Second"),
            "Line 1 should contain 'Second' (no blank line between consecutive user messages)"
        );
        assert!(
            lines[2].is_empty(),
            "Line 2 should be blank (role change from user to assistant)"
        );
        assert!(
            lines[3].contains("Response"),
            "Line 3 should contain 'Response'"
        );
        assert!(
            lines[4].contains("More response"),
            "Line 4 should contain 'More response' (no blank line between consecutive assistant messages)"
        );
    }

    #[test]
    fn permission_bar_shows_tool_and_shortcuts() {
        use crate::app::{PermissionOption, PermissionRequest};
        use ratatui::layout::Rect;

        let mut state = AppState::new_with_paths(None, None);
        state.active_permission = Some(PermissionRequest {
            id: json!("test"),
            tool: Some("bash".to_string()),
            kind: None,
            resource: Some("npm test".to_string()),
            tool_call_id: None,
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![
                PermissionOption {
                    option_id: "allow".to_string(),
                    label: "Allow once".to_string(),
                },
                PermissionOption {
                    option_id: "session".to_string(),
                    label: "Allow for session".to_string(),
                },
                PermissionOption {
                    option_id: "deny".to_string(),
                    label: "Deny".to_string(),
                },
            ],
        });

        let widget = render_permission_bar(&state);

        // Render to a test backend to verify the content
        let backend = TestBackend::new(80, 5);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|f| {
                f.render_widget(widget, Rect::new(0, 0, 80, 5));
            })
            .unwrap();

        // Extract buffer content to verify expected text is present
        let buffer = terminal.backend().buffer();
        let buffer_str: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        // Verify tool name and shortcuts are rendered
        assert!(
            buffer_str.contains("bash"),
            "Should show tool name 'bash'. Buffer: {}",
            buffer_str
        );
        assert!(
            buffer_str.contains("[Y]"),
            "Should show [Y] shortcut. Buffer: {}",
            buffer_str
        );
        assert!(
            buffer_str.contains("[S]"),
            "Should show [S] shortcut. Buffer: {}",
            buffer_str
        );
        assert!(
            buffer_str.contains("[N]"),
            "Should show [N] shortcut. Buffer: {}",
            buffer_str
        );
        assert!(
            buffer_str.contains("[D]"),
            "Should show [D] shortcut. Buffer: {}",
            buffer_str
        );
    }

    #[test]
    fn permission_bar_expanded_shows_details() {
        use crate::app::{PermissionOption, PermissionRequest};
        use ratatui::layout::Rect;

        let mut state = AppState::new_with_paths(None, None);
        state.active_permission = Some(PermissionRequest {
            id: json!("test"),
            tool: Some("bash".to_string()),
            kind: None,
            resource: Some("npm test --verbose --coverage".to_string()),
            tool_call_id: Some("tool_123".to_string()),
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![
                PermissionOption {
                    option_id: "allow".to_string(),
                    label: "Allow once".to_string(),
                },
                PermissionOption {
                    option_id: "deny".to_string(),
                    label: "Deny".to_string(),
                },
            ],
        });

        // Add tool input for the tool call
        state.tool_inputs_by_tool_call_id.insert(
            "tool_123".to_string(),
            json!({
                "command": "npm test --verbose --coverage",
                "timeout": 30000
            }),
        );

        // Expand the details
        state.permission_details_expanded = true;

        let widget = render_permission_bar(&state);

        // Render to a test backend with enough height for expanded content
        let backend = TestBackend::new(80, 15);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|f| {
                f.render_widget(widget, Rect::new(0, 0, 80, 15));
            })
            .unwrap();

        // Extract buffer content
        let buffer = terminal.backend().buffer();
        let buffer_str: String = (0..buffer.area.height)
            .flat_map(|y| {
                (0..buffer.area.width)
                    .map(move |x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
            })
            .collect();

        // Verify expanded state shows "Hide" instead of "Details"
        assert!(
            buffer_str.contains("Hide"),
            "Should show 'Hide' when expanded. Buffer: {}",
            buffer_str
        );

        // Verify resource line is shown
        assert!(
            buffer_str.contains("Resource:"),
            "Should show 'Resource:' label when expanded. Buffer: {}",
            buffer_str
        );

        // Verify tool input JSON is shown
        assert!(
            buffer_str.contains("Input:"),
            "Should show 'Input:' label when expanded. Buffer: {}",
            buffer_str
        );
        assert!(
            buffer_str.contains("command"),
            "Should show tool input JSON when expanded. Buffer: {}",
            buffer_str
        );
    }

    #[test]
    fn permission_bar_height_calculates_correctly() {
        use crate::app::{PermissionOption, PermissionRequest};

        let mut state = AppState::new_with_paths(None, None);

        // No permission = height 0
        assert_eq!(permission_bar_height(&state), 0);

        // Active permission, not expanded = height 3
        state.active_permission = Some(PermissionRequest {
            id: json!("test"),
            tool: Some("bash".to_string()),
            kind: None,
            resource: Some("npm test".to_string()),
            tool_call_id: Some("tool_123".to_string()),
            turn_id: None,
            turn_seq: None,
            job_id: None,
            options: vec![PermissionOption {
                option_id: "allow".to_string(),
                label: "Allow".to_string(),
            }],
        });
        assert_eq!(permission_bar_height(&state), 3);

        // Expanded without tool input = 3 + 1 (resource line)
        state.permission_details_expanded = true;
        assert_eq!(permission_bar_height(&state), 4);

        // Expanded with tool input = 3 + resource + input lines
        state.tool_inputs_by_tool_call_id.insert(
            "tool_123".to_string(),
            json!({
                "command": "npm test"
            }),
        );
        let height = permission_bar_height(&state);
        // Should be at least 3 + 2 (resource + some input lines)
        assert!(
            height >= 5,
            "Height should be at least 5 with tool input, got {}",
            height
        );
    }

    #[test]
    fn format_todo_write_summary_with_mixed_statuses() {
        // Claude Code format: todos array with content/status/activeForm
        let input = json!({
            "todos": [
                { "content": "Task 1", "status": "completed", "activeForm": "Done" },
                { "content": "Task 2", "status": "in_progress", "activeForm": "Working on task 2" },
                { "content": "Task 3", "status": "pending", "activeForm": "Adding task 3" }
            ]
        });
        let summary = format_todo_write_summary(&input, None);
        assert_eq!(summary, "1 active, 1 pending, 1 done");
    }

    #[test]
    fn format_todo_write_summary_all_pending() {
        let input = json!({
            "todos": [
                { "content": "Task 1", "status": "pending", "activeForm": "Adding task 1" },
                { "content": "Task 2", "status": "pending", "activeForm": "Adding task 2" }
            ]
        });
        let summary = format_todo_write_summary(&input, None);
        assert_eq!(summary, "2 pending");
    }

    #[test]
    fn format_todo_write_summary_all_completed() {
        let input = json!({
            "todos": [
                { "content": "Task 1", "status": "completed", "activeForm": "Done" },
                { "content": "Task 2", "status": "completed", "activeForm": "Done" }
            ]
        });
        let summary = format_todo_write_summary(&input, None);
        assert_eq!(summary, "2 done");
    }

    #[test]
    fn format_todo_write_summary_empty_clears() {
        let input = json!({ "todos": [] });
        let summary = format_todo_write_summary(&input, None);
        assert_eq!(summary, "clear all");
    }

    #[test]
    fn format_todo_write_summary_legacy_fallback() {
        // Legacy format without todos array falls back gracefully
        let input = json!({ "title": "Some task" });
        let summary = format_todo_write_summary(&input, None);
        assert_eq!(summary, "update");
    }

    #[test]
    fn format_todo_read_result_empty_list() {
        let colors = theme::ThemeColors::dark();
        let result = json!({ "items": [] });
        let lines = format_todo_read_result(&result, &colors);
        assert!(lines.is_some());
        let lines = lines.unwrap();
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn format_todo_read_result_with_items() {
        let colors = theme::ThemeColors::dark();
        let result = json!({
            "items": [
                { "id": "t_aaa", "status": "pending", "title": "First task" },
                { "id": "t_bbb", "status": "done", "title": "Second task" }
            ]
        });
        let lines = format_todo_read_result(&result, &colors);
        assert!(lines.is_some());
        let lines = lines.unwrap();
        assert_eq!(lines.len(), 2); // 2 items, no descriptions
    }

    #[test]
    fn format_todo_read_result_with_active_form() {
        // Claude Code format: in_progress items show activeForm line
        let colors = theme::ThemeColors::dark();
        let result = json!({
            "items": [
                {
                    "content": "Task in progress",
                    "status": "in_progress",
                    "activeForm": "Working on this task"
                }
            ]
        });
        let lines = format_todo_read_result(&result, &colors);
        assert!(lines.is_some());
        let lines = lines.unwrap();
        assert_eq!(lines.len(), 2); // 1 item + 1 activeForm line
    }

    #[test]
    fn format_todo_read_result_invalid_returns_none() {
        let colors = theme::ThemeColors::dark();
        let result = json!({ "error": "something went wrong" });
        let lines = format_todo_read_result(&result, &colors);
        assert!(lines.is_none());
    }

    #[test]
    fn format_todo_read_result_with_protocol_format() {
        // Test the actual format from the protocol: content array with JSON string
        let colors = theme::ThemeColors::dark();
        let result = json!({
            "content": [{
                "type": "text",
                "text": "{\"items\":[{\"id\":\"t_abc\",\"status\":\"pending\",\"title\":\"Test task\"}]}"
            }]
        });
        let lines = format_todo_read_result(&result, &colors);
        assert!(lines.is_some());
        let lines = lines.unwrap();
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn extract_todo_items_from_protocol_format() {
        let result = json!({
            "content": [{
                "type": "text",
                "text": "{\"items\":[{\"id\":\"t_xyz\",\"status\":\"done\",\"title\":\"Completed\"}]}"
            }]
        });
        let items = extract_todo_items(&result);
        assert!(items.is_some());
        let items = items.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].get("id").unwrap(), "t_xyz");
    }

    #[test]
    fn tools_render_inline_with_matching_turn_id() {
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;
        use ratatui::widgets::Widget;

        let mut state = AppState::new_with_paths(None, None);

        // Add an assistant message with a turn_id
        state.messages.push(crate::app::ChatMessage {
            role: Role::Assistant,
            text: "I'll read that file.".to_string(),
            streaming: false,
            turn_id: Some("turn_abc123".to_string()),
            turn_seq: Some(0),
        });

        // Add a completed tool call with the SAME turn_id
        activity::upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("file_read".to_string()),
            Some("completed".to_string()),
            json!({"path": "/test/file.txt"}),
            Some(json!({"content": "file contents"})),
            None,
            Some("turn_abc123".to_string()), // Same turn_id as the message
            Some(1),
        );

        let paragraph = render_chat(&state);

        // Render to a buffer to inspect the output
        let area = Rect::new(0, 0, 80, 20);
        let mut buffer = Buffer::empty(area);
        paragraph.render(area, &mut buffer);

        // Extract the rendered lines
        let mut lines: Vec<String> = Vec::new();
        for y in 0..area.height {
            let line: String = (0..area.width)
                .map(|x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
                .collect::<String>()
                .trim_end()
                .to_string();
            lines.push(line);
        }

        // Remove trailing empty lines
        while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            lines.pop();
        }

        // Tool call should appear BEFORE the message text (inline header first)
        // NOT after a blank line (which would indicate orphaned/at-end rendering)
        assert!(
            lines.len() >= 2,
            "Expected at least 2 lines (tool + message), got {}",
            lines.len()
        );

        // Line 0 should be the tool call header (before message text)
        assert!(
            lines[0].contains("file_read"),
            "Line 0 should be the tool call header, got: {:?}",
            lines[0]
        );

        // Line 1 should contain the message text (after tool header)
        assert!(
            lines[1].contains("read that file"),
            "Line 1 should be the message text, got: {:?}.\nAll lines:\n{}",
            lines[1],
            lines.iter().enumerate().map(|(i, l)| format!("{}: {:?}", i, l)).collect::<Vec<_>>().join("\n")
        );
    }

    #[test]
    fn tools_render_at_end_without_matching_turn_id() {
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;
        use ratatui::widgets::Widget;

        let mut state = AppState::new_with_paths(None, None);

        // Add an assistant message with a turn_id
        state.messages.push(crate::app::ChatMessage {
            role: Role::Assistant,
            text: "I'll read that file.".to_string(),
            streaming: false,
            turn_id: Some("turn_abc123".to_string()),
            turn_seq: Some(0),
        });

        // Add a completed tool call with a DIFFERENT turn_id (orphaned)
        activity::upsert_tool_use(
            &mut state,
            "tool_1".to_string(),
            Some("file_read".to_string()),
            Some("completed".to_string()),
            json!({"path": "/test/file.txt"}),
            Some(json!({"content": "file contents"})),
            None,
            Some("turn_different".to_string()), // Different turn_id
            Some(1),
        );

        let paragraph = render_chat(&state);

        // Render to a buffer to inspect the output
        let area = Rect::new(0, 0, 80, 20);
        let mut buffer = Buffer::empty(area);
        paragraph.render(area, &mut buffer);

        // Extract the rendered lines
        let mut lines: Vec<String> = Vec::new();
        for y in 0..area.height {
            let line: String = (0..area.width)
                .map(|x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
                .collect::<String>()
                .trim_end()
                .to_string();
            lines.push(line);
        }

        // Remove trailing empty lines
        while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            lines.pop();
        }

        // With mismatched turn_ids, the tool should be orphaned and rendered at the end
        // There should be a blank line between the message and the orphaned tools
        assert!(
            lines.len() >= 3,
            "Expected at least 3 lines (message, blank, tool), got {}",
            lines.len()
        );

        // Line 0 should contain the message text
        assert!(
            lines[0].contains("read that file"),
            "Line 0 should be the message, got: {:?}",
            lines[0]
        );

        // Line 1 should be blank (separator before orphaned tools)
        assert!(
            lines[1].is_empty(),
            "Line 1 should be blank (orphaned tool separator), got: {:?}",
            lines[1]
        );

        // Line 2 should be the orphaned tool call
        assert!(
            lines[2].contains("file_read"),
            "Line 2 should be the orphaned tool call, got: {:?}",
            lines[2]
        );
    }

    #[test]
    fn full_event_flow_preserves_turn_ids() {
        use ratatui::buffer::Buffer;
        use ratatui::layout::Rect;
        use ratatui::widgets::Widget;
        use serde_json::json;

        let mut state = AppState::new_with_paths(None, None);

        // Simulate the full flow of events as they would arrive from the agent:
        // 1. turn_start with turnId
        // 2. text_delta with turnId
        // 3. tool_use (pending) with turnId
        // 4. tool_use (completed) with turnId

        // Parse and apply events as they would be in handle_session_update
        let events = vec![
            json!({"type": "turn_start", "turnId": "turn_test_123", "turnSeq": 0}),
            json!({"type": "text_delta", "text": "I'll read the config file.", "turnId": "turn_test_123", "turnSeq": 1}),
            json!({"type": "tool_use", "toolCallId": "tool_read_1", "name": "file_read", "status": "running", "input": {"path": "/etc/config"}, "turnId": "turn_test_123", "turnSeq": 2}),
            json!({"type": "tool_use", "toolCallId": "tool_read_1", "name": "file_read", "status": "completed", "input": {"path": "/etc/config"}, "result": {"content": "config data"}, "turnId": "turn_test_123", "turnSeq": 3}),
        ];

        for event_json in events {
            for ev in crate::protocol::ent::decode_session_update(&event_json) {
                match &ev {
                    crate::app::reducer::AppEvent::ToolUse {
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
                            &mut state,
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
                    _ => {}
                }
                crate::app::reducer::reduce(&mut state, ev);
            }
        }

        // Verify state is correct
        assert_eq!(state.messages.len(), 1, "Should have 1 assistant message");
        assert_eq!(
            state.messages[0].turn_id,
            Some("turn_test_123".to_string()),
            "Message should have turn_id"
        );

        let completed = state.completed_tool_calls();
        assert_eq!(completed.len(), 1, "Should have 1 completed tool");
        assert_eq!(
            completed[0].turn_id,
            Some("turn_test_123".to_string()),
            "Tool should have matching turn_id"
        );

        // Now render and verify the tool is inline with the message
        let paragraph = render_chat(&state);

        let area = Rect::new(0, 0, 80, 20);
        let mut buffer = Buffer::empty(area);
        paragraph.render(area, &mut buffer);

        let mut lines: Vec<String> = Vec::new();
        for y in 0..area.height {
            let line: String = (0..area.width)
                .map(|x| buffer.cell((x, y)).map(|c| c.symbol()).unwrap_or(" "))
                .collect::<String>()
                .trim_end()
                .to_string();
            lines.push(line);
        }

        while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            lines.pop();
        }

        // Tool call should appear BEFORE message text (inline header first)
        assert!(
            lines.len() >= 2,
            "Expected at least 2 lines (tool + message), got {}: {:?}",
            lines.len(),
            lines
        );

        // Line 0 should be the tool call header (before message text)
        assert!(
            lines[0].contains("file_read"),
            "Line 0 should be the tool call header, got: {:?}",
            lines[0]
        );

        // Line 1 should contain message text (after tool header)
        assert!(
            lines[1].contains("config file"),
            "Line 1 should be the message text, got: {:?}\nAll lines:\n{}",
            lines[1],
            lines
                .iter()
                .enumerate()
                .map(|(i, l)| format!("{}: {:?}", i, l))
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}
