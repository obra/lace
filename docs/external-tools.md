# External Tools (exec + MCP)

Two ways to give a lace agent tools that live _outside_ the process, distinct
from the in-process [plugin](writing-plugins.md) `tools` registry:

- **One-shot-exec tools** — a standalone executable that lace runs once per
  call.
- **MCP servers** — a Model Context Protocol server whose tools lace connects
  to.

Use these when the tool is written in another language, ships as a binary, is an
existing MCP server, or must run as a separate process. Use an in-process
[plugin Tool](writing-plugins.md#hello-tool) when you're writing TypeScript that
runs in the agent.

---

## One-shot-exec tools

A one-shot-exec tool is any executable that speaks a tiny two-subcommand
protocol. lace runs it once per tool call (Terraform-`external`-style: JSON in,
JSON out), in an isolated subprocess.

### The protocol

Your executable must handle two argv subcommands:

**1. `<bin> lace-tool-schema`** — print the tool descriptor as JSON to stdout
and exit 0:

```json
{
  "name": "widget",
  "description": "Does a thing with widgets",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string" } },
    "required": ["id"]
  },
  "capabilities": ["credentials"]
}
```

- `name` (required) — the entry name for this tool. The final registered name
  depends on how the binary is loaded:
  - **Plugin global exec dir** (`api.tools.registerExecDir`): the kernel prepends
    `<namespace>:` automatically, so `"name": "widget"` in a plugin with
    `namespace: 'acme'` becomes `acme:widget`.
  - **Per-persona exec dir** (`<persona>/tools/`): the descriptor name is used as-is
    (no namespace prefix). The name must be globally unique among tools visible to
    that persona but can shadow a same-named plugin/core global.
  - **Core exec tools**: the descriptor name is used as-is (no prefix).
- `description` (required) — shown to the model.
- `inputSchema` (required) — a JSON Schema **object** (`type: "object"`);
  `properties`/`required` optional. This is advertised to the model verbatim.
- `capabilities` (optional) — currently only `'credentials'` (see
  [the manifest note](reference/plugins.md#capability-manifest); enforcement is
  spec #6).

The descriptor is parsed with a **strict** schema — unknown top-level keys are
rejected.

**2. `<bin> lace-tool-invoke`** — read a JSON request from **stdin**, do the
work, print a JSON result to **stdout**, exit 0:

Request (stdin):

```json
{
  "input": { "id": "abc" },
  "context": { "sessionId": "s-1", "persona": "researcher" }
}
```

- `input` — the model-supplied arguments (matching your `inputSchema`).
- `context.persona` — the **authoritative** session persona, stamped server-side
  (the keystone — the model cannot forge it). `context.sessionId` likewise.
- `context` carries **only** `sessionId` and `persona` today (plus a future
  `credentialSocket` for #6). The session working directory is **not** a field
  in this JSON — it is delivered as the process **cwd**, so read it with
  `process.cwd()`, not from `context`.

Result (stdout):

```json
{
  "content": "human-readable result text",
  "metadata": { "anything": "optional" }
}
```

- `content` may be a string or an object (objects are JSON-stringified for the
  model). `metadata` is optional.
- If stdout is **not** valid JSON in this shape, lace uses the raw stdout as the
  result text — so a tool can also just print plain text.
- **Errors:** exit **non-zero**; lace surfaces a failure result containing your
  **stderr**. Validate your own input and exit non-zero on bad input — _lace
  does no input validation; the binary is the source of truth._

### Runtime guarantees

When lace invokes your tool (`run-once.ts` / `exec-tool-adapter.ts`):

- **Isolated subprocess**, spawned `detached` as its own process group. On
  timeout or cancellation lace sends `SIGKILL` to the whole group
  (`process.kill(-pid)`) — no orphaned children.
- **Minimal environment** — the child gets only
  `PATH=/usr/local/bin:/usr/bin:/bin`, `HOME=/tmp`, and `TZ`/`LANG`/`LC_ALL` if
  set on the host. **Do not** expect to inherit arbitrary host env vars.
- **cwd** = the session working directory (falls back to a tool temp dir, then
  `process.cwd()`).
- **Timeout** — `ctx.timeoutMs`, default **120 s**. Over it → SIGKILL → a "timed
  out" failure result.
- **Concurrency cap** — at most **16** exec-tool processes run at once
  (process-wide semaphore); excess calls queue.
- **Cancellation** — if the turn is aborted, the process is killed and a
  cancellation result (with any partial stdout) is returned.

### Discovery and registration

`discoverExecToolsSync(dir, namePrefix?)` (from `@lace/agent/tools/exec/discover`)
synchronously scans a single directory, runs each **executable** file (mode
`+x`) with `lace-tool-schema` (5 s budget per binary, 30 s total budget, max 64
binaries), and returns an `ExecToolAdapter[]`. Files that aren't executable, exit
non-zero, or print an invalid descriptor are **skipped with a warning, never
fatal** — one bad binary can't break discovery of the rest.

Discovery runs **synchronously at boot** through three wiring points:

1. **Core exec tools** — `config/agent-exec-tools/` inside the lace package;
   registered at startup by `registerCoreExecTools` (owner `'core-exec'`, bare
   names, no namespace prefix).
2. **Plugin global exec tools** — call `api.tools.registerExecDir(dir)` in your
   plugin's `register()` function. Tools are named
   `<meta.namespace>:<descriptor-name>`.
3. **Per-persona exec tools** — sibling directory `<personaDir>/<entry>/tools/`
   next to a persona `.md` file; loaded when that persona becomes active (bare
   descriptor names, can override plugin/core globals but not kernel built-ins).

```ts
import { discoverExecToolsSync } from '@lace/agent/tools/exec/discover';
const adapters = discoverExecToolsSync('/opt/acme/lace-tools');
// register each adapter into a ToolExecutor / the tools registry
```

For the typical plugin use case, call `api.tools.registerExecDir(dir)` in
`register()` rather than calling `discoverExecToolsSync` directly.

### Minimal example (bash)

```bash
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  lace-tool-schema)
    printf '%s' '{"name":"upcase","description":"Uppercase a string","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}'
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
`api.tools.registerExecDir` (plugin global) or in a
`<personaDir>/<entry>/tools/` sibling (per-persona). When loaded via a plugin
with `namespace: 'acme'`, this binary's final tool name will be `acme:upcase`.

> **Writing it in Node?** An exec tool is a standalone executable, so Node
> decides CommonJS-vs-ESM from _its_ context: the nearest `package.json`
> `"type"` field and the file extension. A bare script inside a
> `"type": "module"` package is treated as ESM, so `require()` throws
> `require is not defined in ES module scope`. Be explicit — name the file
> `.mjs` (ESM, use `import`) or `.cjs` (CommonJS, use `require`) — rather than
> relying on an inherited `package.json`.

---

## MCP servers

lace is an MCP **client**: it connects to MCP servers you declare, lists their
tools, and exposes each as `<serverId>/<toolName>` to the model.

### Declaring a server

MCP servers are configured per-persona via the `mcpServers` map in the persona's
config (frontmatter for a disk persona, including plugin-contributed `.md`
personas):

```yaml
mcpServers:
  filesystem:
    command: npx # required
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/data']
    env: { FOO: bar } # optional
    transport: stdio # optional — see below
    placement: host # optional — 'host' (default) or 'toolRuntime'
    enabled: true # optional
```

- `command` is the only required field.
- The map key (`filesystem` above) is the **serverId** — tools surface as
  `filesystem/<toolName>`.

### What's actually supported

- **Transport: `stdio` only.** `sse` and `http` are accepted in the config
  schema but **throw at startup** today — do not use them.
- **Placement:** `host` (default) runs the server process on the host;
  `toolRuntime` runs it inside the persona's container runtime (via a runtime
  stdio transport).
- **Lifecycle:** servers are started and their tools registered when a session's
  config is reconciled: `reconcileMcpServersForActiveSession` →
  `MCPServerManager.startServer` → (`MCPToolRegistry` listens for the
  `server-status-changed` event) → `client.listTools()` → `MCPToolAdapter` →
  `ToolExecutor`. `MCPToolRegistry` is the glue between the manager and the
  executor. Enable/disable is per-session config.

### Writing an MCP server (Node, stdio)

Use the MCP SDK's server side. The `inputSchema` you pass to `registerTool` is a
**Zod raw shape** (`{ field: z.string() }`) — _not_ a JSON Schema object; the
SDK generates the JSON Schema the client sees. (Passing a JSON-Schema object
setups fine but throws at call time.)

```js
// my-server.mjs  (".mjs" → ESM; the package may be type:module)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.registerTool(
  'do_thing',
  {
    description: 'Does a thing',
    inputSchema: { text: z.string().describe('input text') }, // Zod RAW SHAPE
  },
  ({ text }) => ({ content: [{ type: 'text', text: text.toUpperCase() }] })
);

await server.connect(new StdioServerTransport());
```

Run it with `node my-server.mjs`; declare it in `mcpServers` with
`command: node, args: ['my-server.mjs']`.

### Testing an MCP server

Drive lace's real wiring — no mocks of the MCP protocol. Note the in-code
`MCPServerConfig` requires a `tools` field (`tools: {}` = default each tool to
the `ask` policy) that the YAML form fills in implicitly:

```ts
import { MCPServerManager } from '@lace/agent/mcp/server-manager';
import { MCPToolAdapter } from '@lace/agent/mcp/tool-adapter';
import { HostToolRuntime } from '@lace/agent/tools/runtime/host';

const manager = new MCPServerManager();
await manager.startServer({
  serverId: 'my-server',
  config: {
    command: process.execPath,
    args: [SERVER_PATH],
    enabled: true,
    tools: {},
    placement: 'host',
  },
  runtime: new HostToolRuntime({ id: 'test:my-server', cwd: process.cwd() }),
  hostCwd: process.cwd(),
});

const client = manager.getClient('my-server')!; // also: manager.getServer(id).status === 'running'
const { tools } = await client.listTools();
const adapter = new MCPToolAdapter(
  tools.find((t) => t.name === 'do_thing')!,
  'my-server',
  client
);
// execute takes exactly two args: (args, context: ToolContext). MCP ignores the
// context, but it is the real signature — don't pass a third argument.
const result = await adapter.execute(
  { text: 'hi' },
  { signal: new AbortController().signal }
);
// adapter.name === 'my-server/do_thing'; result.content[0].text holds the output
await manager.shutdown();
```

### Limitation: MCP tools don't receive `ToolContext`

`MCPToolAdapter` forwards the model's arguments to the MCP server but **does not
pass the lace `ToolContext`** — an MCP tool cannot see `persona`, `sessionId`,
`workingDirectory`, or any runtime context (tracked as D2). If your tool needs
the authoritative persona/identity keystone, use an **in-process plugin tool**
or a **one-shot-exec tool** (both receive context) instead of MCP.

MCP input schemas are converted to Zod by a simplified converter (handles the
common JSON-Schema primitives + arrays); very exotic schemas may degrade to
`unknown`.

---

## Which one?

| Need                                                                   | Use                                          |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| TypeScript, runs in-process, needs full `ToolContext`                  | [plugin Tool](writing-plugins.md#hello-tool) |
| Any language / a binary, needs `persona`+`sessionId`, isolated process | one-shot-exec                                |
| An existing MCP server, or the MCP ecosystem                           | MCP (stdio)                                  |
