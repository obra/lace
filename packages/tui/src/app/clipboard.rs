use std::io::Write;
use std::process::{Command, Stdio};

/// Check if the clipboard contains an image and save it to a temp file.
/// Returns the path to the saved image file if successful.
/// Only works on macOS.
#[cfg(target_os = "macos")]
pub fn try_save_clipboard_image() -> Result<String, String> {
    use std::fs;

    // Create temp file path
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_path = temp_dir.join(format!("clipboard_{}.png", timestamp));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    // First, try pngpaste if available (most reliable)
    let pngpaste_result = Command::new("pngpaste")
        .arg(&temp_path_str)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if let Ok(status) = pngpaste_result {
        if status.success() && temp_path.exists() {
            return Ok(temp_path_str);
        }
    }

    // Fallback: use osascript with simple AppleScript (no Cocoa bridge)
    // Based on Simon Willison's impaste approach
    let output = Command::new("osascript")
        .arg("-e")
        .arg("set theImage to the clipboard as «class PNGf»")
        .arg("-e")
        .arg(format!(
            "set theFile to open for access POSIX file \"{}\" with write permission",
            temp_path_str.replace('"', "\\\"")
        ))
        .arg("-e")
        .arg("write theImage to theFile")
        .arg("-e")
        .arg("close access theFile")
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;

    if output.status.success() && temp_path.exists() {
        Ok(temp_path_str)
    } else {
        // Clean up any partial file
        let _ = fs::remove_file(&temp_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // AppleScript errors when clipboard doesn't contain PNG data
        if stderr.contains("No image in clipboard")
            || stderr.contains("Can't make")
            || stderr.contains("PNGf")
        {
            Err("No image in clipboard".to_string())
        } else {
            Err(format!("Failed to save clipboard image: {}", stderr))
        }
    }
}

/// Check if the clipboard contains an image and save it to a temp file.
/// Non-macOS stub that always returns an error.
#[cfg(not(target_os = "macos"))]
pub fn try_save_clipboard_image() -> Result<String, String> {
    Err("Image paste is only supported on macOS".to_string())
}

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
