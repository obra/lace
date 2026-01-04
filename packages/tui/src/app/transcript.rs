use crate::app::{AppState, Role};
use std::path::Path;

pub fn to_markdown(state: &AppState) -> String {
  let mut out = String::new();

  out.push_str("# lace-tui transcript\n\n");
  out.push_str(&format!(
    "- sessionId: {}\n",
    state.session_id.clone().unwrap_or_else(|| "<none>".to_string())
  ));
  out.push_str(&format!("- workdir: {}\n", state.workdir));
  if let Some(conn) = &state.connection_id {
    out.push_str(&format!("- connectionId: {conn}\n"));
  }
  if let Some(model) = &state.model_id {
    out.push_str(&format!("- modelId: {model}\n"));
  }
  out.push('\n');

  out.push_str("## Chat\n\n");
  for m in &state.messages {
    let role = match m.role {
      Role::User => "user",
      Role::Assistant => "assistant",
    };
    out.push_str(&format!("### {role}\n\n"));
    out.push_str(&m.text);
    out.push_str("\n\n");
  }

  out.push_str("## Activity\n\n");
  for it in &state.activity {
    out.push_str(&format!("- {}\n", it.summary));
    if let Some(details) = &it.details {
      let pretty = serde_json::to_string_pretty(details).unwrap_or_else(|_| details.to_string());
      out.push_str("```json\n");
      out.push_str(&pretty);
      out.push_str("\n```\n");
    }
  }

  out
}

pub fn export_to_workdir(state: &AppState) -> Result<std::path::PathBuf, String> {
  let workdir = Path::new(&state.workdir);
  let session = state.session_id.clone().unwrap_or_else(|| "session".to_string());
  let suffix = unix_timestamp_ms();
  let filename = format!("lace-transcript-{session}-{suffix}.md");
  let path = workdir.join(filename);
  export_to_path(state, &path)?;
  Ok(path)
}

pub fn export_to_path(state: &AppState, path: &Path) -> Result<(), String> {
  let body = to_markdown(state);
  std::fs::write(path, body).map_err(|e| e.to_string())
}

fn unix_timestamp_ms() -> u128 {
  use std::time::{SystemTime, UNIX_EPOCH};
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_else(|_| std::time::Duration::from_secs(0))
    .as_millis()
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::app::{ChatMessage, Role};
  use tempfile::tempdir;

  #[test]
  fn transcript_includes_chat_and_activity() {
    let mut state = AppState::new();
    state.session_id = Some("sess_1".to_string());
    state.workdir = "/tmp".to_string();
    state.messages.push(ChatMessage {
      role: Role::User,
      text: "hi".to_string(),
      streaming: false,
      turn_id: None,
      turn_seq: None,
    });
    crate::app::activity::push_log_line(&mut state, "something".to_string());

    let md = to_markdown(&state);
    assert!(md.contains("sess_1"));
    assert!(md.contains("## Chat"));
    assert!(md.contains("hi"));
    assert!(md.contains("## Activity"));
    assert!(md.contains("something"));
  }

  #[test]
  fn export_writes_file() {
    let dir = tempdir().unwrap();
    let mut state = AppState::new();
    state.workdir = dir.path().to_string_lossy().to_string();
    state.session_id = Some("sess_1".to_string());
    export_to_workdir(&state).unwrap();
    let entries = std::fs::read_dir(dir.path()).unwrap().count();
    assert_eq!(entries, 1);
  }
}
