use crate::app::{AppState, ChatMessage, PermissionAllowKey, PermissionRequest, Role};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    TurnStart {
        turn_id: Option<String>,
        turn_seq: Option<i64>,
    },
    TextDelta {
        text: String,
        turn_id: Option<String>,
        turn_seq: Option<i64>,
    },
    TurnEnd {
        stop_reason: Option<String>,
        turn_id: Option<String>,
        turn_seq: Option<i64>,
    },
    ToolUse {
        tool_call_id: String,
        name: Option<String>,
        kind: Option<String>,
        status: Option<String>,
        input: Value,
        result: Option<Value>,
        job_id: Option<String>,
        turn_id: Option<String>,
        turn_seq: Option<i64>,
    },
    JobStarted {
        job_id: String,
        job_type: Option<String>,
    },
    JobFinished {
        job_id: String,
        outcome: Option<String>,
    },
    PermissionRequested(PermissionRequest),
    PromptDispatched {
        request_id: String,
    },
    RpcResponse {
        id: Value,
        /// Token usage from session/prompt response (inputTokens = current context size)
        usage_tokens: Option<u64>,
    },
    SessionChanged {
        new_session_id: String,
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outbound {
    JsonRpcRequest {
        id: String,
        method: String,
        params: Option<Value>,
    },
    JsonRpcResponse {
        id: Value,
        result: Value,
    },
}

pub fn reduce(state: &mut AppState, event: AppEvent) -> Vec<Outbound> {
    match event {
        AppEvent::TurnStart { turn_id, turn_seq } => {
            // Track current turn for associating subsequent events
            state.current_turn_id = turn_id.clone();
            state.current_turn_seq = turn_seq;

            // Create an empty streaming assistant message placeholder for this turn.
            // This ensures there's a message with the turn_id even if the agent
            // responds with only tool calls (no text).
            start_assistant_turn(state, turn_id.as_deref(), turn_seq);
            Vec::new()
        }
        AppEvent::TextDelta {
            text,
            turn_id,
            turn_seq,
        } => {
            append_assistant_text(state, &text, turn_id.as_deref(), turn_seq);
            Vec::new()
        }
        AppEvent::TurnEnd { .. } => {
            // Clear current turn context
            state.current_turn_id = None;
            state.current_turn_seq = None;

            end_assistant_stream(state);
            Vec::new()
        }
        AppEvent::ToolUse {
            tool_call_id,
            input,
            ..
        } => {
            state
                .tool_inputs_by_tool_call_id
                .insert(tool_call_id, input);
            Vec::new()
        }
        AppEvent::JobStarted { .. } => Vec::new(),
        AppEvent::JobFinished { .. } => Vec::new(),
        AppEvent::PermissionRequested(req) => {
            if let Some(decision) = auto_permission_decision(state, &req) {
                if let Ok(out) = decide_permission(req.clone(), &decision) {
                    return out;
                }
            }

            state.permission_queue.push_back(req);
            Vec::new()
        }
        AppEvent::PromptDispatched { request_id } => {
            state.active_prompt_request_ids.insert(request_id);
            Vec::new()
        }
        AppEvent::RpcResponse { id, usage_tokens } => {
            if let Some(id_str) = id.as_str() {
                if state.active_prompt_request_ids.remove(id_str) {
                    end_assistant_stream(state);
                }
            }
            // Update token count to current context size (not accumulated)
            if let Some(tokens) = usage_tokens {
                state.token_count = Some(tokens);
            }
            Vec::new()
        }
        AppEvent::SessionChanged {
            new_session_id,
            reason: _,
        } => {
            // Update the session ID when the agent notifies us of a session change
            state.session_id = Some(new_session_id);
            // Clear the conversation messages for the new session
            state.messages.clear();
            // Reset token count for the new session
            state.token_count = None;
            Vec::new()
        }
    }
}

fn auto_permission_decision(state: &AppState, req: &PermissionRequest) -> Option<String> {
    let key = permission_allow_key(req)?;
    let decision = state
        .permission_allowlist_global
        .get(&key)
        .or_else(|| state.permission_allowlist.get(&key))?;
    if req.options.iter().any(|o| o.option_id == *decision) {
        Some(decision.clone())
    } else {
        None
    }
}

pub fn permission_allow_key(req: &PermissionRequest) -> Option<PermissionAllowKey> {
    Some(PermissionAllowKey {
        tool: req.tool.clone()?,
        kind: req.kind.clone()?,
        resource: req.resource.clone()?,
    })
}

pub fn take_next_permission(state: &mut AppState) -> Option<PermissionRequest> {
    state.permission_queue.pop_front()
}

pub fn decide_permission(
    request: PermissionRequest,
    decision: &str,
) -> Result<Vec<Outbound>, String> {
    if !request.options.is_empty() && !request.options.iter().any(|o| o.option_id == decision) {
        return Err(format!("invalid optionId: {decision}"));
    }

    let result = serde_json::json!({ "decision": decision });
    Ok(vec![Outbound::JsonRpcResponse {
        id: request.id,
        result,
    }])
}

fn append_assistant_text(
    state: &mut AppState,
    text: &str,
    turn_id: Option<&str>,
    turn_seq: Option<i64>,
) {
    match state.messages.last_mut() {
        Some(ChatMessage {
            role: Role::Assistant,
            streaming: true,
            ..
        }) => {
            let last = state.messages.last_mut().unwrap();
            last.text.push_str(text);
            if last.turn_id.is_none() {
                last.turn_id = turn_id.map(|s| s.to_string());
            }
            if last.turn_seq.is_none() {
                last.turn_seq = turn_seq;
            }
        }
        Some(ChatMessage {
            role: Role::Assistant,
            streaming: false,
            ..
        })
        | Some(ChatMessage {
            role: Role::User, ..
        })
        | Some(ChatMessage {
            role: Role::System, ..
        })
        | None => {
            state.messages.push(ChatMessage {
                role: Role::Assistant,
                text: text.to_string(),
                streaming: true,
                turn_id: turn_id.map(|s| s.to_string()),
                turn_seq,
            });
        }
    }
}

fn end_assistant_stream(state: &mut AppState) {
    if let Some(msg) = state.messages.last_mut() {
        if msg.role == Role::Assistant && msg.streaming {
            msg.streaming = false;
        }
    }
}

/// Creates an empty streaming assistant message for a new turn.
/// This ensures there's a message with the turn_id even if the agent
/// responds with only tool calls (no text content).
fn start_assistant_turn(state: &mut AppState, turn_id: Option<&str>, turn_seq: Option<i64>) {
    // Only create if the last message isn't already a streaming assistant message
    // with the same turn_id (or no turn_id yet to be filled in).
    match state.messages.last() {
        Some(ChatMessage {
            role: Role::Assistant,
            streaming: true,
            turn_id: existing_turn_id,
            ..
        }) => {
            // If there's already a streaming assistant message, check if turn_ids match
            // or if the existing message has no turn_id yet (it will be filled in by text_delta)
            if existing_turn_id.is_none() || existing_turn_id.as_deref() == turn_id {
                // Update the existing message's turn_id if it's missing
                if let Some(msg) = state.messages.last_mut() {
                    if msg.turn_id.is_none() {
                        msg.turn_id = turn_id.map(|s| s.to_string());
                    }
                    if msg.turn_seq.is_none() {
                        msg.turn_seq = turn_seq;
                    }
                }
                return;
            }
            // Different turn_id means this is a new turn - create new message
        }
        _ => {}
    }

    // Create a new empty streaming assistant message for this turn
    state.messages.push(ChatMessage {
        role: Role::Assistant,
        text: String::new(),
        streaming: true,
        turn_id: turn_id.map(|s| s.to_string()),
        turn_seq,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{PermissionOption, PermissionRequest};
    use serde_json::json;

    #[test]
    fn text_delta_creates_and_appends_to_streaming_message() {
        let mut state = AppState::new();

        reduce(
            &mut state,
            AppEvent::TextDelta {
                text: "Hello".to_string(),
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            },
        );
        reduce(
            &mut state,
            AppEvent::TextDelta {
                text: " world".to_string(),
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            },
        );

        assert_eq!(
            state.messages,
            vec![ChatMessage {
                role: Role::Assistant,
                text: "Hello world".to_string(),
                streaming: true,
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            }]
        );
    }

    #[test]
    fn turn_end_finalizes_streaming_message() {
        let mut state = AppState::new();

        reduce(
            &mut state,
            AppEvent::TextDelta {
                text: "ok".to_string(),
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            },
        );
        reduce(
            &mut state,
            AppEvent::TurnEnd {
                stop_reason: Some("end_turn".to_string()),
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            },
        );

        assert_eq!(state.messages.len(), 1);
        assert!(!state.messages[0].streaming);
    }

    #[test]
    fn tool_use_is_captured_for_permission_display() {
        let mut state = AppState::new();
        reduce(
            &mut state,
            AppEvent::ToolUse {
                tool_call_id: "tool_1".to_string(),
                name: None,
                kind: None,
                status: None,
                input: json!({"command":"echo hi"}),
                result: None,
                job_id: None,
                turn_id: None,
                turn_seq: None,
            },
        );
        assert_eq!(
            state.tool_inputs_by_tool_call_id.get("tool_1"),
            Some(&json!({"command":"echo hi"}))
        );
    }

    #[test]
    fn permission_queue_enqueue_and_decide() {
        let mut state = AppState::new();
        let req = PermissionRequest {
            id: json!("a_1"),
            tool: Some("shell.exec".to_string()),
            kind: Some("execute".to_string()),
            resource: Some("echo hi".to_string()),
            tool_call_id: Some("tool_1".to_string()),
            turn_id: Some("turn_1".to_string()),
            turn_seq: Some(1),
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
        };

        reduce(&mut state, AppEvent::PermissionRequested(req.clone()));
        assert_eq!(state.permission_queue.len(), 1);

        let active = take_next_permission(&mut state).unwrap();
        let out = decide_permission(active, "allow").unwrap();
        assert_eq!(
            out,
            vec![Outbound::JsonRpcResponse {
                id: json!("a_1"),
                result: json!({"decision":"allow"}),
            }]
        );
    }

    #[test]
    fn prompt_response_can_finalize_when_turn_end_is_missing() {
        let mut state = AppState::new();

        reduce(
            &mut state,
            AppEvent::PromptDispatched {
                request_id: "c_1".to_string(),
            },
        );
        reduce(
            &mut state,
            AppEvent::TextDelta {
                text: "ok".to_string(),
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            },
        );

        assert!(state.messages[0].streaming);

        reduce(
            &mut state,
            AppEvent::RpcResponse {
                id: json!("c_1"),
                usage_tokens: None,
            },
        );

        assert!(!state.messages[0].streaming);
    }

    #[test]
    fn permission_allowlist_auto_decides_when_matching() {
        let mut state = AppState::new();
        state.permission_allowlist.insert(
            PermissionAllowKey {
                tool: "shell.exec".to_string(),
                kind: "execute".to_string(),
                resource: "echo hi".to_string(),
            },
            "allow_session".to_string(),
        );

        let req = PermissionRequest {
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
                    option_id: "allow_session".to_string(),
                    label: "Allow for session".to_string(),
                },
                PermissionOption {
                    option_id: "deny".to_string(),
                    label: "Deny".to_string(),
                },
            ],
        };

        let out = reduce(&mut state, AppEvent::PermissionRequested(req));
        assert_eq!(
            out,
            vec![Outbound::JsonRpcResponse {
                id: json!("a_1"),
                result: json!({"decision":"allow_session"}),
            }]
        );
        assert!(state.permission_queue.is_empty());
    }

    #[test]
    fn rpc_response_updates_token_count_to_latest() {
        let mut state = AppState::new();
        assert_eq!(state.token_count, None);

        // First response with usage
        reduce(
            &mut state,
            AppEvent::RpcResponse {
                id: json!("c_1"),
                usage_tokens: Some(150),
            },
        );
        assert_eq!(state.token_count, Some(150));

        // Second response replaces (not accumulates) - this is the current context size
        reduce(
            &mut state,
            AppEvent::RpcResponse {
                id: json!("c_2"),
                usage_tokens: Some(200),
            },
        );
        assert_eq!(state.token_count, Some(200));

        // Response without usage doesn't change the count
        reduce(
            &mut state,
            AppEvent::RpcResponse {
                id: json!("c_3"),
                usage_tokens: None,
            },
        );
        assert_eq!(state.token_count, Some(200));
    }

    #[test]
    fn turn_start_creates_empty_message_placeholder() {
        let mut state = AppState::new();

        reduce(
            &mut state,
            AppEvent::TurnStart {
                turn_id: Some("turn_abc".to_string()),
                turn_seq: Some(0),
            },
        );

        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].role, Role::Assistant);
        assert_eq!(state.messages[0].text, "");
        assert!(state.messages[0].streaming);
        assert_eq!(state.messages[0].turn_id, Some("turn_abc".to_string()));
    }

    #[test]
    fn turn_start_followed_by_text_delta_appends_to_placeholder() {
        let mut state = AppState::new();

        // turn_start creates placeholder
        reduce(
            &mut state,
            AppEvent::TurnStart {
                turn_id: Some("turn_xyz".to_string()),
                turn_seq: Some(0),
            },
        );

        // text_delta appends to the placeholder
        reduce(
            &mut state,
            AppEvent::TextDelta {
                text: "Hello".to_string(),
                turn_id: Some("turn_xyz".to_string()),
                turn_seq: Some(1),
            },
        );

        // Should still be just one message
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].text, "Hello");
        assert_eq!(state.messages[0].turn_id, Some("turn_xyz".to_string()));
    }

    #[test]
    fn turn_start_enables_tool_matching_without_text() {
        let mut state = AppState::new();

        // turn_start creates placeholder with turn_id
        reduce(
            &mut state,
            AppEvent::TurnStart {
                turn_id: Some("turn_tools_only".to_string()),
                turn_seq: Some(0),
            },
        );

        // No text_delta - agent responds with only tool calls
        // The placeholder message still has the turn_id for matching

        assert_eq!(state.messages.len(), 1);
        assert_eq!(
            state.messages[0].turn_id,
            Some("turn_tools_only".to_string())
        );
        // This turn_id can be used to match tool calls in render_chat
    }
}
