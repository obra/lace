use crate::app::SlashCommand;
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
                return Ok(BootstrapResult {
                    session_id: sid,
                    slash_commands,
                });
            }
        }
    }

    Err(io::Error::new(
        io::ErrorKind::TimedOut,
        "timeout waiting for initialize/session response",
    ))
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
            Some(SlashCommand {
                name,
                description,
                input_hint,
            })
        })
        .collect()
}
