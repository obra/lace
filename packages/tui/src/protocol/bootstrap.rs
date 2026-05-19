use crate::app::{ChatMessage, Role, SlashCommand};
use crate::protocol::transport::AgentTransport;
use crate::protocol::{ent, jsonrpc};
use serde_json::{json, Value};
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

/// Tool use event from session history
#[derive(Debug, Clone)]
pub struct HistoryToolUse {
    pub tool_call_id: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub input: Value,
    pub result: Option<Value>,
    pub job_id: Option<String>,
    pub turn_id: Option<String>,
    pub turn_seq: Option<i64>,
}

/// Result from bootstrapping an agent session
#[derive(Debug, Clone)]
pub struct BootstrapResult {
    pub session_id: String,
    pub slash_commands: Vec<SlashCommand>,
    /// Conversation history loaded from an existing session
    pub history: Vec<ChatMessage>,
    /// Tool use history from an existing session
    pub tool_history: Vec<HistoryToolUse>,
}

pub fn bootstrap_session(
    transport: &AgentTransport,
    workdir: &Path,
    load_session_id: Option<&str>,
) -> io::Result<BootstrapResult> {
    transport
        .send_line(jsonrpc::encode_request(
            json!("c_1"),
            "initialize",
            Some(ent::initialize_params()),
        ))
        .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;

    let session_method = if load_session_id.is_some() {
        "session/load"
    } else {
        "session/new"
    };

    let session_params = if let Some(session_id) = load_session_id {
        json!({
            "sessionId": session_id,
            "cwd": workdir.to_string_lossy(),
            "mcpServers": []
        })
    } else {
        json!({
            "cwd": workdir.to_string_lossy(),
            "mcpServers": []
        })
    };

    transport
        .send_line(jsonrpc::encode_request(
            json!("c_2"),
            session_method,
            Some(session_params),
        ))
        .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;

    let mut init_ok = false;
    let mut session_id: Option<String> = None;
    let mut slash_commands: Vec<SlashCommand> = Vec::new();

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let line = match transport.try_recv_line() {
            Ok(line) => line,
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "agent stdout channel disconnected",
                ));
            }
        };

        let inbound = match jsonrpc::parse_inbound(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        match inbound {
            jsonrpc::InboundMessage::Response { id, result, error } => {
                if id == json!("c_1") {
                    if let Some(error) = error {
                        return Err(io::Error::new(io::ErrorKind::Other, error.message));
                    }
                    slash_commands = extract_slash_commands(&result);
                    init_ok = true;
                } else if id == json!("c_2") {
                    if let Some(error) = error {
                        return Err(io::Error::new(io::ErrorKind::Other, error.message));
                    }
                    let sid = extract_session_id(result);
                    if let Some(sid) = sid {
                        session_id = Some(sid);
                    }
                }
            }
            jsonrpc::InboundMessage::Request { id, method, .. } => {
                if method == "session/request_permission" {
                    let result = json!({ "decision": "deny" });
                    let _ = transport.send_line(jsonrpc::encode_response_result(id, result));
                    continue;
                }
                let _ = transport.send_line(jsonrpc::encode_response_result(id, Value::Null));
            }
            jsonrpc::InboundMessage::Notification { .. } => {}
        }

        if init_ok {
            if let Some(sid) = session_id.clone() {
                // If we loaded an existing session, fetch history
                let (history, tool_history) = if load_session_id.is_some() {
                    fetch_session_history(transport)?
                } else {
                    (Vec::new(), Vec::new())
                };

                return Ok(BootstrapResult {
                    session_id: sid,
                    slash_commands,
                    history,
                    tool_history,
                });
            }
        }
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "timeout waiting for initialize/session response",
    ))
}

/// Fetch session history via ent/session/events and convert to ChatMessages and ToolUse history
fn fetch_session_history(
    transport: &AgentTransport,
) -> io::Result<(Vec<ChatMessage>, Vec<HistoryToolUse>)> {
    // Send request for events
    transport
        .send_line(jsonrpc::encode_request(
            json!("c_history"),
            "ent/session/events",
            Some(json!({ "limit": 1000 })),
        ))
        .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let line = match transport.try_recv_line() {
            Ok(line) => line,
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "agent stdout channel disconnected",
                ));
            }
        };

        let inbound = match jsonrpc::parse_inbound(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        match inbound {
            jsonrpc::InboundMessage::Response { id, result, error } => {
                if id == json!("c_history") {
                    if let Some(error) = error {
                        // Log error but don't fail - just return empty history
                        eprintln!("Warning: failed to fetch history: {}", error.message);
                        return Ok((Vec::new(), Vec::new()));
                    }
                    return Ok(parse_history_events(&result));
                }
            }
            jsonrpc::InboundMessage::Request { id, .. } => {
                // Respond to any requests during history fetch
                let _ = transport.send_line(jsonrpc::encode_response_result(id, Value::Null));
            }
            jsonrpc::InboundMessage::Notification { .. } => {}
        }
    }

    // Timeout - return empty history rather than failing
    Ok((Vec::new(), Vec::new()))
}

