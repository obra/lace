use std::io::Write;
use std::process::{Command, Stdio};

pub fn try_copy_to_clipboard(text: &str) -> Result<(), String> {
    if let Ok(cmd) = std::env::var("LACE_TUI_CLIPBOARD_CMD") {
        return run_shell_clipboard_cmd(&cmd, text);
    }

    try_run_cmd("pbcopy", &[], text)
        .or_else(|_| try_run_cmd("wl-copy", &[], text))
        .or_else(|_| try_run_cmd("xclip", &["-selection", "clipboard"], text))
        .or_else(|_| try_run_cmd("xsel", &["--clipboard", "--input"], text))
}

fn run_shell_clipboard_cmd(cmd: &str, text: &str) -> Result<(), String> {
    // Use /bin/sh so the command can include args/pipes if needed.
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("clipboard command failed: {cmd}"))
    }
}

fn try_run_cmd(program: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("clipboard command failed: {program}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_copy_via_custom_cmd() {
        std::env::set_var("LACE_TUI_CLIPBOARD_CMD", "cat >/dev/null");
        try_copy_to_clipboard("hello").unwrap();
        std::env::remove_var("LACE_TUI_CLIPBOARD_CMD");
    }
}
