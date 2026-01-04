use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;

#[derive(Debug)]
pub struct AgentTransport {
  pub child: Child,
  inbound_rx: mpsc::Receiver<String>,
  outbound_tx: mpsc::Sender<String>,
}

impl AgentTransport {
  pub fn spawn_shell(agent_cmd: &str, cwd: &Path) -> io::Result<Self> {
    let mut child = Command::new("sh")
      .arg("-lc")
      .arg(agent_cmd)
      .current_dir(cwd)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()?;

    let stdout = child
      .stdout
      .take()
      .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "failed to take child stdout"))?;
    let stderr = child
      .stderr
      .take()
      .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "failed to take child stderr"))?;
    let mut stdin = child
      .stdin
      .take()
      .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "failed to take child stdin"))?;

    let (inbound_tx, inbound_rx) = mpsc::channel::<String>();
    let (outbound_tx, outbound_rx) = mpsc::channel::<String>();

    thread::spawn(move || {
      let mut reader = BufReader::new(stdout);
      let mut line = String::new();
      loop {
        line.clear();
        match reader.read_line(&mut line) {
          Ok(0) => break,
          Ok(_) => {
            while line.ends_with('\n') || line.ends_with('\r') {
              line.pop();
              if line.ends_with('\r') {
                line.pop();
              }
            }
            if inbound_tx.send(line.clone()).is_err() {
              break;
            }
          }
          Err(_) => break,
        }
      }
    });

    thread::spawn(move || {
      let mut reader = BufReader::new(stderr);
      let mut line = String::new();
      loop {
        line.clear();
        match reader.read_line(&mut line) {
          Ok(0) => break,
          Ok(_) => {
            let _ = io::stderr().write_all(line.as_bytes());
            let _ = io::stderr().flush();
          }
          Err(_) => break,
        }
      }
    });

    thread::spawn(move || {
      while let Ok(msg) = outbound_rx.recv() {
        if stdin.write_all(msg.as_bytes()).is_err() {
          break;
        }
        if stdin.write_all(b"\n").is_err() {
          break;
        }
        if stdin.flush().is_err() {
          break;
        }
      }
    });

    Ok(Self {
      child,
      inbound_rx,
      outbound_tx,
    })
  }

  pub fn send_line(&self, line: String) -> Result<(), mpsc::SendError<String>> {
    self.outbound_tx.send(line)
  }

  pub fn try_recv_line(&self) -> Result<String, mpsc::TryRecvError> {
    self.inbound_rx.try_recv()
  }

  pub fn recv_line(&self) -> Result<String, mpsc::RecvError> {
    self.inbound_rx.recv()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn can_send_and_receive_lines_from_child() {
    let dir = std::env::current_dir().unwrap();
    let transport = AgentTransport::spawn_shell("cat", &dir).unwrap();

    transport.send_line("hello".to_string()).unwrap();
    let line = transport.recv_line().unwrap();
    assert_eq!(line, "hello");
  }
}

