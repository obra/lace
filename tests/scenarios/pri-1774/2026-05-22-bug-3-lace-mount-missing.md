# Scenario: bug #3 root cause — `/lace` source tree not mounted into sen-box

PRI-1774 bug #3 investigation, 2026-05-22.

## Findings

The ticket-described error message —
`PersonaContainerSpecError: Persona 'box-shell' requests unknown mount 'lace'` —
was from the **PREVIOUS** generation of `box-shell.md`, which used to declare
`lace` in `runtime.mounts`. That declaration has been removed.

The CURRENT crash on Ada is DIFFERENT but produces the same 749-byte stderr
length. Confirmed by `docker exec sen-box bash -c "ls /lace"`:

```
ls: cannot access '/lace': No such file or directory
```

And `docker exec sen-box node /lace/packages/agent/dist/main.js` returns:

```
Error: Cannot find module '/lace/packages/agent/dist/main.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1476:15)
    ...
Node.js v24.15.0
```

The full Node MODULE_NOT_FOUND output + stack trace is ~749 bytes, matching
`stderrLength: 749` from every crashed delegate after 2026-05-21T14:32.

## Why this happens

Lace's `IN_CONTAINER_LACE_ENTRY = '/lace/packages/agent/dist/main.js'` is fixed
by spec — every persona container image is expected to either bake lace at
`/lace` or have it mounted there. Sen-box's image does neither.

Sen-core's `buildContainerMounts` only registers `mounts.lace` when
`SEN_LACE_HOST_PATH` is set; on Ada that env var is unset.

Lace's `persona-container-spec.ts` already auto-injects three other
embedder-supplied mounts at fixed targets:

- `persona` → `/var/lace/user-personas`
- `lace-data` → `/var/lace/data`
- `credentials` → `/var/credentials`

`lace` is the missing fourth element of the same pattern. Personas have no
reason to declare it in their `runtime.mounts` (they don't pick the path; it's
an architectural constant), so auto-inject is the correct shape.

## Fix

In `resolvePersonaMountsAndEnv`, auto-inject `containerMounts.lace` at `/lace`
(alongside persona / lace-data / credentials). Sen-core then only needs
`SEN_LACE_HOST_PATH` set in its runtime-entrypoint to register the mount — the
lace side becomes symmetric with the other auto-injections.

When `containerMounts.lace` is absent, the spawn still succeeds and the child
crashes with the persisted `MODULE_NOT_FOUND` stderr (now visible thanks to the
bug-#2 fix). That's an acceptable failure mode: clear error in the per-job .log,
fast failure, no silent hang.

## Open question for Jesse

This fix is purely lace-side and makes lace's mount-injection contract
self-consistent. But the **full** fix for Ada also requires sen-core to export
`SEN_LACE_HOST_PATH` from its runtime-entrypoint so it registers the `lace`
mount with lace at initialize. That's a sen-core change.

After the lace-side fix is merged, deploying it to Ada alone won't make
box-shell work — sen-core also needs the env var. Surfaced for Jesse.

## History

| Date       | Run by | Layer               | Result                                                   |
| ---------- | ------ | ------------------- | -------------------------------------------------------- |
| 2026-05-22 | Bot    | docker exec inspect | confirmed sen-box has no `/lace`                         |
| 2026-05-22 | Bot    | docker exec node    | confirmed MODULE_NOT_FOUND error matches 749 byte stderr |
