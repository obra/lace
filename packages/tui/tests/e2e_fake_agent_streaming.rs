use lace_tui::app::reducer::{reduce, AppEvent};
use lace_tui::app::AppState;
use lace_tui::protocol::{ent, jsonrpc, transport::AgentTransport};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::tempdir;

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

fn fixture_path(name: &str) -> PathBuf {
  let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  here
    .join("../cli/src/__tests__/fixtures")
    .join(name)
    .canonicalize()
    .unwrap()
}

fn wait_for_line(transport: &AgentTransport, deadline: Instant) -> String {
  loop {
    match transport.try_recv_line() {
      Ok(line) => return line,
      Err(std::sync::mpsc::TryRecvError::Empty) => {
        if Instant::now() > deadline {
          panic!("timeout waiting for agent output");
        }
        std::thread::sleep(Duration::from_millis(5));
      }
      Err(std::sync::mpsc::TryRecvError::Disconnected) => panic!("agent output channel disconnected"),
    }
  }
}

#[test]
fn e2e_streaming_text_delta_and_turn_end() {
  let workdir = tempdir().unwrap();
  let agent = fixture_path("fake-agent-streaming.mjs");
  let agent_cmd = format!("node {}", sh_quote(agent.to_string_lossy().as_ref()));

  let mut transport = AgentTransport::spawn_shell(&agent_cmd, workdir.path()).unwrap();

  transport
    .send_line(jsonrpc::encode_request(
      json!("c_1"),
      "initialize",
      Some(json!({"protocolVersion":"1.0"})),
    ))
    .unwrap();

  transport
    .send_line(jsonrpc::encode_request(
      json!("c_2"),
      "session/new",
      Some(json!({"workDir": workdir.path().to_string_lossy()})),
    ))
    .unwrap();

  let mut state = AppState::new();
  transport
    .send_line(jsonrpc::encode_request(
      json!("c_3"),
      "session/prompt",
      Some(json!({"content":[{"type":"text","text":"hi"}]})),
    ))
    .unwrap();
  reduce(
    &mut state,
    AppEvent::PromptDispatched {
      request_id: "c_3".to_string(),
    },
  );

  let deadline = Instant::now() + Duration::from_secs(10);
  let mut saw_prompt_response = false;
  let mut saw_turn_end = false;

  while Instant::now() < deadline {
    let line = wait_for_line(&transport, deadline);
    let inbound = match jsonrpc::parse_inbound(&line) {
      Ok(msg) => msg,
      Err(err) => panic!("failed to parse jsonrpc line: {err}\nline={line}"),
    };

    match inbound {
      jsonrpc::InboundMessage::Notification { method, params } => {
        if method == "session/update" {
          let params = params.unwrap_or(Value::Null);
          for ev in ent::decode_session_update(&params) {
            if matches!(ev, AppEvent::TurnEnd { .. }) {
              saw_turn_end = true;
            }
            reduce(&mut state, ev);
          }
        }
      }
      jsonrpc::InboundMessage::Request { id, method, params } => {
        if method == "session/update" {
          let params = params.unwrap_or(Value::Null);
          for ev in ent::decode_session_update(&params) {
            if matches!(ev, AppEvent::TurnEnd { .. }) {
              saw_turn_end = true;
            }
            reduce(&mut state, ev);
          }
          transport
            .send_line(jsonrpc::encode_response_result(id, Value::Null))
            .unwrap();
        } else {
          transport
            .send_line(jsonrpc::encode_response_result(id, Value::Null))
            .unwrap();
        }
      }
      jsonrpc::InboundMessage::Response { id, .. } => {
        if id == json!("c_3") {
          saw_prompt_response = true;
          reduce(&mut state, AppEvent::RpcResponse { id: json!("c_3") });
        }
      }
    }

    if saw_prompt_response && saw_turn_end {
      break;
    }
  }

  let _ = transport.child.kill();
  let _ = transport.child.wait();

  assert!(saw_prompt_response, "did not receive prompt response");
  assert!(saw_turn_end, "did not receive turn_end update");
  assert_eq!(state.messages.len(), 1);
  assert_eq!(state.messages[0].text, "Hello world!");
  assert!(!state.messages[0].streaming);
}

