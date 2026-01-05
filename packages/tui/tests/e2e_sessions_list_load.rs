mod common;

use lace_tui::app::reducer::Outbound;
use lace_tui::app::sessions;
use lace_tui::app::AppState;
use lace_tui::protocol::{ent, jsonrpc, transport::AgentTransport};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

fn send_request(transport: &AgentTransport, state: &mut AppState, out: Outbound) {
    match out {
        Outbound::JsonRpcRequest { id, method, params } => {
            transport
                .send_line(jsonrpc::encode_request(
                    Value::String(id.clone()),
                    &method,
                    params,
                ))
                .unwrap();
            state.mark_request_sent(id, method, 0, 1_000_000);
        }
        Outbound::JsonRpcResponse { .. } => {}
    }
}

#[test]
fn e2e_sessions_list_and_load_with_fake_agent() {
    let (workdir, mut transport) = common::spawn_node_fixture("fake-agent.mjs");

    transport
        .send_line(jsonrpc::encode_request(
            json!("c_1"),
            "initialize",
            Some(ent::initialize_params()),
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
    state.workdir = workdir.path().to_string_lossy().to_string();
    state.next_client_seq = 3;

    let out = sessions::open_sessions(&mut state);
    send_request(&transport, &mut state, out.into_iter().next().unwrap());

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let line = common::wait_for_line(&transport, deadline);
        let inbound = jsonrpc::parse_inbound(&line).unwrap();
        if let jsonrpc::InboundMessage::Response { id, result, error } = inbound {
            let Some(id_str) = id.as_str() else { continue };
            let Some(p) = state.take_pending_request(id_str) else {
                continue;
            };
            if p.method == "session/list" {
                sessions::handle_session_list_response(
                    &mut state,
                    &result,
                    error.as_ref().map(|e| e.message.as_str()),
                );
                break;
            }
        }
    }

    assert!(state.sessions.open);
    assert!(!state.sessions.loading);
    assert!(!state.sessions.items.is_empty());

    // Pick the first filtered session and load it.
    state.sessions.selected = 0;
    let out = sessions::submit_load_selected(&mut state);
    assert_eq!(out.len(), 1);
    send_request(&transport, &mut state, out.into_iter().next().unwrap());

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let line = common::wait_for_line(&transport, deadline);
        let inbound = jsonrpc::parse_inbound(&line).unwrap();
        if let jsonrpc::InboundMessage::Response { id, result, .. } = inbound {
            let Some(id_str) = id.as_str() else { continue };
            let Some(p) = state.take_pending_request(id_str) else {
                continue;
            };
            if p.method == "session/load" {
                let session_id = result
                    .as_ref()
                    .and_then(|v| v.get("sessionId"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap();
                state.session_id = Some(session_id.clone());
                sessions::on_session_activated(&mut state, &session_id);
                break;
            }
        }
    }

    let _ = transport.child.kill();
    let _ = transport.child.wait();

    assert_eq!(state.session_id.as_deref(), Some("sess_test"));
    assert!(state.session_switch_target.is_none());
}
