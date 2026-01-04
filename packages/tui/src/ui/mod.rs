mod markdown;

use crate::app::activity;
use crate::app::config_wizard;
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
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Terminal;
use serde_json::Value;
use std::io;
use std::path::PathBuf;
use std::time::Duration;

pub fn run_tui(args: Args) -> io::Result<()> {
    let workdir = resolve_workdir(args.workdir.as_deref())?;
    let agent_cmd = args
        .agent_cmd
        .unwrap_or_else(|| default_agent_cmd().unwrap_or_else(|| "lace-agent".to_string()));

    let transport = AgentTransport::spawn_shell(&agent_cmd, &workdir)?;
    let session_id = bootstrap_session(&transport, &workdir, args.load_session_id.as_deref())?;

    let mut state = AppState::new();
    state.session_id = Some(session_id);
    state.workdir = workdir.to_string_lossy().to_string();
    state.next_client_seq = 3;
    state.push_activity_line(format!("timeout-ms={}", args.timeout_ms));

    // Best-effort: populate conn/model in the status bar when supported by the agent.
    let status_req = vec![Outbound::JsonRpcRequest {
        id: state.next_client_id(),
        method: "ent/agent/status".to_string(),
        params: Some(serde_json::json!({})),
    }];
    send_outbound(&transport, &mut state, status_req, args.timeout_ms)?;

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
                        break;
                    }

                    if state.active_permission.is_some() {
                        let action = match key.code {
                            KeyCode::Up => Some(UiAction::PermissionPrev),
                            KeyCode::Down => Some(UiAction::PermissionNext),
                            KeyCode::Enter => Some(UiAction::PermissionSubmit),
                            KeyCode::Esc => Some(UiAction::PermissionCancel),
                            _ => None,
                        };
                        if let Some(action) = action {
                            let out = apply_ui_action(state, action);
                            send_outbound(transport, state, out, timeout_ms)?;
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

                    if state.help_open {
                        match key.code {
                            KeyCode::Esc | KeyCode::F(1) | KeyCode::Char('?') => {
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
                            KeyCode::Char('1') => {
                                let _ = apply_ui_action(state, UiAction::ToggleChat);
                                continue;
                            }
                            KeyCode::Char('2') => {
                                let _ = apply_ui_action(state, UiAction::ToggleActivity);
                                continue;
                            }
                            KeyCode::Char('3') => {
                                let _ = apply_ui_action(state, UiAction::ToggleDebug);
                                continue;
                            }
                            _ => {}
                        }
                    }

                    if key.code == KeyCode::F(1) || key.code == KeyCode::Char('?') {
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
                let line = jsonrpc::encode_request(Value::String(id.clone()), &method, params);
                transport
                    .send_line(line)
                    .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
                activity::push_rpc_sent(state, method.clone());
                state.mark_request_sent(id, method, now_ms(), timeout_ms);
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
            if let Some(id_str) = id.as_str() {
                should_refocus = state.active_prompt_request_ids.contains(id_str);
                pending_method = state.take_pending_request(id_str).map(|p| p.method);
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

            reduce(state, AppEvent::RpcResponse { id: id.clone() });

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
                if state.config_wizard.open && method.starts_with("ent/") {
                    let out = config_wizard::handle_response(state, method, &result, error_message);
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
    let input_height = if state.prefs.input_multiline { 7 } else { 3 };

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(input_height),
        ])
        .split(f.area());

    let status = render_status(state);
    f.render_widget(status, root[0]);

    let main_area = root[1];
    let input_area = root[2];

    let body = if state.prefs.show_debug {
        let split = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(1), Constraint::Percentage(30)])
            .split(main_area);
        render_main(f, state, split[0]);
        f.render_widget(render_debug(state), split[1]);
        split[0]
    } else {
        render_main(f, state, main_area);
        main_area
    };

    let _ = body;
    f.render_widget(render_input(state), input_area);

    if state.active_permission.is_some() {
        let area = centered_rect(80, 70, f.area());
        f.render_widget(Clear, area);
        f.render_widget(render_permission_modal(state), area);
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
    status_fg: Color,
    status_bg: Color,
    focused_border: Color,
    user_prefix: Color,
    assistant_prefix: Color,
    activity_selected: Color,
    activity_error: Color,
    dim: Color,
    code_fg: Color,
    code_bg: Color,
}

fn theme_styles(theme: Theme) -> ThemeStyles {
    match theme {
        Theme::Dark => ThemeStyles {
            status_fg: Color::White,
            status_bg: Color::DarkGray,
            focused_border: Color::Yellow,
            user_prefix: Color::Green,
            assistant_prefix: Color::Cyan,
            activity_selected: Color::Yellow,
            activity_error: Color::Red,
            dim: Color::DarkGray,
            code_fg: Color::White,
            code_bg: Color::Black,
        },
        Theme::Light => ThemeStyles {
            status_fg: Color::Black,
            status_bg: Color::White,
            focused_border: Color::Blue,
            user_prefix: Color::Blue,
            assistant_prefix: Color::Magenta,
            activity_selected: Color::Blue,
            activity_error: Color::Red,
            dim: Color::Gray,
            code_fg: Color::Black,
            code_bg: Color::Gray,
        },
        Theme::HighContrast => ThemeStyles {
            status_fg: Color::Yellow,
            status_bg: Color::Black,
            focused_border: Color::Yellow,
            user_prefix: Color::Yellow,
            assistant_prefix: Color::White,
            activity_selected: Color::Yellow,
            activity_error: Color::Red,
            dim: Color::Gray,
            code_fg: Color::White,
            code_bg: Color::Black,
        },
    }
}

fn render_status(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let sid = state
        .session_id
        .clone()
        .unwrap_or_else(|| "<none>".to_string());
    let conn = state
        .connection_id
        .clone()
        .unwrap_or_else(|| "<unset>".to_string());
    let model = state
        .model_id
        .clone()
        .unwrap_or_else(|| "<unset>".to_string());
    let last = state
        .last_activity_ms
        .map(|ms| ms.to_string())
        .unwrap_or_else(|| "<none>".to_string());
    let text = Line::from(vec![
        Span::styled(
            " lace-tui ",
            Style::default().fg(styles.status_fg).bg(styles.status_bg),
        ),
        Span::raw(" "),
        Span::raw(format!("sess={sid} ")),
        Span::raw(format!("conn={conn} model={model} ")),
        Span::raw(format!("last={last} ")),
        Span::raw(format!("workdir={} ", state.workdir)),
        Span::raw(" Ctrl+C quit  Ctrl+1/2/3 panes "),
    ]);
    Paragraph::new(text).style(Style::default())
}

fn render_sessions_modal(state: &AppState) -> Paragraph<'static> {
    let s = &state.sessions;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from("Sessions"));
    lines.push(Line::from(""));

    if s.loading {
        lines.push(Line::from("Loading sessions..."));
    } else if let Some(err) = &s.error {
        lines.push(Line::from(format!("Error: {err}")));
    } else {
        lines.push(Line::from(format!("Filter: {}", s.query)));
        lines.push(Line::from(""));

        let max = 18usize;
        let start = s.selected.saturating_sub(max / 2);
        let end = (start + max).min(s.filtered.len());
        for sel_idx in start..end {
            let idx = s.filtered[sel_idx];
            let selected = sel_idx == s.selected;
            let marker = if selected { ">" } else { " " };
            let it = &s.items[idx];
            let alias = state
                .session_aliases
                .get(&it.session_id)
                .cloned()
                .unwrap_or_default();
            let title = if alias.is_empty() {
                it.session_id.clone()
            } else {
                format!("{alias} ({})", it.session_id)
            };
            let work = it.work_dir.clone().unwrap_or_else(|| "?".to_string());
            let last_active = it.last_active.clone().unwrap_or_else(|| "?".to_string());
            lines.push(Line::from(format!("{marker} {title}")));
            lines.push(Line::from(Span::styled(
                format!("    {work}  lastActive={last_active}"),
                Style::default().fg(Color::DarkGray),
            )));
        }

        if s.renaming {
            lines.push(Line::from(""));
            lines.push(Line::from(format!("Rename: {}", s.rename_input)));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(
        "Up/Down select • Enter load • r rename • Esc close",
    ));

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Sessions").borders(Borders::ALL))
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
            let marker = if idx == s.selected { ">" } else { " " };
            lines.push(Line::from(format!("{marker} {}", s.results[idx].label)));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from("Up/Down select • Enter jump • Esc close"));

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Search").borders(Borders::ALL))
        .wrap(Wrap { trim: true })
}

