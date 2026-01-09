use std::path::PathBuf;

pub fn resolve_tui_state_dir() -> Option<PathBuf> {
    resolve_tui_state_dir_with(|k| std::env::var(k).ok())
}

fn resolve_tui_state_dir_with(getenv: impl Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if let Some(dir) = getenv("LACE_TUI_DIR").filter(|s| !s.is_empty()) {
        return Some(PathBuf::from(dir));
    }

    let base = if let Some(xdg_state) = getenv("XDG_STATE_HOME").filter(|s| !s.is_empty()) {
        PathBuf::from(xdg_state)
    } else if let Some(home) = getenv("HOME").filter(|s| !s.is_empty()) {
        PathBuf::from(home).join(".local/state")
    } else {
        return None;
    };

    Some(base.join("lace_tui"))
}

pub fn default_aliases_path() -> Option<PathBuf> {
    resolve_tui_state_dir().map(|base| base.join("session-aliases.json"))
}

pub fn default_prefs_path() -> Option<PathBuf> {
    resolve_tui_state_dir().map(|base| base.join("preferences.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_tui_state_dir_prefers_lace_tui_dir() {
        let dir = resolve_tui_state_dir_with(|k| {
            if k == "LACE_TUI_DIR" {
                Some("/tmp/lace_tui_test".to_string())
            } else {
                None
            }
        })
        .unwrap();
        assert_eq!(dir, PathBuf::from("/tmp/lace_tui_test"));
    }

    #[test]
    fn resolve_tui_state_dir_uses_xdg_state_home() {
        let dir = resolve_tui_state_dir_with(|k| {
            if k == "XDG_STATE_HOME" {
                Some("/xdg".to_string())
            } else {
                None
            }
        })
        .unwrap();
        assert_eq!(dir, PathBuf::from("/xdg").join("lace_tui"));
    }

    #[test]
    fn resolve_tui_state_dir_uses_home_local_state() {
        let dir = resolve_tui_state_dir_with(|k| {
            if k == "HOME" {
                Some("/home/me".to_string())
            } else {
                None
            }
        })
        .unwrap();
        assert_eq!(dir, PathBuf::from("/home/me/.local/state/lace_tui"));
    }
}
