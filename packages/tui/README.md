# `lace-tui`

Premium terminal UI for driving Ent-protocol-speaking agents over stdio (NDJSON
JSON-RPC).

## Run

From repo root:

```bash
cd packages/tui
cargo run -- --help
```

Run against the built Lace agent:

```bash
npm run build --workspace=packages/agent
cd packages/tui
cargo run -- --workdir "$(pwd)"
```

Or specify an agent command explicitly:

```bash
cd packages/tui
cargo run -- --workdir "$(pwd)" --agent-cmd "lace-agent"
```

## Preferences + state

Session aliases are stored at:

- `$LACE_TUI_DIR/session-aliases.json`, else
- `$XDG_STATE_HOME/lace_tui/session-aliases.json`, else
- `$HOME/.local/state/lace_tui/session-aliases.json`

UI preferences are stored at the same base dir under `preferences.json` (theme,
keybind mode, pane visibility, etc).

## Test

```bash
cd packages/tui
cargo test
```

### E2E tests (scenario-based)

`cargo test` includes integration tests in `packages/tui/tests` that spawn the
Node fake agents under `packages/cli/src/__tests__/fixtures`. You need `node` on
your PATH.

## Keybinds

Global:

- `Ctrl+C`: quit
- `Ctrl+F`: search
- `Ctrl+1/2/3`: toggle Chat/Activity/Debug panes
- `Tab`: slash autocomplete / cycle options
- `PgUp/PgDn`: scroll focused pane
- `?` / `F1`: help

Input:

- `Enter` / `Ctrl+Enter`: send
- `Alt+Enter`: newline
- `Up/Down`: input history (when input is focused)

Activity pane:

- `Up/Down`: select item
- `Enter`: expand/collapse details
- `g`: jump to related chat turn (best-effort)
- `y`: copy selected activity (summary + details)

Overlays:

- Permission: `Up/Down` select, `Enter` decide, `Esc` denies if available
- Sessions: type to filter, `Up/Down` select, `Enter` load, `r` rename (local
  alias), `Esc` close
- Configure/Search: `Up/Down` select, `Enter` confirm, `Esc` close

Vim-ish mode:

- When `Keybinds: Vim` is enabled, `j/k` behave like `Down/Up` when not focused
  on input.

Permission modal:

- `Up/Down` select, `Enter` decide
