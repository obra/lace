use crate::app::{ChatMessage, Role, SlashCommand};
use crate::protocol::transport::AgentTransport;
use crate::protocol::{ent, jsonrpc};
use serde_json::{json, Value};
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

/// Result from bootstrapping an agent session
#[derive(Debug, Clone)]
pub struct BootstrapResult {
    pub session_id: String,
    pub slash_commands: Vec<SlashCommand>,
    /// Conversation history loaded from an existing session
    pub history: Vec<ChatMessage>,
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
        json!({ "sessionId": session_id })
    } else {
        json!({ "workDir": workdir.to_string_lossy() })
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
                let history = if load_session_id.is_some() {
                    fetch_session_history(transport)?
                } else {
                    Vec::new()
                };

                return Ok(BootstrapResult {
                    session_id: sid,
                    slash_commands,
                    history,
                });
            }
        }
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "timeout waiting for initialize/session response",
    ))
}

/// Fetch session history via ent/session/events and convert to ChatMessages
fn fetch_session_history(transport: &AgentTransport) -> io::Result<Vec<ChatMessage>> {
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
                        return Ok(Vec::new());
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
    Ok(Vec::new())
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

/// Parse ent/session/events response into ChatMessage list
fn parse_history_events(result: &Option<Value>) -> Vec<ChatMessage> {
    let Some(Value::Object(obj)) = result else {
        return Vec::new();
    };
    let Some(Value::Array(events)) = obj.get("events") else {
        return Vec::new();
    };

    let mut messages: Vec<ChatMessage> = Vec::new();

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
                // Assistant message: data.content is a string
                if let Some(text) = data
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
                {
                    messages.push(ChatMessage {
                        role: Role::Assistant,
                        text,
                        streaming: false,
                        turn_id,
                        turn_seq,
                    });
                }
            }
            // Skip other event types (turn_start, turn_end, tool_use, etc.)
            _ => {}
        }
    }

    messages
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
                    "data": { "content": "Hi there!" }
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

        let messages = parse_history_events(&result);
        assert_eq!(messages.len(), 2);

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
    fn parses_empty_history() {
        let result = Some(json!({ "events": [], "hasMore": false }));
        let messages = parse_history_events(&result);
        assert!(messages.is_empty());
    }

    #[test]
    fn handles_missing_result() {
        let messages = parse_history_events(&None);
        assert!(messages.is_empty());
    }
}
