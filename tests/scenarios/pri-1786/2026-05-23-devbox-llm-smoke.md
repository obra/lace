# PRI-1786 — Devbox LLM Smoke

**Date:** 2026-05-23 **Outcome:** PARTIAL PASS. Local LLM smoke exercised the
new delegate → projected runtime path end-to-end. Tag resolution, projected
binding construction, and image identity resolution all worked under a real
Anthropic LLM. Tool execution inside the persona container blocked by a
macOS-only `Apple container` CLI limitation that does NOT apply to Ada's Linux +
Docker runtime; same mount shape verified directly under Docker.

## Setup

The `primeradiant-ops:local-dev` skill is for sen v1 (claude-pa); for sen v2
there's no preexisting local stack. Used sen-core's built-in one-shot CLI driver
(`src/scripts/prompt.ts`) which spawns lace via `LaceSupervisor` and drives a
single session/prompt round-trip — no Slack required.

- `SEN_INSTANCE_ROOT=~/sen-instances/pri-1786-smoke`
- `LACE_AGENT_BIN=lace-worktrees/pri-1786-projection/packages/agent/dist/main.js`
  @ `1d5e16e08`
- `SEN_LACE_HOST_PATH=lace-worktrees/pri-1786-projection`
- sen-core @ `8e61c86`
- Seeded: anthropic key from SSM `/sen/jesse/ANTHROPIC_API_KEY`; bootstrap
  rewrote personas from sen-core templates into the smoke instance.
- Patched `config/mcp-config.json` to point private-journal MCP at the local
  node_modules (template ships with in-container `/var/sen/instance/...` paths).
- Patched `agent-personas/core.md` from `claude-opus-4-7-1m` → `claude-opus-4-7`
  (the 1M beta isn't enabled on my key).

## Smoke 1 — base round-trip

```
prompt.js "Reply with exactly one word: pong"
```

Lace booted, MCP servers loaded, Anthropic provider created, request issued
(model=claude-opus-4-7), got back: `pong`.

Validates: lace + sen-core spawn cleanly with the projection branch's persona
schema, provider catalog loads, real LLM responds.

## Smoke 2 — shell persona via delegate

```
prompt.js "Use delegate to spawn the shell persona. Have it run:
  pwd && echo shell-ok > /work/projection-smoke-shell.txt && cat /work/projection-smoke-shell.txt.
Report the persona's exact output."
```

What happened:

1. Parent (`core` persona, opus-4-7) ran turn, model called
   `delegate(persona='shell', ...)`.
2. Lace's DelegateTool resolved the persona — schema with
   `agentPlacement: host` + `containerLifecycle: session` parsed cleanly.
3. **Tag resolution worked.** `ImageInspector.resolve('node:24-bookworm')`
   returned
   `node@sha256:050bf2bbe33c1d6754e060bec89378a79ed831f04a7bb1a53fe45e997df7b3bb`.
   This is the fix for the bug that wedged Ada last attempt —
   `buildPinnedImageIdentity` no longer rejects tag-only images.
4. Projected binding built correctly. The materialization issued exactly:

   ```
   container run -d --name lace-sess_<id>-shell-<rand> \
     --mount type=bind,source=<smoke>/scratch,target=/work \
     --mount type=bind,source=<smoke>/knowledge,target=/knowledge,readonly \
     --mount type=bind,source=<smoke>/identity,target=/sen/identity,readonly \
     --mount type=bind,source=<smoke>/agent-personas,target=/var/lace/user-personas,readonly \
     --mount type=bind,source=<smoke>/history/lace,target=/var/lace/data \
     --mount type=bind,source=<smoke>/credentials,target=/var/credentials,readonly \
     --mount type=bind,source=<lace>/packages/agent/dist/tools/runtime/container-helper.js,target=/usr/local/bin/lace-runtime-helper.js,readonly \
     -e LACE_DIR=/var/lace/data -w /work \
     node@sha256:050bf2bbe33c1d6754e060bec89378a79ed831f04a7bb1a53fe45e997df7b3bb \
     tail -f /dev/null
   ```

5. **`Apple container` CLI rejected the helper mount:**

   ```
   Error: invalidArgument: "path '<lace>/.../container-helper.js' is not a directory"
   ```

   Apple's native `container` CLI (the runtime lace selects on
   `process.platform === 'darwin'` via `createContainerManagerForPlatform`) does
   not support file-as-mount sources — only directories.

