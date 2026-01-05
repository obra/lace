pub mod app;
pub mod args;
pub mod protocol;
pub mod ui;

use std::io;

pub fn run(_args: args::Args) -> io::Result<()> {
    // Implemented in src/runtime.rs to keep lib.rs small and testable.
    crate::ui::run_tui(_args)
}
