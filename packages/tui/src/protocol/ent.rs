use crate::app::reducer::AppEvent;
use crate::app::{PermissionOption, PermissionRequest};
use serde_json::json;
use serde_json::Value;

pub fn initialize_params() -> Value {
    json!({
        "protocolVersion": "1.0",
        "clientInfo": { "name": env!("CARGO_PKG_NAME"), "version": env!("CARGO_PKG_VERSION") },
        "capabilities": { "streaming": true, "permissions": true, "ent/jobStreaming": "coalesced" }
    })
}

pub fn decode_session_update(params: &Value) -> Vec<AppEvent> {
    let mut out = Vec::new();
    decode_session_update_inner(params, &mut out, None, None, None);
    out
}

fn decode_session_update_inner(
    params: &Value,
    out: &mut Vec<AppEvent>,
    job_id: Option<String>,
    parent_turn_id: Option<String>,
    parent_turn_seq: Option<i64>,
) {
    let Some(obj) = params.as_object() else {
        return;
    };
    let Some(t) = obj.get("type").and_then(|v| v.as_str()) else {
        return;
    };

    // Try to get turn_id/turn_seq from this object, fall back to parent context
    let turn_id = obj
        .get("turnId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(parent_turn_id);
    let turn_seq = obj
        .get("turnSeq")
        .and_then(|v| v.as_i64())
        .or(parent_turn_seq);

    match t {
        "turn_start" => {
            // Create a placeholder assistant message for this turn.
            // This ensures tools can be matched to a message even if
            // the agent responds with only tool calls (no text).
            out.push(AppEvent::TurnStart { turn_id, turn_seq });
        }
        "text_delta" => {
            if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                out.push(AppEvent::TextDelta {
                    text: text.to_string(),
                    turn_id,
                    turn_seq,
                });
            }
        }
        "turn_end" => {
            let stop_reason = obj
                .get("data")
                .and_then(|d| d.get("stopReason"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            out.push(AppEvent::TurnEnd {
                stop_reason,
                turn_id,
                turn_seq,
            });
        }
        "thinking_start" => {
            out.push(AppEvent::ThinkingStart { turn_id, turn_seq });
        }
        "thinking_delta" => {
            if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                out.push(AppEvent::ThinkingDelta {
                    text: text.to_string(),
                    turn_id,
                    turn_seq,
                });
            }
        }
        "thinking_end" => {
            let tokens = obj.get("tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            out.push(AppEvent::ThinkingEnd {
                tokens,
                turn_id,
                turn_seq,
            });
        }
        "tool_use" => {
            let tool_call_id = obj.get("toolCallId").and_then(|v| v.as_str());
            let input = obj.get("input");
            if let (Some(tool_call_id), Some(input)) = (tool_call_id, input) {
                let name = obj
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let kind = obj
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let status = obj
                    .get("status")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let result = obj.get("result").cloned();
                out.push(AppEvent::ToolUse {
                    tool_call_id: tool_call_id.to_string(),
                    name,
                    kind,
                    status,
                    input: input.clone(),
                    result,
                    job_id: job_id.clone(),
                    turn_id,
                    turn_seq,
                });
            }
        }
        "job_update" => {
            let job_id = obj
                .get("jobId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or(job_id);
            if let Some(inner) = obj.get("update") {
                // Pass turn context to inner update since it may not have its own
                decode_session_update_inner(inner, out, job_id, turn_id, turn_seq);
            }
        }
        "job_started" => {
            if let Some(job_id) = obj.get("jobId").and_then(|v| v.as_str()) {
                let job_type = obj
                    .get("jobType")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.push(AppEvent::JobStarted {
                    job_id: job_id.to_string(),
                    job_type,
                });
            }
        }
        "job_finished" => {
            if let Some(job_id) = obj.get("jobId").and_then(|v| v.as_str()) {
                let outcome = obj
                    .get("outcome")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.push(AppEvent::JobFinished {
                    job_id: job_id.to_string(),
                    outcome,
                });
            }
        }
        "session_changed" => {
            if let Some(new_session_id) = obj.get("newSessionId").and_then(|v| v.as_str()) {
                let reason = obj
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                out.push(AppEvent::SessionChanged {
                    new_session_id: new_session_id.to_string(),
                    reason,
                });
            }
        }
        _ => {}
    }
}

pub fn decode_permission_request(id: Value, params: &Value) -> PermissionRequest {
    let obj = params.as_object();

    let tool = obj
        .and_then(|o| o.get("tool"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let kind = obj
        .and_then(|o| o.get("kind"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let resource = obj
        .and_then(|o| o.get("resource"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let tool_call_id = obj
        .and_then(|o| o.get("toolCallId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let turn_id = obj
        .and_then(|o| o.get("turnId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let turn_seq = obj.and_then(|o| o.get("turnSeq")).and_then(|v| v.as_i64());
    let job_id = obj
        .and_then(|o| o.get("jobId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let options = obj
        .and_then(|o| o.get("options"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|o| {
                    let option_id = o.get("optionId")?.as_str()?.to_string();
                    let label = o
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&option_id)
                        .to_string();
                    Some(PermissionOption { option_id, label })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    PermissionRequest {
        id,
        tool,
        kind,
        resource,
        tool_call_id,
        turn_id,
        turn_seq,
        job_id,
        options,
    }
}

pub fn extract_agent_status_config(result: &Option<Value>) -> (Option<String>, Option<String>) {
    let Some(Value::Object(obj)) = result else {
        return (None, None);
    };
    let Some(Value::Object(current)) = obj.get("currentSession") else {
        return (None, None);
    };

    let connection_id = current
        .get("connectionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let model_id = current
        .get("modelId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    (connection_id, model_id)
}

pub fn extract_session_configure_connection(result: &Option<Value>) -> Option<String> {
    let Some(Value::Object(obj)) = result else {
        return None;
    };
    let Some(Value::Object(cfg)) = obj.get("config") else {
        return None;
    };

    cfg
        .get("connectionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

pub fn extract_session_config_option_model(result: &Option<Value>) -> Option<String> {
    let Some(Value::Object(obj)) = result else {
        return None;
    };
    let Some(Value::Array(options)) = obj.get("configOptions") else {
        return None;
    };

    for option in options {
        let Some(option_obj) = option.as_object() else {
            continue;
        };
        if option_obj.get("id").and_then(|v| v.as_str()) == Some("model") {
            return option_obj
                .get("currentValue")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }

    None
}

/// Extract token usage from a session/prompt response.
/// Returns just the inputTokens, which represents the current context size.
/// (outputTokens are not included since inputTokens already contains the full context)
pub fn extract_prompt_usage(result: &Option<Value>) -> Option<u64> {
    let Some(Value::Object(obj)) = result else {
        return None;
    };
    let Some(Value::Object(usage)) = obj.get("usage") else {
        return None;
    };

    usage.get("inputTokens").and_then(|v| v.as_u64())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_text_delta_and_turn_end() {
        let events = decode_session_update(&json!({"type":"text_delta","text":"hi"}));
        assert_eq!(
            events,
            vec![AppEvent::TextDelta {
                text: "hi".to_string(),
                turn_id: None,
                turn_seq: None,
            }]
        );

        let events =
            decode_session_update(&json!({"type":"turn_end","data":{"stopReason":"end_turn"}}));
        assert_eq!(
            events,
            vec![AppEvent::TurnEnd {
                stop_reason: Some("end_turn".to_string()),
                turn_id: None,
                turn_seq: None,
            }]
        );
    }

    #[test]
    fn decodes_tool_use_and_job_update_wrapper() {
        let events = decode_session_update(&json!({
          "type":"tool_use",
          "toolCallId":"tool_1",
          "name":"shell.exec",
          "status":"awaiting_permission",
          "input": {"command":"echo hi"}
        }));
        assert_eq!(
            events,
            vec![AppEvent::ToolUse {
                tool_call_id: "tool_1".to_string(),
                name: Some("shell.exec".to_string()),
                kind: None,
                status: Some("awaiting_permission".to_string()),
                input: json!({"command":"echo hi"}),
                result: None,
                job_id: None,
                turn_id: None,
                turn_seq: None,
            }]
        );

        let events = decode_session_update(&json!({
          "type":"job_update",
          "jobId":"job_1",
          "update": {"type":"text_delta","text":"ok"}
        }));
        assert_eq!(
            events,
            vec![AppEvent::TextDelta {
                text: "ok".to_string(),
                turn_id: None,
                turn_seq: None,
            }]
        );
    }

    #[test]
    fn decodes_permission_request_options() {
        let req = decode_permission_request(
            json!("a_1"),
            &json!({
              "tool":"shell.exec",
              "kind":"execute",
              "resource":"echo hi",
              "toolCallId":"tool_1",
              "turnId":"turn_1",
              "turnSeq":1,
              "options":[{"optionId":"allow","label":"Allow"},{"optionId":"deny","label":"Deny"}]
            }),
        );

        assert_eq!(req.id, json!("a_1"));
        assert_eq!(req.tool.as_deref(), Some("shell.exec"));
        assert_eq!(req.options.len(), 2);
        assert_eq!(req.options[0].option_id, "allow");
    }

    #[test]
    fn extracts_agent_status_config() {
        let (conn, model) = extract_agent_status_config(&Some(json!({
          "currentSession": { "connectionId":"openai-openai", "modelId":"gpt-4.1" }
        })));
        assert_eq!(conn.as_deref(), Some("openai-openai"));
        assert_eq!(model.as_deref(), Some("gpt-4.1"));

        let (conn, model) = extract_agent_status_config(&Some(json!({})));
        assert!(conn.is_none());
        assert!(model.is_none());
    }

    #[test]
    fn extracts_session_configure_connection() {
        let conn = extract_session_configure_connection(&Some(json!({
          "ok": true,
          "config": { "connectionId":"c1" }
        })));
        assert_eq!(conn.as_deref(), Some("c1"));

        let conn = extract_session_configure_connection(&Some(json!({"ok":true})));
        assert!(conn.is_none());
    }

    #[test]
    fn extracts_session_config_option_model() {
        let model = extract_session_config_option_model(&Some(json!({
            "configOptions": [
                {
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "type": "select",
                    "currentValue": "m1",
                    "options": [{"value":"m1","name":"m1"}]
                }
            ]
        })));
        assert_eq!(model.as_deref(), Some("m1"));

        assert!(extract_session_config_option_model(&Some(json!({"configOptions":[]}))).is_none());
    }

    #[test]
    fn extracts_prompt_usage() {
        // Returns only inputTokens (current context size), not the sum
        let usage = extract_prompt_usage(&Some(json!({
            "turnId": "turn_test",
            "stopReason": "end_turn",
            "usage": { "inputTokens": 100, "outputTokens": 50 }
        })));
        assert_eq!(usage, Some(100));

        // Missing usage field
        let usage = extract_prompt_usage(&Some(json!({"turnId": "turn_test"})));
        assert_eq!(usage, None);

        // Empty result
        let usage = extract_prompt_usage(&None);
        assert_eq!(usage, None);
    }

    #[test]
    fn decodes_turn_id_and_turn_seq_from_events() {
        // turn_start should extract turnId/turnSeq from top-level
        let events = decode_session_update(&json!({
            "type": "turn_start",
            "turnId": "turn_abc",
            "turnSeq": 0
        }));
        assert_eq!(
            events,
            vec![AppEvent::TurnStart {
                turn_id: Some("turn_abc".to_string()),
                turn_seq: Some(0),
            }]
        );

        // text_delta should extract turnId/turnSeq
        let events = decode_session_update(&json!({
            "type": "text_delta",
            "text": "Hello",
            "turnId": "turn_abc",
            "turnSeq": 1
        }));
        assert_eq!(
            events,
            vec![AppEvent::TextDelta {
                text: "Hello".to_string(),
                turn_id: Some("turn_abc".to_string()),
                turn_seq: Some(1),
            }]
        );

        // tool_use should extract turnId/turnSeq
        let events = decode_session_update(&json!({
            "type": "tool_use",
            "toolCallId": "tool_1",
            "name": "file_read",
            "status": "completed",
            "input": {"path": "test.txt"},
            "turnId": "turn_abc",
            "turnSeq": 2
        }));
        assert_eq!(
            events,
            vec![AppEvent::ToolUse {
                tool_call_id: "tool_1".to_string(),
                name: Some("file_read".to_string()),
                kind: None,
                status: Some("completed".to_string()),
                input: json!({"path": "test.txt"}),
                result: None,
                job_id: None,
                turn_id: Some("turn_abc".to_string()),
                turn_seq: Some(2),
            }]
        );

        // turn_end should extract turnId/turnSeq
        let events = decode_session_update(&json!({
            "type": "turn_end",
            "data": {"stopReason": "end_turn"},
            "turnId": "turn_abc",
            "turnSeq": 3
        }));
        assert_eq!(
            events,
            vec![AppEvent::TurnEnd {
                stop_reason: Some("end_turn".to_string()),
                turn_id: Some("turn_abc".to_string()),
                turn_seq: Some(3),
            }]
        );
    }

    #[test]
    fn parses_thinking_start_event() {
        let events = decode_session_update(&json!({
            "type": "thinking_start",
            "turnId": "turn_1",
            "turnSeq": 1
        }));
        assert_eq!(
            events,
            vec![AppEvent::ThinkingStart {
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            }]
        );
    }

    #[test]
    fn parses_thinking_delta_event() {
        let events = decode_session_update(&json!({
            "type": "thinking_delta",
            "text": "Let me analyze this...",
            "turnId": "turn_1",
            "turnSeq": 1
        }));
        assert_eq!(
            events,
            vec![AppEvent::ThinkingDelta {
                text: "Let me analyze this...".to_string(),
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(1),
            }]
        );
    }

    #[test]
    fn parses_thinking_end_event() {
        let events = decode_session_update(&json!({
            "type": "thinking_end",
            "tokens": 1500,
            "turnId": "turn_1",
            "turnSeq": 2
        }));
        assert_eq!(
            events,
            vec![AppEvent::ThinkingEnd {
                tokens: 1500,
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(2),
            }]
        );
    }

    #[test]
    fn parses_thinking_end_with_missing_tokens() {
        // Tokens should default to 0 when not present
        let events = decode_session_update(&json!({
            "type": "thinking_end",
            "turnId": "turn_1",
            "turnSeq": 2
        }));
        assert_eq!(
            events,
            vec![AppEvent::ThinkingEnd {
                tokens: 0,
                turn_id: Some("turn_1".to_string()),
                turn_seq: Some(2),
            }]
        );
    }
}
