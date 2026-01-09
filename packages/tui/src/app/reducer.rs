use crate::app::{AppState, ChatMessage, PermissionAllowKey, PermissionRequest, Role};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
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
        /// Token usage from session/prompt response (inputTokens + outputTokens)
        usage_tokens: Option<u64>,
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
        AppEvent::TextDelta {
            text,
            turn_id,
            turn_seq,
        } => {
            append_assistant_text(state, &text, turn_id.as_deref(), turn_seq);
            Vec::new()
        }
        AppEvent::TurnEnd { .. } => {
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
            // Accumulate token usage if provided
            if let Some(tokens) = usage_tokens {
                state.token_count = Some(state.token_count.unwrap_or(0) + tokens);
            }
            Vec::new()
        }
    }
}

fn auto_permission_decision(state: &AppState, req: &PermissionRequest) -> Option<String> {
    let key = permission_allow_key(req)?;
    let decision = state.permission_allowlist.get(&key)?;
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

    let result = Value::Object(
        [("decision".to_string(), Value::String(decision.to_string()))]
            .into_iter()
            .collect(),
    );
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
    fn rpc_response_accumulates_token_usage() {
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

        // Second response adds to the total
        reduce(
            &mut state,
            AppEvent::RpcResponse {
                id: json!("c_2"),
                usage_tokens: Some(200),
            },
        );
        assert_eq!(state.token_count, Some(350));

        // Response without usage doesn't change the count
        reduce(
            &mut state,
            AppEvent::RpcResponse {
                id: json!("c_3"),
                usage_tokens: None,
            },
        );
        assert_eq!(state.token_count, Some(350));
    }
}
