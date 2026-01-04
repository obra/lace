mod common;

use lace_tui::app::reducer::{reduce, AppEvent};
use lace_tui::app::AppState;
use lace_tui::protocol::{ent, jsonrpc};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

#[test]
fn e2e_session_update_can_arrive_as_request() {
  let (_workdir, mut transport) =
    common::spawn_node_tui_fixture("fake-agent-session-update-request.mjs");

  transport
    .send_line(jsonrpc::encode_request(
      json!("c_1"),
      "initialize",
      Some(json!({"protocolVersion":"1.0"})),
    ))
    .unwrap();
  transport
    .send_line(jsonrpc::encode_request(json!("c_2"), "session/new", Some(json!({"workDir":"."}))))
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
    let line = common::wait_for_line(&transport, deadline);
    let inbound = jsonrpc::parse_inbound(&line).unwrap();
    match inbound {
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
      jsonrpc::InboundMessage::Notification { .. } => {}
    }

    if saw_prompt_response && saw_turn_end {
      break;
    }
  }

  let _ = transport.child.kill();
  let _ = transport.child.wait();

  assert!(saw_prompt_response);
  assert!(saw_turn_end);
  assert_eq!(state.messages.len(), 1);
  assert_eq!(state.messages[0].text, "Hello world!");
  assert!(!state.messages[0].streaming);
}

