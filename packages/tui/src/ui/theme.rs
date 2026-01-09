// ABOUTME: Semantic color token system for theming. Defines color tokens by
// purpose (bg_base, fg_primary, accent, etc.) rather than raw colors.

use crate::app::prefs::Theme as ThemePref;
use ratatui::style::Color;

/// Semantic color tokens for the UI theme.
/// Each token represents a purpose, not a specific color.
#[derive(Debug, Clone, Copy)]
pub struct ThemeColors {
    // Backgrounds
    pub bg_base: Color,     // Main conversation background
    pub bg_elevated: Color, // User messages, HUD overlay
    pub bg_surface: Color,  // Inputs, selected items
    pub bg_dim: Color,      // Dimmed background behind overlays

    // Foregrounds
    pub fg_primary: Color,   // Main text
    pub fg_secondary: Color, // Less prominent text
    pub fg_muted: Color,     // Hints, timestamps, dimmed content

    // Semantic colors
    pub accent: Color,  // Focus, links, active state
    pub success: Color, // Completed, approved
    pub error: Color,   // Failed, denied
    pub warning: Color, // Caution, pending

    // Special
    pub spinner: Color,       // Thinking indicator
    pub border_subtle: Color, // Rare borders (HUD edge)
}

impl ThemeColors {
    pub fn dark() -> Self {
        Self {
            bg_base: Color::Rgb(26, 26, 46),      // #1a1a2e
            bg_elevated: Color::Rgb(37, 37, 66),  // #252542
            bg_surface: Color::Rgb(45, 45, 74),   // #2d2d4a
            bg_dim: Color::Rgb(15, 15, 25),       // dimmed overlay bg

            fg_primary: Color::Rgb(224, 224, 224),   // #e0e0e0
            fg_secondary: Color::Rgb(180, 180, 190), // slightly dimmer
            fg_muted: Color::Rgb(136, 136, 153),     // #888899

            accent: Color::Rgb(108, 155, 255),  // #6c9bff
            success: Color::Rgb(107, 204, 138), // #6bcc8a
            error: Color::Rgb(224, 96, 112),    // #e06070
            warning: Color::Rgb(212, 160, 84),  // #d4a054

            spinner: Color::Rgb(108, 155, 255), // same as accent
            border_subtle: Color::Rgb(60, 60, 90),
        }
    }

    pub fn light() -> Self {
        Self {
            bg_base: Color::Rgb(250, 250, 252),    // near white
            bg_elevated: Color::Rgb(255, 255, 255), // white
            bg_surface: Color::Rgb(240, 240, 245),
            bg_dim: Color::Rgb(200, 200, 210),

            fg_primary: Color::Rgb(30, 30, 40),
            fg_secondary: Color::Rgb(60, 60, 70),
            fg_muted: Color::Rgb(120, 120, 130),

            accent: Color::Rgb(50, 100, 200),
            success: Color::Rgb(40, 160, 80),
            error: Color::Rgb(200, 60, 70),
            warning: Color::Rgb(180, 120, 40),

            spinner: Color::Rgb(50, 100, 200),
            border_subtle: Color::Rgb(200, 200, 210),
        }
    }

    pub fn high_contrast() -> Self {
        Self {
            bg_base: Color::Rgb(0, 0, 0),
            bg_elevated: Color::Rgb(20, 20, 20),
            bg_surface: Color::Rgb(40, 40, 40),
            bg_dim: Color::Rgb(0, 0, 0),

            fg_primary: Color::Rgb(255, 255, 255),
            fg_secondary: Color::Rgb(230, 230, 230),
            fg_muted: Color::Rgb(180, 180, 180),

            accent: Color::Rgb(255, 255, 0),    // bright yellow
            success: Color::Rgb(0, 255, 0),     // bright green
            error: Color::Rgb(255, 0, 0),       // bright red
            warning: Color::Rgb(255, 165, 0),   // orange

            spinner: Color::Rgb(255, 255, 0),
            border_subtle: Color::Rgb(100, 100, 100),
        }
    }

    pub fn from_pref(pref: ThemePref) -> Self {
        match pref {
            ThemePref::Dark => Self::dark(),
            ThemePref::Light => Self::light(),
            ThemePref::HighContrast => Self::high_contrast(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_theme_has_expected_base_colors() {
        let theme = ThemeColors::dark();
        // Dark theme should have dark backgrounds
        assert!(matches!(theme.bg_base, Color::Rgb(r, _, _) if r < 50));
    }

    #[test]
    fn light_theme_has_expected_base_colors() {
        let theme = ThemeColors::light();
        // Light theme should have light backgrounds
        assert!(matches!(theme.bg_base, Color::Rgb(r, _, _) if r > 200));
    }

    #[test]
    fn theme_from_preference_returns_correct_variant() {
        use crate::app::prefs::Theme;
        let dark = ThemeColors::from_pref(Theme::Dark);
        let light = ThemeColors::from_pref(Theme::Light);
        assert_ne!(dark.bg_base, light.bg_base);
    }
}