fn render_config_modal(state: &AppState) -> Paragraph<'static> {
    let w = &state.config_wizard;
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from("Configure"));
    lines.push(Line::from(""));

    match w.step {
        config_wizard::ConfigWizardStep::LoadingConnections => {
            lines.push(Line::from("Loading connections..."));
        }
        config_wizard::ConfigWizardStep::SelectConnection => {
            lines.push(Line::from("Select connection:"));
            for (i, c) in w.connections.iter().enumerate() {
                let marker = if i == w.selected { ">" } else { " " };
                let name = c.name.clone().unwrap_or_else(|| c.connection_id.clone());
                let cred = c
                    .credential_state
                    .clone()
                    .map(|s| format!(" [{s}]"))
                    .unwrap_or_default();
                lines.push(Line::from(format!("{marker} {}{}", name, cred)));
            }
        }
        config_wizard::ConfigWizardStep::LoadingProviders => {
            lines.push(Line::from("No connections found; loading providers..."));
        }
        config_wizard::ConfigWizardStep::SelectProvider => {
            lines.push(Line::from("Select provider:"));
            for (i, p) in w.providers.iter().enumerate() {
                let marker = if i == w.selected { ">" } else { " " };
                let name = p
                    .display_name
                    .clone()
                    .unwrap_or_else(|| p.provider_id.clone());
                lines.push(Line::from(format!("{marker} {name} ({})", p.provider_id)));
            }
        }
        config_wizard::ConfigWizardStep::UpsertingConnection => {
            lines.push(Line::from("Creating connection..."));
        }
        config_wizard::ConfigWizardStep::CheckingCredentials => {
            lines.push(Line::from("Checking credentials..."));
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
                lines.push(Line::from(format!("Enter {label}:")));
                lines.push(Line::from(format!("> {display}")));
            } else {
                lines.push(Line::from("Enter credential:"));
            }
        }
        config_wizard::ConfigWizardStep::SubmittingCredentials => {
            lines.push(Line::from("Submitting credentials..."));
        }
        config_wizard::ConfigWizardStep::LoadingModels => {
            lines.push(Line::from("Loading models..."));
        }
        config_wizard::ConfigWizardStep::SelectModel => {
            lines.push(Line::from("Select model:"));
            for (i, m) in w.models.iter().enumerate() {
                let marker = if i == w.selected { ">" } else { " " };
                lines.push(Line::from(format!("{marker} {m}")));
            }
        }
        config_wizard::ConfigWizardStep::Applying => {
            lines.push(Line::from("Applying session configuration..."));
        }
        config_wizard::ConfigWizardStep::Done => {
            lines.push(Line::from(format!(
                "Configured: connectionId={} modelId={}",
                w.connection_id.clone().unwrap_or_else(|| "?".to_string()),
                w.model_id.clone().unwrap_or_else(|| "?".to_string())
            )));
            lines.push(Line::from(""));
            lines.push(Line::from("Press Enter or Esc to close"));
        }
        config_wizard::ConfigWizardStep::NotSupported => {
            lines.push(Line::from(w.error_message.clone().unwrap_or_else(|| {
                "configuration not supported by this agent".to_string()
            })));
            lines.push(Line::from(""));
            lines.push(Line::from("Press Enter or Esc to close"));
        }
        config_wizard::ConfigWizardStep::Error => {
            lines.push(Line::from("Error:"));
            lines.push(Line::from(
                w.error_message
                    .clone()
                    .unwrap_or_else(|| "<unknown>".to_string()),
            ));
            lines.push(Line::from(""));
            lines.push(Line::from("Press Enter or Esc to close"));
        }
        config_wizard::ConfigWizardStep::Closed => {}
    }

    lines.push(Line::from(""));
    lines.push(Line::from("Up/Down select • Enter confirm • Esc close"));

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Configure").borders(Borders::ALL))
        .wrap(Wrap { trim: true })
}

