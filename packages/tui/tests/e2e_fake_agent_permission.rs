mod common;

use lace_tui::app::reducer::{decide_permission, reduce, take_next_permission, AppEvent, Outbound};
use lace_tui::app::AppState;
use lace_tui::protocol::{ent, jsonrpc, transport::AgentTransport};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

fn apply_outbound(transport: &AgentTransport, out: Vec<Outbound>) {
    for m in out {
        match m {
            Outbound::JsonRpcRequest { .. } => {}
            Outbound::JsonRpcResponse { id, result } => {
                transport
                    .send_line(jsonrpc::encode_response_result(id, result))
                    .unwrap();
            }
        }
    }
}

#[test]
fn e2e_permission_flow_with_fake_agent() {
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
            Some(json!({"cwd": workdir.path().to_string_lossy(), "mcpServers": []})),
        ))
        .unwrap();

    let mut state = AppState::new();

    transport
        .send_line(jsonrpc::encode_request(
            json!("c_3"),
            "session/prompt",
            Some(json!({"content":[{"type":"text","text":"do it"}]})),
        ))
        .unwrap();
    reduce(
        &mut state,
        AppEvent::PromptDispatched {
            request_id: "c_3".to_string(),
        },
    );

    let deadline = Instant::now() + Duration::from_secs(10);

    let mut saw_init = false;
    let mut saw_new = false;
    let mut decided_permission = false;
    let mut saw_prompt_response = false;
    let mut saw_turn_end = false;

    while Instant::now() < deadline {
        let line = common::wait_for_line(&transport, deadline);
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
                    continue;
                }

                if method == "session/request_permission" {
                    let params = params.unwrap_or(Value::Null);
                    let req = ent::decode_permission_request(id, &params);
                    reduce(&mut state, AppEvent::PermissionRequested(req));

                    let active = take_next_permission(&mut state).expect("permission queued");
                    let tool_call_id = active.tool_call_id.clone().expect("toolCallId present");
                    assert!(
                        state
                            .tool_inputs_by_tool_call_id
                            .contains_key(&tool_call_id),
                        "expected tool_use input to be cached before permission decision"
                    );

                    let out = decide_permission(active, "allow").unwrap();
                    apply_outbound(&transport, out);
                    decided_permission = true;
                    continue;
                }

                transport
                    .send_line(jsonrpc::encode_response_result(id, Value::Null))
                    .unwrap();
            }
            jsonrpc::InboundMessage::Response {
                id,
                result: _,
                error: _,
            } => {
                if id == json!("c_1") {
                    saw_init = true;
                } else if id == json!("c_2") {
                    saw_new = true;
                } else if id == json!("c_3") {
                    saw_prompt_response = true;
                    reduce(
                        &mut state,
                        AppEvent::RpcResponse {
                            id: json!("c_3"),
                            usage_tokens: None,
                        },
                    );
                }
            }
        }

        if saw_init && saw_new && decided_permission && saw_prompt_response {
            break;
        }
    }

    let _ = transport.child.kill();
    let _ = transport.child.wait();

    assert!(saw_init, "did not receive initialize response");
    assert!(saw_new, "did not receive session/new response");
    assert!(decided_permission, "did not decide permission");
    assert!(saw_prompt_response, "did not receive prompt response");
    assert!(saw_turn_end, "did not receive turn_end update");

    assert_eq!(state.messages.len(), 1);
    assert_eq!(state.messages[0].text, "ok");
    assert!(!state.messages[0].streaming);
}
