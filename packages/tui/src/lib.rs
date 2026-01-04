pub mod args;
pub mod protocol;

use std::io;

pub fn run(_args: args::Args) -> io::Result<()> {
  // Scaffold only. Real app loop comes next.
  Ok(())
}