fn render_main(f: &mut ratatui::Frame, state: &AppState, area: ratatui::layout::Rect) {
    match (state.prefs.show_chat, state.prefs.show_activity) {
        (true, true) => {
            let cols = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(62), Constraint::Percentage(38)])
                .split(area);
            f.render_widget(render_chat(state), cols[0]);
            f.render_widget(render_activity(state), cols[1]);
        }
        (true, false) => {
            f.render_widget(render_chat(state), area);
        }
        (false, true) => {
            f.render_widget(render_activity(state), area);
        }
        (false, false) => {
            f.render_widget(
                Paragraph::new("No panes enabled (Ctrl+1/2)")
                    .block(Block::default().borders(Borders::ALL)),
                area,
            );
        }
    }
}

fn render_chat(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let mut lines: Vec<Line> = Vec::new();
    for m in &state.messages {
        let prefix = match m.role {
            Role::User => "user: ",
            Role::Assistant => "assistant: ",
        };
        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str("▌");
        }
        let prefix_color = match m.role {
            Role::User => styles.user_prefix,
            Role::Assistant => styles.assistant_prefix,
        };
        lines.push(Line::from(vec![Span::styled(
            prefix,
            Style::default().fg(prefix_color),
        )]));
        if state.prefs.render_markdown {
            for l in markdown::render_markdownish_lines(&text) {
                if l.is_code {
                    lines.push(Line::from(Span::styled(
                        l.text,
                        Style::default().fg(styles.code_fg).bg(styles.code_bg),
                    )));
                } else {
                    lines.push(Line::from(l.text));
                }
            }
        } else {
            for l in text.lines() {
                lines.push(Line::from(l.to_string()));
            }
        }
        lines.push(Line::from(""));
    }

    Paragraph::new(Text::from(lines))
        .block(focused_block(
            "Chat",
            state.focus == Focus::Chat,
            state.prefs.theme,
        ))
        .wrap(Wrap { trim: false })
        .scroll((state.chat_scroll, 0))
}

