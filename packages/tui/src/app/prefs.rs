use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeybindMode {
    Default,
    Vim,
}

impl Default for KeybindMode {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    Dark,
    Light,
    HighContrast,
}

impl Default for Theme {
    fn default() -> Self {
        Self::Dark
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Preferences {
    // Deprecated: These fields are kept for backwards compatibility when loading
    // old preferences. They are no longer used in rendering - the conversation
    // is always shown, and debug/activity are accessed via full-screen overlays.
    pub show_chat: bool,
    pub show_activity: bool,
    pub show_debug: bool,

    pub keybind_mode: KeybindMode,
    pub theme: Theme,
    pub render_markdown: bool,
    pub input_multiline: bool,
    pub last_connection_id: Option<String>,
    pub last_model_id: Option<String>,
    pub environment: Option<std::collections::BTreeMap<String, String>>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            show_chat: true,
            show_activity: true,
            show_debug: false,
            keybind_mode: KeybindMode::Default,
            theme: Theme::Dark,
            render_markdown: true,
            input_multiline: true,
            last_connection_id: None,
            last_model_id: None,
            environment: None,
        }
    }
}

pub fn load(path: Option<&Path>) -> Result<Preferences, String> {
    let Some(path) = path else {
        return Ok(Preferences::default());
    };
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Preferences::default()),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str::<Preferences>(&content).map_err(|e| e.to_string())
}

pub fn save(path: Option<&Path>, prefs: &Preferences) -> Result<(), String> {
    let Some(path) = path else { return Ok(()) };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("prefs.json");
        let prefs = load(Some(&missing)).unwrap();
        assert_eq!(prefs, Preferences::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        let prefs = Preferences {
            show_chat: false,
            show_activity: true,
            show_debug: true,
            keybind_mode: KeybindMode::Vim,
            theme: Theme::HighContrast,
            render_markdown: false,
            input_multiline: true,
            last_connection_id: Some("openai-openai".to_string()),
            last_model_id: Some("gpt-4.1".to_string()),
            environment: Some(
                [("A".to_string(), "1".to_string())]
                    .into_iter()
                    .collect::<std::collections::BTreeMap<_, _>>(),
            ),
        };
        save(Some(&path), &prefs).unwrap();
        let loaded = load(Some(&path)).unwrap();
        assert_eq!(loaded, prefs);
    }

    #[test]
    fn load_invalid_json_is_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("prefs.json");
        std::fs::write(&path, "{").unwrap();
        let err = load(Some(&path)).unwrap_err();
        assert!(!err.is_empty());
    }
}
