use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

#[derive(Debug)]
pub struct AgentTransport {
    pub child: Child,
    inbound_rx: mpsc::Receiver<String>,
    stderr_rx: mpsc::Receiver<String>,
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
        let (stderr_tx, stderr_rx) = mpsc::channel::<String>();
        let (outbound_tx, outbound_rx) = mpsc::channel::<String>();

        let lace_home = std::env::var("LACE_DIR")
            .ok()
            .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.lace")))
            .unwrap_or_else(|| ".lace".to_string());

        let protocol_log_path = Path::new(&lace_home).join("tui-ent-protocol.log");
        if let Some(parent) = protocol_log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let protocol_log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&protocol_log_path)
            .ok()
            .map(|f| Arc::new(Mutex::new(f)));

        if let Some(log) = protocol_log.as_ref() {
            if let Ok(mut f) = log.lock() {
                let _ = writeln!(f, "=== lace-tui protocol log start ===");
            }
        }

        let protocol_log_inbound = protocol_log.clone();
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
                        write_protocol_line(&protocol_log_inbound, "<<", &line);
                    }
                    Err(_) => break,
                }
            }
        });

        // stderr reader also logs to a file under LACE_DIR for diagnostics
        let log_path = Path::new(&lace_home).join("tui-agent-stderr.log");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut stderr_log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();

        let protocol_log_stderr = protocol_log.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
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
                        if stderr_tx.send(line.clone()).is_err() {
                            break;
                        }
                        if let Some(f) = stderr_log.as_mut() {
                            let _ = writeln!(f, "{}", line);
                        }
                        write_protocol_line(&protocol_log_stderr, "!!", &line);
                    }
                    Err(_) => break,
                }
            }
        });

        let protocol_log_for_outbound = protocol_log.clone();
        thread::spawn(move || {
            while let Ok(msg) = outbound_rx.recv() {
                write_protocol_line(&protocol_log_for_outbound, ">>", &msg);
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
            stderr_rx,
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

    pub fn try_recv_stderr_line(&self) -> Result<String, mpsc::TryRecvError> {
        self.stderr_rx.try_recv()
    }

    pub fn recv_stderr_line(&self) -> Result<String, mpsc::RecvError> {
        self.stderr_rx.recv()
    }
}

fn write_protocol_line(log: &Option<Arc<Mutex<std::fs::File>>>, prefix: &str, line: &str) {
    let Some(log) = log.as_ref() else {
        return;
    };
    let redacted = redact_json_line(line);
    if let Ok(mut f) = log.lock() {
        let _ = writeln!(f, "{prefix} {redacted}");
    }
}

fn redact_json_line(line: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(line) else {
        return line.to_string();
    };
    redact_value(&mut v);
    serde_json::to_string(&v).unwrap_or_else(|_| line.to_string())
}

fn redact_value(v: &mut Value) {
    match v {
        Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                if is_secret_key(k) {
                    *val = Value::String("<redacted>".to_string());
                    continue;
                }
                redact_value(val);
            }
        }
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_value(item);
            }
        }
        _ => {}
    }
}

fn is_secret_key(key: &str) -> bool {
    let k = key.to_lowercase();
    k == "apikey"
        || k == "api_key"
        || k == "token"
        || k == "accesstoken"
        || k == "authorization"
        || k == "password"
        || k == "secret"
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

    #[test]
    fn captures_child_stderr_lines() {
        let dir = std::env::current_dir().unwrap();
        let transport = AgentTransport::spawn_shell("echo err 1>&2; echo out", &dir).unwrap();

        let out = transport.recv_line().unwrap();
        assert_eq!(out, "out");

        let err = transport.recv_stderr_line().unwrap();
        assert_eq!(err, "err");
    }

    #[test]
    fn redact_json_line_hides_secrets() {
        let line = r#"{"method":"ent/connections/credentials/submit","params":{"connectionId":"c1","values":{"apiKey":"sk-123","token":"t"}}}"#;
        let redacted = redact_json_line(line);
        assert!(redacted.contains(r#""apiKey":"<redacted>""#));
        assert!(redacted.contains(r#""token":"<redacted>""#));
    }
}