fn extract_session_id(result: Option<Value>) -> Option<String> {
    let result = result?;
    let obj = result.as_object()?;
    obj.get("sessionId")?.as_str().map(|s| s.to_string())
}

fn extract_slash_commands(result: &Option<Value>) -> Vec<SlashCommand> {
    let result = match result {
        Some(v) => v,
        None => return Vec::new(),
    };
    let obj = match result.as_object() {
        Some(o) => o,
        None => return Vec::new(),
    };
    let capabilities = match obj.get("capabilities").and_then(|v| v.as_object()) {
        Some(c) => c,
        None => return Vec::new(),
    };
    let commands = match capabilities.get("slashCommands").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return Vec::new(),
    };

    commands
        .iter()
        .filter_map(|cmd| {
            let obj = cmd.as_object()?;
            let name = obj.get("name")?.as_str()?.to_string();
            let description = obj
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_hint = obj
                .get("inputHint")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let source = obj
                .get("source")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(SlashCommand {
                name,
                description,
                input_hint,
                source,
            })
        })
        .collect()
}

/// Parse ent/session/events response into ChatMessage list and ToolUse history.
///
/// Uses a two-pass approach:
/// 1. First pass: collect all events, noting which turn_ids have tool_use events
/// 2. Second pass: create messages, including empty assistant messages only if
///    their turn has associated tool calls (needed for inline rendering)
fn parse_history_events(result: &Option<Value>) -> (Vec<ChatMessage>, Vec<HistoryToolUse>) {
    let Some(Value::Object(obj)) = result else {
        return (Vec::new(), Vec::new());
    };
    let Some(Value::Array(events)) = obj.get("events") else {
        return (Vec::new(), Vec::new());
    };

    // First pass: collect turn_ids that have tool_use events
    let mut turns_with_tools: std::collections::HashSet<String> = std::collections::HashSet::new();
    for event in events {
        let Some(event_obj) = event.as_object() else {
            continue;
        };
        if event_obj.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
            if let Some(turn_id) = event_obj.get("turnId").and_then(|v| v.as_str()) {
                turns_with_tools.insert(turn_id.to_string());
            }
        }
    }

    // Second pass: create messages and tool history
    let mut messages: Vec<ChatMessage> = Vec::new();
    let mut tool_history: Vec<HistoryToolUse> = Vec::new();

    for event in events {
        let Some(event_obj) = event.as_object() else {
            continue;
        };
        let Some(event_type) = event_obj.get("type").and_then(|v| v.as_str()) else {
            continue;
        };
        let turn_id = event_obj
            .get("turnId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let turn_seq = event_obj.get("turnSeq").and_then(|v| v.as_i64());
        let data = event_obj.get("data");

        match event_type {
            "prompt" => {
                // User message: data.content is array of content blocks
                if let Some(text) = extract_text_from_content(data) {
                    messages.push(ChatMessage {
                        role: Role::User,
                        text,
                        streaming: false,
                        turn_id,
                        turn_seq,
                    });
                }
            }
            "message" => {
                // Assistant message: data.content may be a string or array of content blocks
                let text = data.and_then(|d| d.get("content")).and_then(|c| {
                    // Try as string first (legacy or simple format)
                    if let Some(s) = c.as_str() {
                        return Some(s.to_string());
                    }
                    // Try as array of content blocks
                    if let Some(arr) = c.as_array() {
                        let text_parts: Vec<String> = arr
                            .iter()
                            .filter_map(|block| {
                                let obj = block.as_object()?;
                                if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                                    obj.get("text")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                } else {
                                    None
                                }
                            })
                            .collect();
                        if !text_parts.is_empty() {
                            return Some(text_parts.join("\n"));
                        }
                    }
                    None
                });

                // Create message if: has text content OR turn has tool calls (for inline rendering)
                let has_tools = turn_id
                    .as_ref()
                    .map(|id| turns_with_tools.contains(id))
                    .unwrap_or(false);

                if text.is_some() || has_tools {
                    messages.push(ChatMessage {
                        role: Role::Assistant,
                        text: text.unwrap_or_default(),
                        streaming: false,
                        turn_id,
                        turn_seq,
                    });
                }
            }
            "tool_use" => {
                // Tool use event: extract tool call details from data object
                if let Some(data_obj) = data.and_then(|d| d.as_object()) {
                    if let Some(tool_call_id) = data_obj
                        .get("toolCallId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                    {
                        let name = data_obj
                            .get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        // Status may be directly available or derived from result.outcome
                        let status = data_obj
                            .get("status")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| {
                                // Derive status from result.outcome for durable events
                                data_obj
                                    .get("result")
                                    .and_then(|r| r.get("outcome"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            });

                        let input = data_obj.get("input").cloned().unwrap_or(Value::Null);
                        let result = data_obj.get("result").cloned();
                        let job_id = data_obj
                            .get("jobId")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        tool_history.push(HistoryToolUse {
                            tool_call_id,
                            name,
                            status,
                            input,
                            result,
                            job_id,
                            turn_id,
                            turn_seq,
                        });
                    }
                }
            }
            // Skip other event types (turn_start, turn_end, etc.)
            _ => {}
        }
    }

    // Third pass: create placeholder assistant messages for turns that have tools
    // but no message event (e.g., tool-only responses or failed turns)
    let turns_with_messages: std::collections::HashSet<String> = messages
        .iter()
        .filter(|m| m.role == Role::Assistant)
        .filter_map(|m| m.turn_id.clone())
        .collect();

    for turn_id in &turns_with_tools {
        if !turns_with_messages.contains(turn_id) {
            // Find the turn_seq for this turn from the tool history
            let turn_seq = tool_history
                .iter()
                .find(|t| t.turn_id.as_deref() == Some(turn_id))
                .and_then(|t| t.turn_seq);

            messages.push(ChatMessage {
                role: Role::Assistant,
                text: String::new(),
                streaming: false,
                turn_id: Some(turn_id.clone()),
                turn_seq,
            });
        }
    }

    (messages, tool_history)
}

