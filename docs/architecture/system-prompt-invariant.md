# System Prompt Invariant: Design & Limitations

## Overview

The **cache-control hardening** (Phase 2, 2026-05-23) enforces a strict invariant: *the system prompt is the bytes computed at session creation and does not change for the lifetime of the session*.

This document explains why this invariant exists, what it enables, and what tradeoffs it creates.

## The Invariant

**At session creation:**
- The operator's persona template + user instructions are rendered exactly once
- Variable interpolation (session date, git status, project tree, OS, tools) runs one time
- The fully rendered text is persisted as a `system_prompt_set` event
- The rendered bytes are pushed into the provider via `setSystemPrompt()`

**For the session lifetime:**
- The system prompt never changes
- The provider's `_systemPrompt` field stays constant
- The `system` message block (with `cache_control` marker) is identical on every request
- The system+tools cache prefix is reused on every turn — *the whole point*

**Why:** Prompt mutation mid-session would invalidate the cached prefix on every change. Stability of the prompt bytes is what makes cache reuse possible at all.

See [`docs/superpowers/plans/2026-05-23-cache-control-hardening.md`](../superpowers/plans/2026-05-23-cache-control-hardening.md) for the full Phase 2 architectural plan.

---

## Finding #7: Persona/Instructions Updates Don't Propagate

### The Behavior

If an operator edits `instructions.md` or persona templates (in `packages/core/config/agent-personas/` or project settings) **after a session is created**, in-flight sessions keep using the **old prompt for their entire lifetime**.

New sessions created **after the edit** see the new persona/instructions.

### Why This Happens

The `system_prompt_set` event is written exactly once at session creation. It captures the rendered bytes at that moment. Later edits to the source templates are not re-rendered into existing sessions.

```
Timeline:
  Session 1 created  → system_prompt_set event written with OLD persona
  Operator edits instructions.md
  Session 1 continues  → still uses OLD persona from system_prompt_set
  Session 2 created  → system_prompt_set event written with NEW persona
```

This is **intentional**. Re-rendering the prompt mid-session would change the `system` message block bytes, busting the cache prefix on every edit.

### Operator Workaround

**To pick up new persona or instruction changes:**
1. **Start a fresh session** — new sessions see the updated persona at creation time
2. There is **no in-session refresh command** — adding one would defeat the byte-stability invariant

If a long-running session needs to adopt a new persona, the operator must end the current session and start a new one.

### Implications

- Persona changes are session-scoped
- Large persona/instructions edits should be made during a quiet period to avoid splitting traffic between old and new versions
- Documentation and release notes should call out persona changes so operators know when to nudge users to new sessions

---

## Finding #10: MCP Server Changes Don't Update System Prompt

### The Behavior

If MCP servers are added or removed **mid-session** via `ent/session/configure` (or equivalent API), the list of available tools embedded in the system prompt becomes **stale**. The system prompt may:

- Reference tools that no longer exist (post-removal)
- Be unaware of newly-available tools (post-addition)

### Why This Happens

Some persona templates include a rendered list of available tools — a one-time snapshot taken at session creation. When MCP servers change mid-session, the `system_prompt_set` event's frozen text is not re-rendered.

The live tool list **is** kept up-to-date via the `tools[]` array sent with every request. The model can see available tools from `tools[]` even if the system prompt mention is outdated.

```
System prompt (frozen):
  "Available tools: web_search, code_runner"

Request #5 with new MCP servers:
  tools: [web_search, code_runner, database_query]  ← UP-TO-DATE

Request #6 after tool removal:
  tools: [web_search]  ← current reality
  
But system prompt still says: "Available tools: web_search, code_runner"
```

This is **intentional**. Live tool descriptions would require re-rendering the system prompt on every MCP change, busting the cache prefix.

### Operator Workaround

**Option 1 (recommended):** Start a fresh session to get the updated tool list in the system prompt.

**Option 2:** Trust the `tools[]` array — modern models are good at introspecting available tools from the live tool definitions regardless of what the system prompt says. The system prompt mention is a convenience, not a requirement.

### Implications

- MCP server configuration is effectively session-immutable
- Operators should configure MCP servers before creating user-facing sessions
- If MCP must change mid-session, document that the model will see the current tools via `tools[]` even if the system prompt is outdated

---

## Finding #11: Runtime Injections Now Have `role: 'user'`

### The Behavior

Pre-Phase-2, peer-injected context (reminders, alarms, subagent-exited notifications, scheduler nudges) was rebuilt as `role: 'system'` messages.

Post-Phase-2, all runtime injections are rebuilt as `role: 'user'` messages.

### Why This Changed

The Phase 2 lockdown said: **the system prompt is the bytes set via `setSystemPrompt()` at session start, period.**

Pre-Phase-2, runtime `context_injected` events were absorbed into the system prompt at rebuild time (converted to `role: 'system'`). This meant:
- Every peer injection mutated the system message block
- The system message block's bytes changed on every inject
- The cache prefix was invalidated constantly

The fix: route runtime injections to `role: 'user'` messages instead. The system prompt stays frozen. The `tools` cache prefix stays warm.

**Event-to-message mapping (post-Phase-2):**
```
system_prompt_set event
  ↓
provider.setSystemPrompt()
  ↓
system message block (frozen, reusable)

context_injected events (runtime nudges, reminders, etc.)
  ↓
role: 'user' messages (ephemeral, don't affect system cache)
```

### Implications for Personas

If your persona template contains logic like:

```text
"Treat system-role messages as authoritative commands."
```

The model will now see these notifications as `user` content, not `system` content. Some models weight `system` and `user` roles differently in terms of authority/importance.

**Persona Update Required:** If your persona relies on role-based authority signaling, update to recognize injected content by **tag** rather than **role**:

```text
"Messages marked with <system-reminder> tags should be treated as authoritative."
```

Then ensure injections use a predictable tag format. The model can distinguish reminders from user queries regardless of role.

### Implications for Behavior

Different models may give different weight to `system` vs. `user` content in terms of:
- Instruction-following priority
- Novelty/override ability
- Reasoning depth

The shift is expected. Monitor the first deploy for any behavioral changes in how models respond to runtime nudges.

**Recommendation:** Add telemetry to track whether models are still detecting and acting on injected nudges post-deploy. If behavior has shifted, update persona templates to compensate.

---

## Summary: Tradeoffs

The system prompt invariant buys **cache prefix stability** at the cost of:

| Feature | Pre-Phase-2 | Post-Phase-2 |
|---------|-------------|--------------|
| Persona changes mid-session | Instant (but busts cache) | Requires new session |
| MCP updates mid-session | Instant (but busts cache) | Requires new session |
| Role-based injection authority | Works naturally | Requires persona/tag update |
| System cache hit rate | Low (constantly invalidated) | High (stable prefix) |
| Cost per turn | Higher (more cache misses) | Lower (cache hits) |

**Philosophy:** Sessions are designed to be ephemeral with respect to configuration. Static configuration (personas, MCP servers) is set at session creation. Runtime context flows through the message stream, not the system prompt.

---

## See Also

- [`2026-05-23-cache-control-hardening.md`](../superpowers/plans/2026-05-23-cache-control-hardening.md) — Full architectural plan, phases, and tasks
- [`notifications.md`](./notifications.md) — How runtime notifications (system-reminders, etc.) are emitted and handled
