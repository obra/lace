mod common;

use lace_tui::app::config_wizard;
use lace_tui::app::reducer::Outbound;
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
            state.mark_request_sent(id, method, None, 0, 1_000_000);
        }
        Outbound::JsonRpcResponse { .. } => {}
    }
}

#[test]
fn e2e_configure_wizard_against_fake_agent() {
    std::env::set_var("OPENAI_API_KEY", "test-key");
    let (workdir, mut transport) = common::spawn_node_fixture("fake-agent-configure.mjs");

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
            Some(json!({"cwd": workdir.path().to_string_lossy(), "mcpServers": []})),
        ))
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut saw_init = false;
    let mut saw_new = false;
    let mut session_id: Option<String> = None;
    while Instant::now() < deadline {
        let line = common::wait_for_line(&transport, deadline);
        let inbound = jsonrpc::parse_inbound(&line).unwrap();
        if let jsonrpc::InboundMessage::Response { id, result, .. } = inbound {
            if id == json!("c_1") {
                saw_init = true;
            }
            if id == json!("c_2") {
                saw_new = true;
                session_id = result
                    .as_ref()
                    .and_then(|v| v.get("sessionId"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
            if saw_init && saw_new {
                break;
            }
        }
    }
    assert!(saw_init);
    assert!(saw_new);
    assert_eq!(session_id.as_deref(), Some("sess_test"));

    let mut state = AppState::new_with_paths(None, None);
    state.next_client_seq = 3;
    state.session_id = session_id;

    let out = config_wizard::open(&mut state);
    assert_eq!(out.len(), 1);
    send_request(&transport, &mut state, out.into_iter().next().unwrap());

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let line = common::wait_for_line(&transport, deadline);
        let inbound = jsonrpc::parse_inbound(&line).unwrap();
        match inbound {
            jsonrpc::InboundMessage::Response { id, result, error } => {
                let id_str = id.as_str().unwrap_or("");
                let pending = state.take_pending_request(id_str);
                let Some(pending) = pending else { continue };

                let follow = config_wizard::handle_response(
                    &mut state,
                    &pending.method,
                    &result,
                    error.as_ref().map(|e| e.message.as_str()),
                );

                for m in follow {
                    send_request(&transport, &mut state, m);
                }

                if state.connection_id.as_deref() == Some("conn_1")
                    && state.model_id.as_deref() == Some("gpt-test")
                {
                    break;
                }
            }
            _ => {}
        }
    }

    let _ = transport.child.kill();
    let _ = transport.child.wait();

    assert_eq!(state.connection_id.as_deref(), Some("conn_1"));
    assert_eq!(state.model_id.as_deref(), Some("gpt-test"));
    assert_eq!(
        state.config_wizard.step,
        config_wizard::ConfigWizardStep::Done
    );
}