/// Extract text from a content array (used for prompt events)
fn extract_text_from_content(data: Option<&Value>) -> Option<String> {
    let content = data?.get("content")?.as_array()?;
    let mut text_parts: Vec<String> = Vec::new();

    for block in content {
        if let Some(obj) = block.as_object() {
            if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                    text_parts.push(text.to_string());
                }
            }
        }
    }

    if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_history_events_into_messages() {
        // Test with actual durable event structure (content as array of content blocks)
        let result = Some(json!({
            "events": [
                {
                    "eventSeq": 1,
                    "type": "context_injected",
                    "data": { "priority": "normal" }
                },
                {
                    "eventSeq": 2,
                    "type": "prompt",
                    "turnId": "turn_1",
                    "turnSeq": 0,
                    "data": { "content": [{ "type": "text", "text": "Hello world" }] }
                },
                {
                    "eventSeq": 3,
                    "type": "turn_start",
                    "turnId": "turn_1",
                    "data": {}
                },
                {
                    "eventSeq": 4,
                    "type": "message",
                    "turnId": "turn_1",
                    "turnSeq": 1,
                    "data": { "content": [{ "type": "text", "text": "Hi there!" }] }
                },
                {
                    "eventSeq": 5,
                    "type": "turn_end",
                    "turnId": "turn_1",
                    "data": { "stopReason": "end_turn" }
                }
            ],
            "hasMore": false
        }));

        let (messages, tool_history) = parse_history_events(&result);
        assert_eq!(messages.len(), 2);
        assert!(tool_history.is_empty());

        assert_eq!(messages[0].role, Role::User);
        assert_eq!(messages[0].text, "Hello world");
        assert_eq!(messages[0].turn_id, Some("turn_1".to_string()));
        assert!(!messages[0].streaming);

        assert_eq!(messages[1].role, Role::Assistant);
        assert_eq!(messages[1].text, "Hi there!");
        assert_eq!(messages[1].turn_id, Some("turn_1".to_string()));
        assert!(!messages[1].streaming);
    }

    #[test]
    fn parses_message_with_string_content_legacy() {
        // Test legacy format where content is a plain string
        let result = Some(json!({
            "events": [
                {
                    "eventSeq": 1,
                    "type": "message",
                    "turnId": "turn_1",
                    "turnSeq": 1,
                    "data": { "content": "Plain string content" }
                }
            ],
            "hasMore": false
        }));

        let (messages, _) = parse_history_events(&result);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].text, "Plain string content");
    }

    #[test]
    fn parses_tool_use_history() {
        // Test with actual durable event structure (status derived from result.outcome)
        let result = Some(json!({
            "events": [
                {
                    "eventSeq": 1,
                    "type": "prompt",
                    "turnId": "turn_1",
                    "turnSeq": 0,
                    "data": { "content": [{ "type": "text", "text": "Read a file" }] }
                },
                {
                    "eventSeq": 2,
                    "type": "tool_use",
                    "turnId": "turn_1",
                    "turnSeq": 1,
                    "data": {
                        "toolCallId": "tool_1",
                        "name": "Read",
                        "kind": "read",
                        "input": { "path": "/tmp/test.txt" },
                        "result": { "outcome": "completed", "content": [{"type": "text", "text": "hello world"}] }
                    }
                },
                {
                    "eventSeq": 3,
                    "type": "message",
                    "turnId": "turn_1",
                    "turnSeq": 2,
                    "data": { "content": [{ "type": "text", "text": "The file contains: hello world" }] }
                }
            ],
            "hasMore": false
        }));

        let (messages, tool_history) = parse_history_events(&result);
        assert_eq!(messages.len(), 2);
        assert_eq!(tool_history.len(), 1);

        // Verify messages preserve turn context for matching with tools
        assert_eq!(messages[0].turn_id, Some("turn_1".to_string()));
        assert_eq!(messages[1].turn_id, Some("turn_1".to_string()));

        let tool = &tool_history[0];
        assert_eq!(tool.tool_call_id, "tool_1");
        assert_eq!(tool.name, Some("Read".to_string()));
        // Status derived from result.outcome
        assert_eq!(tool.status, Some("completed".to_string()));
        assert_eq!(tool.turn_id, Some("turn_1".to_string()));
        assert_eq!(tool.turn_seq, Some(1));
        assert!(tool.result.is_some());
        // Verify input was captured
        assert_eq!(
            tool.input.get("path").and_then(|v| v.as_str()),
            Some("/tmp/test.txt")
        );
    }

    #[test]
    fn parses_empty_history() {
        let result = Some(json!({ "events": [], "hasMore": false }));
        let (messages, tool_history) = parse_history_events(&result);
        assert!(messages.is_empty());
        assert!(tool_history.is_empty());
    }

    #[test]
    fn handles_missing_result() {
        let (messages, tool_history) = parse_history_events(&None);
        assert!(messages.is_empty());
        assert!(tool_history.is_empty());
    }

    #[test]
    fn creates_placeholder_for_tool_only_turn() {
        // Turn with tool_use but no message event (failed before any text)
        let result = Some(json!({
            "events": [
                {
                    "eventSeq": 1,
                    "type": "prompt",
                    "turnId": "turn_user",
                    "turnSeq": 0,
                    "data": { "content": [{ "type": "text", "text": "Read a file" }] }
                },
                {
                    "eventSeq": 2,
                    "type": "tool_use",
                    "turnId": "turn_tool_only",
                    "turnSeq": 1,
                    "data": {
                        "toolCallId": "tool_1",
                        "name": "file_read",
                        "status": "failed",
                        "input": { "path": "/nonexistent.txt" },
                        "result": { "error": "File not found" }
                    }
                }
            ],
            "hasMore": false
        }));

        let (messages, tool_history) = parse_history_events(&result);

        // Should have user message + placeholder assistant message for tool turn
        assert_eq!(messages.len(), 2);
        assert_eq!(tool_history.len(), 1);

        // User message
        assert_eq!(messages[0].role, Role::User);
        assert_eq!(messages[0].turn_id, Some("turn_user".to_string()));

        // Placeholder assistant message for tool-only turn
        assert_eq!(messages[1].role, Role::Assistant);
        assert_eq!(messages[1].turn_id, Some("turn_tool_only".to_string()));
        assert!(messages[1].text.is_empty()); // No text, just placeholder

        // Tool should have matching turn_id
        assert_eq!(tool_history[0].turn_id, Some("turn_tool_only".to_string()));
    }
}
