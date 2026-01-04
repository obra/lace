use crate::app::reducer::{reduce, AppEvent, Outbound};
use crate::app::ui::{apply_ui_action, palette_labels, UiAction};
use crate::app::AppState;
use crate::app::{Focus, Role};
use crate::args::Args;
use crate::protocol::bootstrap::bootstrap_session;
use crate::protocol::{ent, jsonrpc};
use crate::protocol::transport::AgentTransport;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::{execute, terminal};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
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
  let session_id = bootstrap_session(
    &transport,
    &workdir,
    args.load_session_id.as_deref(),
  )?;

  let mut state = AppState::new();
  state.session_id = Some(session_id);
  state.workdir = workdir.to_string_lossy().to_string();
  state.next_client_seq = 3;

  let mut terminal = TerminalGuard::init()?;
  let res = run_loop(&mut terminal.terminal, &transport, &mut state);
  terminal.restore()?;
  res
}

fn run_loop(
  terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
  transport: &AgentTransport,
  state: &mut AppState,
) -> io::Result<()> {
  loop {
    while let Ok(line) = transport.try_recv_line() {
      handle_agent_line(transport, state, &line);
    }
    state.activate_next_permission_if_needed();

    terminal.draw(|f| draw(f, state))?;

    if event::poll(Duration::from_millis(50))? {
      match event::read()? {
        Event::Key(key) if key.kind == KeyEventKind::Press => {
          if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            break;
          }

          if state.active_permission.is_some() {
            let action = match key.code {
              KeyCode::Up => Some(UiAction::PermissionPrev),
              KeyCode::Down => Some(UiAction::PermissionNext),
              KeyCode::Enter => Some(UiAction::PermissionSubmit),
              _ => None,
            };
            if let Some(action) = action {
              let out = apply_ui_action(state, action);
              send_outbound(transport, state, out)?;
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
              send_outbound(transport, state, out)?;
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

          let action = match key.code {
            KeyCode::Tab => Some(UiAction::FocusNext),
            KeyCode::Up => match state.focus {
              Focus::Input => Some(UiAction::HistoryPrev),
              _ => Some(UiAction::ScrollUp),
            },
            KeyCode::Down => match state.focus {
              Focus::Input => Some(UiAction::HistoryNext),
              _ => Some(UiAction::ScrollDown),
            },
            KeyCode::Enter => match state.focus {
              Focus::Input => Some(UiAction::Enter),
              _ => None,
            },
            KeyCode::Backspace => match state.focus {
              Focus::Input => Some(UiAction::Backspace),
              _ => None,
            },
            KeyCode::Char(ch)
              if state.focus == Focus::Input && !key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
              Some(UiAction::InputChar(ch))
            }
            _ => None,
          };

          if let Some(action) = action {
            let out = apply_ui_action(state, action);
            send_outbound(transport, state, out)?;
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
) -> io::Result<()> {
  for m in out {
    match m {
      Outbound::JsonRpcRequest { id, method, params } => {
        let line = jsonrpc::encode_request(Value::String(id), &method, params);
        transport
          .send_line(line)
          .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
        state.push_activity_line(format!("{method}: sent"));
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

fn handle_agent_line(transport: &AgentTransport, state: &mut AppState, line: &str) {
  let inbound = match jsonrpc::parse_inbound(line) {
    Ok(m) => m,
    Err(err) => {
      state.push_debug_line(format!("bad jsonrpc: {err}"));
      return;
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
        return;
      }

      if method == "session/request_permission" {
        let params = params.unwrap_or(Value::Null);
        let req = ent::decode_permission_request(id, &params);
        reduce(state, AppEvent::PermissionRequested(req));
        state.push_activity_line("permission: requested".to_string());
        return;
      }

      let _ = transport.send_line(jsonrpc::encode_response_result(id, Value::Null));
    }
    jsonrpc::InboundMessage::Response { id, result, error } => {
      if let Some(err) = error {
        state.push_activity_line(format!("error: {}", err.message));
      }
      let should_refocus = id
        .as_str()
        .map(|s| state.active_prompt_request_ids.contains(s))
        .unwrap_or(false);
      reduce(state, AppEvent::RpcResponse { id });
      if let Some(session_id) = extract_session_id(&result) {
        state.session_id = Some(session_id.clone());
        state.push_activity_line(format!("new session {session_id}"));
      }
      if should_refocus && state.active_permission.is_none() {
        state.focus = Focus::Input;
      }
    }
  }
}

fn extract_session_id(result: &Option<Value>) -> Option<String> {
  let Some(result) = result else { return None };
  let obj = result.as_object()?;
  obj.get("sessionId")?.as_str().map(|s| s.to_string())
}

fn handle_session_update(state: &mut AppState, params: &Value) {
  let mut saw_turn_end = false;
  for ev in ent::decode_session_update(params) {
    match &ev {
      AppEvent::ToolUse { tool_call_id, .. } => state.push_activity_line(format!("tool_use {tool_call_id}")),
      AppEvent::TurnEnd { stop_reason } => state.push_activity_line(format!(
        "turn_end {}",
        stop_reason.clone().unwrap_or_else(|| "?".to_string())
      )),
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
  let root = Layout::default()
    .direction(Direction::Vertical)
    .constraints([Constraint::Length(1), Constraint::Min(1), Constraint::Length(3)])
    .split(f.area());

  let status = render_status(state);
  f.render_widget(status, root[0]);

  let main_area = root[1];
  let input_area = root[2];

  let body = if state.show_debug {
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
    f.render_widget(render_permission_modal(state), area);
  } else if state.palette_open {
    let area = centered_rect(70, 60, f.area());
    f.render_widget(render_palette_modal(state), area);
  } else if state.help_open {
    let area = centered_rect(70, 70, f.area());
    f.render_widget(render_help_modal(), area);
  }
}

fn render_status(state: &AppState) -> Paragraph<'static> {
  let sid = state.session_id.clone().unwrap_or_else(|| "<none>".to_string());
  let text = Line::from(vec![
    Span::styled(" lace-tui ", Style::default().fg(Color::Black).bg(Color::White)),
    Span::raw(" "),
    Span::raw(format!("sess={sid} ")),
    Span::raw(format!("workdir={} ", state.workdir)),
    Span::raw(" Ctrl+C quit  Ctrl+1/2/3 panes "),
  ]);
  Paragraph::new(text).style(Style::default())
}

fn render_main(f: &mut ratatui::Frame, state: &AppState, area: ratatui::layout::Rect) {
  match (state.show_chat, state.show_activity) {
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
        Paragraph::new("No panes enabled (Ctrl+1/2)").block(Block::default().borders(Borders::ALL)),
        area,
      );
    }
  }
}

fn render_chat(state: &AppState) -> Paragraph<'static> {
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
    lines.push(Line::from(vec![Span::styled(
      prefix,
      Style::default().fg(Color::Cyan),
    )]));
    for l in text.lines() {
      lines.push(Line::from(l.to_string()));
    }
    lines.push(Line::from(""));
  }

  Paragraph::new(Text::from(lines))
    .block(focused_block("Chat", state.focus == Focus::Chat))
    .wrap(Wrap { trim: false })
    .scroll((state.chat_scroll, 0))
}

fn render_activity(state: &AppState) -> Paragraph<'static> {
  let mut lines: Vec<Line> = Vec::new();
  for l in state.activity.iter().rev().take(200).rev() {
    lines.push(Line::from(l.clone()));
  }
  Paragraph::new(Text::from(lines))
    .block(focused_block("Activity", state.focus == Focus::Activity))
    .wrap(Wrap { trim: true })
    .scroll((state.activity_scroll, 0))
}

fn render_debug(state: &AppState) -> Paragraph<'static> {
  let mut lines: Vec<Line> = Vec::new();
  for l in state.debug_lines.iter().rev().take(200).rev() {
    lines.push(Line::from(l.clone()));
  }
  Paragraph::new(Text::from(lines))
    .block(focused_block("Debug", state.focus == Focus::Debug))
    .wrap(Wrap { trim: true })
    .scroll((state.debug_scroll, 0))
}

fn render_input(state: &AppState) -> Paragraph<'static> {
  Paragraph::new(format!("> {}", state.input_buffer))
    .block(focused_block("Input", state.focus == Focus::Input))
}

fn render_permission_modal(state: &AppState) -> Paragraph<'static> {
  let req = state.active_permission.as_ref().expect("active_permission");
  let mut lines: Vec<Line> = Vec::new();

  lines.push(Line::from("Permission required"));
  lines.push(Line::from(format!(
    "tool={} kind={} resource={}",
    req.tool.clone().unwrap_or_else(|| "?".to_string()),
    req.kind.clone().unwrap_or_else(|| "?".to_string()),
    req.resource.clone().unwrap_or_else(|| "?".to_string())
  )));
  if let Some(tool_call_id) = &req.tool_call_id {
    lines.push(Line::from(format!("toolCallId={tool_call_id}")));
    match state.tool_inputs_by_tool_call_id.get(tool_call_id) {
      Some(input) => lines.push(Line::from(format!("input={}", input))),
      None => lines.push(Line::from("input=<unavailable>")),
    }
  }
  lines.push(Line::from(""));
  lines.push(Line::from("Options:"));

  for (i, o) in req.options.iter().enumerate() {
    let marker = if i == state.active_permission_selected { ">" } else { " " };
    lines.push(Line::from(format!("{marker} {} - {}", o.option_id, o.label)));
  }

  lines.push(Line::from(""));
  lines.push(Line::from("Use Up/Down and Enter"));

  Paragraph::new(Text::from(lines))
    .block(Block::default().title("Permission").borders(Borders::ALL))
    .wrap(Wrap { trim: true })
}

fn focused_block(title: &'static str, focused: bool) -> Block<'static> {
  let base = Block::default().title(title).borders(Borders::ALL);
  if focused {
    base.border_style(Style::default().fg(Color::Yellow))
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
    Line::from("Ctrl+1   Toggle Chat pane"),
    Line::from("Ctrl+2   Toggle Activity pane"),
    Line::from("Ctrl+3   Toggle Debug pane"),
    Line::from("Tab      Cycle focus"),
    Line::from("Up/Down  Scroll or history (depends on focus)"),
    Line::from("? / F1   Toggle help"),
    Line::from(""),
    Line::from("Permission modal: Up/Down select, Enter decide"),
  ];

  Paragraph::new(Text::from(lines))
    .block(Block::default().title("Help").borders(Borders::ALL))
    .wrap(Wrap { trim: true })
}

fn centered_rect(percent_x: u16, percent_y: u16, r: ratatui::layout::Rect) -> ratatui::layout::Rect {
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
  Some(format!("node {}", sh_quote(candidate.to_string_lossy().as_ref())))
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
