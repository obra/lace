use crate::protocol::jsonrpc;
use crate::protocol::transport::AgentTransport;
use serde_json::{json, Value};
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

pub fn bootstrap_session(
  transport: &AgentTransport,
  workdir: &Path,
  load_session_id: Option<&str>,
) -> io::Result<String> {
  transport
    .send_line(jsonrpc::encode_request(
      json!("c_1"),
      "initialize",
      Some(json!({ "protocolVersion": "1.0" })),
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
        return Ok(sid);
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

