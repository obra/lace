use std::path::PathBuf;

pub fn default_aliases_path() -> Option<PathBuf> {
    let base = if let Ok(lace_dir) = std::env::var("LACE_DIR") {
        PathBuf::from(lace_dir)
    } else if let Ok(xdg_state) = std::env::var("XDG_STATE_HOME") {
        PathBuf::from(xdg_state).join("lace")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".local/state/lace")
    } else {
        return None;
    };

    Some(base.join("tui").join("session-aliases.json"))
}

pub fn default_prefs_path() -> Option<PathBuf> {
    let base = if let Ok(lace_dir) = std::env::var("LACE_DIR") {
        PathBuf::from(lace_dir)
    } else if let Ok(xdg_state) = std::env::var("XDG_STATE_HOME") {
        PathBuf::from(xdg_state).join("lace")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".local/state/lace")
    } else {
        return None;
    };

    Some(base.join("tui").join("preferences.json"))
}
