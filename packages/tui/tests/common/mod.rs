use lace_tui::protocol::transport::AgentTransport;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::{tempdir, TempDir};

pub fn sh_quote(s: &str) -> String {
  let mut out = String::from("'");
  for ch in s.chars() {
    if ch == '\'' {
      out.push_str("'\\''");
    } else {
      out.push(ch);
    }
  }
  out.push('\'');
  out
}

pub fn fixture_path(name: &str) -> PathBuf {
  let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  here
    .join("../cli/src/__tests__/fixtures")
    .join(name)
    .canonicalize()
    .unwrap()
}

pub fn spawn_node_fixture(name: &str) -> (TempDir, AgentTransport) {
  let workdir = tempdir().unwrap();
  let agent = fixture_path(name);
  let agent_cmd = format!("node {}", sh_quote(agent.to_string_lossy().as_ref()));
  let transport = AgentTransport::spawn_shell(&agent_cmd, workdir.path()).unwrap();
  (workdir, transport)
}

#[allow(dead_code)]
pub fn wait_for_line(transport: &AgentTransport, deadline: Instant) -> String {
  loop {
    match transport.try_recv_line() {
      Ok(line) => return line,
      Err(std::sync::mpsc::TryRecvError::Empty) => {
        if Instant::now() > deadline {
          panic!("timeout waiting for agent output");
        }
        std::thread::sleep(Duration::from_millis(5));
      }
      Err(std::sync::mpsc::TryRecvError::Disconnected) => panic!("agent output channel disconnected"),
    }
  }
}
