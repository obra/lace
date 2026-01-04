# Ent TUI (Ratatui) — Implementation Log

Jesse: this is a running log of what was done, why, and how it was tested. Keep it updated as we build.

## 2026-01-04

### 2026-01-04 — Scaffold

- Added new Rust crate `packages/tui` (binary: `lace-tui`) with minimal `--help` and args parsing.
- Tests:
  - `cd packages/tui && cargo test`
- Notes:
  - No async runtime yet; no protocol code yet. This is intentionally skeleton-only.
  - Crate deps pinned to `ratatui 0.29` + `crossterm 0.28` for now; revisit only if needed.