fn render_activity(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let mut lines: Vec<Line> = Vec::new();
    let total = state.activity.len();
    let start = total.saturating_sub(200);
    for (idx, item) in state.activity.iter().enumerate().skip(start) {
        let selected = idx == state.activity_selected && state.focus == Focus::Activity;
        let sel_marker = if selected { ">" } else { " " };
        let exp_marker = if item.expanded { "v" } else { " " };

        let mut style = Style::default();
        if selected {
            style = style.fg(styles.activity_selected);
        } else if matches!(
            item.kind,
            activity::ActivityKind::RpcError | activity::ActivityKind::Timeout
        ) {
            style = style.fg(styles.activity_error);
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
                        Style::default().fg(styles.dim),
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

fn render_input(state: &AppState) -> Paragraph<'static> {
    if state.prefs.input_multiline {
        let mut lines: Vec<Line> = Vec::new();
        let mut first = true;
        for l in state.input_buffer.lines() {
            if first {
                lines.push(Line::from(format!("> {l}")));
                first = false;
            } else {
                lines.push(Line::from(format!("  {l}")));
            }
        }
        if state.input_buffer.is_empty() {
            lines.push(Line::from("> "));
        } else if state.input_buffer.ends_with('\n') {
            lines.push(Line::from("  "));
        }

        Paragraph::new(Text::from(lines))
            .block(focused_block(
                "Input (multiline)",
                state.focus == Focus::Input,
                state.prefs.theme,
            ))
            .wrap(Wrap { trim: false })
            .scroll((state.input_scroll, 0))
    } else {
        Paragraph::new(format!("> {}", state.input_buffer)).block(focused_block(
            "Input",
            state.focus == Focus::Input,
            state.prefs.theme,
        ))
    }
}

fn render_permission_modal(state: &AppState) -> Paragraph<'static> {
    let styles = theme_styles(state.prefs.theme);
    let req = state.active_permission.as_ref().expect("active_permission");
    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from("Permission required"));
    lines.push(Line::from(format!(
        "tool={} kind={} resource={}",
        req.tool.clone().unwrap_or_else(|| "?".to_string()),
        req.kind.clone().unwrap_or_else(|| "?".to_string()),
        req.resource.clone().unwrap_or_else(|| "?".to_string())
    )));
    if let Some(turn_id) = &req.turn_id {
        lines.push(Line::from(format!("turnId={turn_id}")));
    }
    if let Some(turn_seq) = req.turn_seq {
        lines.push(Line::from(format!("turnSeq={turn_seq}")));
    }
    if let Some(job_id) = &req.job_id {
        lines.push(Line::from(format!("jobId={job_id}")));
    }
    if let Some(tool_call_id) = &req.tool_call_id {
        lines.push(Line::from(format!("toolCallId={tool_call_id}")));
        match state.tool_inputs_by_tool_call_id.get(tool_call_id) {
            Some(input) => {
                lines.push(Line::from("input:"));
                let pretty =
                    serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
                for l in pretty.lines() {
                    lines.push(Line::from(Span::styled(
                        format!("  {l}"),
                        Style::default().fg(styles.dim),
                    )));
                }
            }
            None => lines.push(Line::from("input=<unavailable>")),
        }
    }
    lines.push(Line::from(""));
    lines.push(Line::from("Options:"));

    for (i, o) in req.options.iter().enumerate() {
        let marker = if i == state.active_permission_selected {
            ">"
        } else {
            " "
        };
        lines.push(Line::from(format!(
            "{marker} {} - {}",
            o.option_id, o.label
        )));
    }

    lines.push(Line::from(""));
    lines.push(Line::from("Use Up/Down, Enter; Esc denies if available"));

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Permission").borders(Borders::ALL))
        .wrap(Wrap { trim: true })
}

