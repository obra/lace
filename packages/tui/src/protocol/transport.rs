use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;

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

        // stderr reader also logs to a file under LACE_DIR for diagnostics
        let lace_home = std::env::var("LACE_DIR")
            .ok()
            .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.lace")))
            .unwrap_or_else(|| ".lace".to_string());
        let log_path = Path::new(&lace_home).join("tui-agent-stderr.log");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut stderr_log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();

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
}
