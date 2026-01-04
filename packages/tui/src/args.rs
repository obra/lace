use std::ffi::OsString;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
  pub help: bool,
  pub agent_cmd: Option<String>,
  pub workdir: Option<String>,
  pub load_session_id: Option<String>,
  pub explicit_new: bool,
}

pub fn help_text() -> &'static str {
  "Usage:\n  lace-tui [--agent-cmd <cmd>] [--workdir <path>] [--new | --load <sessionId>]\n\nOptions:\n  --agent-cmd <cmd>   Spawn this agent command (shell string)\n  --workdir <path>    Workdir for spawned agent/session (default: cwd)\n  --new               Start a new session (default)\n  --load <sessionId>  Load an existing session\n  -h, --help          Show help\n"
}

impl Args {
  pub fn parse<I>(mut argv: I) -> Result<Self, String>
  where
    I: Iterator<Item = OsString>,
  {
    let mut args = Args {
      help: false,
      agent_cmd: None,
      workdir: None,
      load_session_id: None,
      explicit_new: false,
    };

    while let Some(raw) = argv.next() {
      let s = raw.to_string_lossy();
      match s.as_ref() {
        "-h" | "--help" => args.help = true,
        "--agent-cmd" => {
          let value = argv
            .next()
            .ok_or_else(|| "--agent-cmd expects a value".to_string())?;
          args.agent_cmd = Some(value.to_string_lossy().to_string());
        }
        "--workdir" => {
          let value = argv.next().ok_or_else(|| "--workdir expects a value".to_string())?;
          args.workdir = Some(value.to_string_lossy().to_string());
        }
        "--load" => {
          let value = argv.next().ok_or_else(|| "--load expects a value".to_string())?;
          args.load_session_id = Some(value.to_string_lossy().to_string());
        }
        "--new" => args.explicit_new = true,
        other => return Err(format!("Unknown argument: {other}")),
      }
    }

    if args.load_session_id.is_some() && args.explicit_new {
      return Err("--new and --load cannot be used together".to_string());
    }

    Ok(args)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn parse_strs(parts: &[&str]) -> Result<Args, String> {
    Args::parse(parts.iter().map(|s| OsString::from(s)))
  }

  #[test]
  fn parses_help() {
    let args = parse_strs(&["--help"]).unwrap();
    assert!(args.help);
  }

  #[test]
  fn parses_agent_cmd_and_workdir() {
    let args = parse_strs(&["--agent-cmd", "node agent.js", "--workdir", "/tmp"]).unwrap();
    assert_eq!(args.agent_cmd.as_deref(), Some("node agent.js"));
    assert_eq!(args.workdir.as_deref(), Some("/tmp"));
  }

  #[test]
  fn rejects_unknown_arg() {
    let err = parse_strs(&["--wat"]).unwrap_err();
    assert!(err.contains("Unknown argument"));
  }

  #[test]
  fn rejects_load_and_new() {
    let err = parse_strs(&["--load", "sess_1", "--new"]).unwrap_err();
    assert!(err.contains("--new and --load"));
  }

  #[test]
  fn parses_load() {
    let args = parse_strs(&["--load", "sess_1"]).unwrap();
    assert_eq!(args.load_session_id.as_deref(), Some("sess_1"));
  }
}

