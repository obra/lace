# External Tools (exec + MCP)

Two ways to give a lace agent tools that live *outside* the process, distinct from
the in-process [plugin](writing-plugins.md) `tools` registry:

- **One-shot-exec tools** — a standalone executable that lace runs once per call.
- **MCP servers** — a Model Context Protocol server whose tools lace connects to.

Use these when the tool is written in another language, ships as a binary, is an
existing MCP server, or must run as a separate process. Use an in-process
[plugin Tool](writing-plugins.md#hello-tool) when you're writing TypeScript that
runs in the agent.

---

## One-shot-exec tools

A one-shot-exec tool is any executable that speaks a tiny two-subcommand protocol.
lace runs it once per tool call (Terraform-`external`-style: JSON in, JSON out),
in an isolated subprocess.

### The protocol

Your executable must handle two argv subcommands:

**1. `<bin> lace-tool-schema`** — print the tool descriptor as JSON to stdout and
exit 0:

```json
{
  "name": "acme/widget",
  "description": "Does a thing with widgets",
  "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
  "capabilities": ["credentials"]
}
```

- `name` (required) — namespaced, globally unique (same rule as plugin tools).
- `description` (required) — shown to the model.
- `inputSchema` (required) — a JSON Schema **object** (`type: "object"`);
  `properties`/`required` optional. This is advertised to the model verbatim.
- `capabilities` (optional) — currently only `'credentials'` (see
  [the manifest note](reference/plugins.md#capability-manifest); enforcement is
  spec #6).

The descriptor is parsed with a **strict** schema — unknown top-level keys are
rejected.

**2. `<bin> lace-tool-invoke`** — read a JSON request from **stdin**, do the work,
print a JSON result to **stdout**, exit 0:

Request (stdin):
```json
{ "input": { "id": "abc" }, "context": { "sessionId": "s-1", "persona": "researcher" } }
```
- `input` — the model-supplied arguments (matching your `inputSchema`).
- `context.persona` — the **authoritative** session persona, stamped server-side
  (the keystone — the model cannot forge it). `context.sessionId` likewise.
- `context` carries **only** `sessionId` and `persona` today (plus a future
  `credentialSocket` for #6). The session working directory is **not** a field in
  this JSON — it is delivered as the process **cwd**, so read it with
  `process.cwd()`, not from `context`.

Result (stdout):
```json
{ "content": "human-readable result text", "metadata": { "anything": "optional" } }
```
- `content` may be a string or an object (objects are JSON-stringified for the
  model). `metadata` is optional.
- If stdout is **not** valid JSON in this shape, lace uses the raw stdout as the
  result text — so a tool can also just print plain text.
- **Errors:** exit **non-zero**; lace surfaces a failure result containing your
  **stderr**. Validate your own input and exit non-zero on bad input — *lace does
  no input validation; the binary is the source of truth.*

### Runtime guarantees

When lace invokes your tool (`run-once.ts` / `exec-tool-adapter.ts`):

- **Isolated subprocess**, spawned `detached` as its own process group. On timeout
  or cancellation lace sends `SIGKILL` to the whole group (`process.kill(-pid)`) —
  no orphaned children.
- **Minimal environment** — the child gets only `PATH=/usr/local/bin:/usr/bin:/bin`,
  `HOME=/tmp`, and `TZ`/`LANG`/`LC_ALL` if set on the host. **Do not** expect to
  inherit arbitrary host env vars.
- **cwd** = the session working directory (falls back to a tool temp dir, then
  `process.cwd()`).
- **Timeout** — `ctx.timeoutMs`, default **120 s**. Over it → SIGKILL → a "timed
  out" failure result.
- **Concurrency cap** — at most **16** exec-tool processes run at once
  (process-wide semaphore); excess calls queue.
- **Cancellation** — if the turn is aborted, the process is killed and a
  cancellation result (with any partial stdout) is returned.

### Discovery and registration

`discoverExecTools(dir)` (from `@lace/agent/tools/exec/discover`) scans a single
directory, runs each **executable** file (mode `+x`) with `lace-tool-schema`
(5 s budget), and returns an `ExecToolAdapter[]`. Files that aren't executable,
exit non-zero, or print an invalid descriptor are **skipped with a warning, never
fatal** — one bad binary can't break discovery.

```ts
import { discoverExecTools } from '@lace/agent/tools/exec/discover';
const adapters = await discoverExecTools('/opt/acme/lace-tools');
// register each adapter into a ToolExecutor / the tools registry
```

> **Status (be aware):** discovery is **not yet wired into boot or session
> startup** — there is no environment variable or config field that auto-scans a
> directory today. The protocol, the adapter, and `discoverExecTools` are real and
> tested; an embedder currently calls `discoverExecTools(dir)` itself and registers
> the results. Auto-wiring (an env-var-scanned tools dir) is a future step.

### Minimal example (bash)

```bash
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  lace-tool-schema)
    printf '%s' '{"name":"acme/upcase","description":"Uppercase a string","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}'
    ;;
  lace-tool-invoke)
    req="$(cat)"                                  # JSON on stdin
    text="$(printf '%s' "$req" | jq -r '.input.text')"
    [ "$text" = "null" ] && { echo "missing 'text'" >&2; exit 1; }   # validate; nonzero = error
    printf '{"content":%s}' "$(printf '%s' "${text^^}" | jq -R .)"
    ;;
  *) echo "usage: $0 lace-tool-schema|lace-tool-invoke" >&2; exit 2 ;;
esac
```

Make it executable (`chmod +x`) and put it in a directory you pass to
`discoverExecTools`.

> **Writing it in Node?** An exec tool is a standalone executable, so Node decides
> CommonJS-vs-ESM from *its* context: the nearest `package.json` `"type"` field and
> the file extension. A bare script inside a `"type": "module"` package is treated
> as ESM, so `require()` throws `require is not defined in ES module scope`. Be
> explicit — name the file `.mjs` (ESM, use `import`) or `.cjs` (CommonJS, use
> `require`) — rather than relying on an inherited `package.json`.

---

## MCP servers

lace is an MCP **client**: it connects to MCP servers you declare, lists their
tools, and exposes each as `<serverId>/<toolName>` to the model.

### Declaring a server

MCP servers are configured per-persona via the `mcpServers` map in the persona's
config (frontmatter for a disk persona; `config.mcpServers` for a
[plugin persona](reference/plugins.md#personadef-lace-agentplugins)):

```yaml
mcpServers:
  filesystem:
    command: npx                       # required
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
    env: { FOO: bar }                  # optional
    transport: stdio                   # optional — see below
    placement: host                    # optional — 'host' (default) or 'toolRuntime'
    enabled: true                      # optional
```

- `command` is the only required field.
- The map key (`filesystem` above) is the **serverId** — tools surface as
  `filesystem/<toolName>`.

### What's actually supported

- **Transport: `stdio` only.** `sse` and `http` are accepted in the config schema
  but **throw at startup** today — do not use them.
- **Placement:** `host` (default) runs the server process on the host;
  `toolRuntime` runs it inside the persona's container runtime (via a runtime
  stdio transport).
- **Lifecycle:** servers are started and their tools registered when a session's
  config is reconciled (`reconcileMcpServersForActiveSession` →
  `MCPServerManager.startServer` → `client.listTools()` → `MCPToolAdapter` →
  `ToolExecutor`). Enable/disable is per-session config.

### Limitation: MCP tools don't receive `ToolContext`

`MCPToolAdapter` forwards the model's arguments to the MCP server but **does not
pass the lace `ToolContext`** — an MCP tool cannot see `persona`, `sessionId`,
`workingDirectory`, or any runtime context (tracked as D2). If your tool needs the
authoritative persona/identity keystone, use an **in-process plugin tool** or a
**one-shot-exec tool** (both receive context) instead of MCP.

MCP input schemas are converted to Zod by a simplified converter (handles the
common JSON-Schema primitives + arrays); very exotic schemas may degrade to
`unknown`.

---

## Which one?

| Need | Use |
| --- | --- |
| TypeScript, runs in-process, needs full `ToolContext` | [plugin Tool](writing-plugins.md#hello-tool) |
| Any language / a binary, needs `persona`+`sessionId`, isolated process | one-shot-exec |
| An existing MCP server, or the MCP ecosystem | MCP (stdio) |