6. Subagent reported the failure back to the parent, which surfaced it to the
   user. Final assistant text: "container runtime did fail and the smoke task
   was not completed."

## Cross-check: Docker accepts the same mount shape

Ada runs Linux + Docker (`DockerContainerRuntime` is what lace picks on
`process.platform === 'linux'`). To confirm the file-mount shape works under
Docker, ran the exact mount target manually:

```
docker run --rm \
  -v <lace>/packages/agent/dist/tools/runtime/container-helper.js:/usr/local/bin/lace-runtime-helper.js:ro \
  node:24-bookworm bash -lc 'ls -la /usr/local/bin/lace-runtime-helper.js && head -3 /usr/local/bin/lace-runtime-helper.js'
```

Output:

```
-rw-r--r-- 1 root root 3895 May 23 03:06 /usr/local/bin/lace-runtime-helper.js
#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
```

Docker accepts file bind-mounts. Ada will not hit the Apple-container
limitation.

## What the local smoke proved

- ✅ New persona schema (`agentPlacement`, `containerLifecycle`) parses
  end-to-end through bootstrap → persona-rewrite → lace persona-registry →
  delegate path.
- ✅ Tag resolution (the bug that wedged Ada last attempt): `node:24-bookworm`
  resolves to a digest via `docker inspect` fallback. **Verified live, with a
  real LLM-issued delegate call**, not a mocked unit test.
- ✅ `buildPersonaProjectedRuntimeBinding` constructs the expected
  `RuntimeExecutionBinding` with correct mount list, image identity, and helper
  descriptor.
- ✅ `agentPlacement: host` routing: subagent ran on host (no in-container lace
  spawn), about to project tools into the container.
- ✅ Lace's `JobManager` materialized the projected runtime as expected — it
  sent the right container run command to the runtime CLI.

## What the local smoke did NOT prove

- Tool execution INSIDE the persona container (bash/file_write/file_read in the
  shell persona) — blocked by macOS Apple-container CLI rejecting the helper
  file-mount.
- box-shell persona persistence across delegates — same blocker.
- browser-driver MCP routing through projected runtime — same blocker, plus we
  don't have a display server on this Mac for the browser anyway.

## New issue surfaced (file as follow-up)

**Apple `container` CLI does not support file bind-mounts; projected runtime
helper is incompatible on macOS.** Lace runtime helper is mounted as a single
`.js` file via
`type=bind,source=<file>,target=/usr/local/bin/lace-runtime-helper.js`. Docker
on Linux (and Docker Desktop) accept this; Apple's native `container` CLI
rejects it with `invalidArgument: ... is not a directory`. This only affects
users running lace DIRECTLY on macOS (not the deployed Sen instances which all
run on Linux EC2).

Three possible fixes:

- (a) On Apple, copy the helper into a parent directory under tempdir and
  bind-mount that directory. Adjust `containerPath` accordingly.
- (b) Add an `image` mode default for Apple container — bake the helper into the
  image. Requires shipping helper inside sen-box/sen-browser/node images.
- (c) Skip helper mounting entirely and pipe stdin/stdout helper bytes through
  `container exec`.

Not blocking Ada deploy — Ada is Linux + Docker.

## Trace evidence

- Lace agent log: `~/sen-instances/pri-1786-smoke/history/lace/agent.log`
- Ent protocol log:
  `~/sen-instances/pri-1786-smoke/history/lace/ent-protocol.log`
- Full smoke transcript: `/tmp/shell-smoke.log` (delegate call, container error,
  parent response).

## History

| Date       | Outcome      | Notes                                                                                                                                                               |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | PARTIAL PASS | Tag resolution + projection bindings verified end-to-end via real LLM. Apple container CLI limitation surfaced as new follow-up. Ada (Docker/Linux) path unblocked. |