fn focused_block(title: &'static str, focused: bool, theme: Theme) -> Block<'static> {
    let base = Block::default().title(title).borders(Borders::ALL);
    if focused {
        let styles = theme_styles(theme);
        base.border_style(Style::default().fg(styles.focused_border))
    } else {
        base
    }
}

fn render_palette_modal(state: &AppState) -> Paragraph<'static> {
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from("Command Palette"));
    lines.push(Line::from(format!("> {}", state.palette_query)));
    lines.push(Line::from(""));

    let items = palette_labels(&state.palette_query);
    if items.is_empty() {
        lines.push(Line::from("(no matches)"));
    } else {
        let idx = state.palette_selected.min(items.len() - 1);
        for (i, label) in items.iter().enumerate() {
            let marker = if i == idx { ">" } else { " " };
            lines.push(Line::from(format!("{marker} {label}")));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from("Esc to close"));

    Paragraph::new(Text::from(lines))
        .block(Block::default().title("Palette").borders(Borders::ALL))
        .wrap(Wrap { trim: true })
}

fn render_help_modal() -> Paragraph<'static> {
    let lines = vec![
        Line::from("Help"),
        Line::from(""),
        Line::from("Ctrl+C   Quit"),
        Line::from("Ctrl+K   Command palette"),
        Line::from("Ctrl+F   Search"),
        Line::from("Ctrl+E   Toggle multiline input"),
        Line::from("Ctrl+1   Toggle Chat pane"),
        Line::from("Ctrl+2   Toggle Activity pane"),
        Line::from("Ctrl+3   Toggle Debug pane"),
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
        Line::from("? / F1   Toggle help"),
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

fn default_agent_cmd() -> Option<String> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../agent/dist/main.js")
        .canonicalize()
        .ok()?;
    Some(format!(
        "node {}",
        sh_quote(candidate.to_string_lossy().as_ref())
    ))
}

fn sh_quote(s: &str) -> String {
    let mut out = String::from("'");
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
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
    for m in &state.messages {
        let prefix = match m.role {
            Role::User => "user: ",
            Role::Assistant => "assistant: ",
        };
        total += wrapped_line_count(content_width, prefix);

        let mut text = m.text.clone();
        if m.role == Role::Assistant && m.streaming {
            text.push_str("▌");
        }

        if state.prefs.render_markdown {
            for l in markdown::render_markdownish_lines(&text) {
                total += wrapped_line_count(content_width, &l.text);
            }
        } else {
            for l in text.lines() {
                total += wrapped_line_count(content_width, l);
            }
        }

        total += 1; // blank line after message
    }
    total
}

fn wrapped_line_count(width: usize, line: &str) -> usize {
    let len = line.chars().count();
    ((len.max(1) + width - 1) / width).max(1)
}

fn compute_chat_rect(
    state: &AppState,
    area: ratatui::layout::Rect,
) -> Option<ratatui::layout::Rect> {
    if !state.prefs.show_chat {
        return None;
    }

    let input_height = if state.prefs.input_multiline { 7 } else { 3 };
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(input_height),
        ])
        .split(area);
    let main_area = root[1];

    let main_area = if state.prefs.show_debug {
        let split = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(1), Constraint::Percentage(30)])
            .split(main_area);
        split[0]
    } else {
        main_area
    };

    match (state.prefs.show_chat, state.prefs.show_activity) {
        (true, true) => {
            let cols = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(62), Constraint::Percentage(38)])
                .split(main_area);
            Some(cols[0])
        }
        (true, false) => Some(main_area),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

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
}
