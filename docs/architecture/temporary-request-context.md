# Temporary request context

An Ent host can keep one sticky text value at the end of every model request.
Use this for current caller-supplied context that should stay out of
conversation history. It is separate from memory and from durable
`ent/session/inject` events.

After initializing the agent and activating a session, use these three RPCs:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "ent/session/temporary_context/set",
  "params": { "text": "Current workspace status: review is pending." }
}
```

Set requires a nonempty string, replaces the only value and returns `{}`. The
text is preserved verbatim. Additional parameters are rejected.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "ent/session/temporary_context/peek",
  "params": {}
}
```

Peek returns `{"text":"Current workspace status: review is pending."}` or
`{"text":null}`. Reading never consumes the value.

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "ent/session/temporary_context/clear",
  "params": {}
}
```

Clear removes the value and returns `{}`. Peek and clear also accept omitted
params. All three operations require an active initialized session; they can run
while a model call is in flight. They neither start a turn nor emit a
conversation event.

## Lifetime and request timing

The value belongs to the active session in this agent process. It stays set
across prompts, tool rounds, ordinary session-state refreshes and compaction,
until replaced or cleared. Successful session new, load/resume activation and
close reset it, including loading the same session again. The existing `/clear`
command creates a fresh session and also resets it. It is never persisted,
restored, forked or passed to a delegated agent; a restarted process starts
empty.

Immediately before each model call, the runner snapshots the current text. A set
or clear affects the next request. An already submitted request and its
transport retries keep their snapshot. The supported OpenAI
streaming-verification fallback preserves the same options and materialized text
when switching to a non-streaming call on the selected API.

```text
system instructions + tools
required conversation history (including tool results and images)
current temporary context, if set
```

Canonical messages, event logs and compaction input exclude this extra text.
Required history is never shortened to make room for it. Existing request-size
estimates and usage fallbacks include the context; provider limits can still
reject a request that is too large. The model may refer to the context in its
answer, and provider/request diagnostics may log it. Clear removes future
injection; it does not erase text the model already wrote into history.

## Provider cache behavior

Anthropic direct and Bedrock first convert required history and apply their
explicit cache breakpoints. They then append temporary text as a separate,
unmarked user text block. Replacing that text, even with a different size,
leaves every marked prefix byte unchanged. The four-marker budget is computed
from required history. Anthropic previous-message cache diagnostics and
model-call correlation continue to operate.

OpenAI Responses sends full history with `store: false` and no
`previous_response_id` whenever context is present. Once temporary context has
been used in a turn, clearing it keeps the remaining requests of that turn
stateless, so a stored response cannot bring old context back. Turns that never
use temporary context retain the provider's normal chaining behavior.

OpenAI Chat Completions, Gemini, Ollama and LMStudio also receive the text after
required history. Lace does not disable provider-managed automatic caching or
change local KV settings. These guarantees concern request layout and explicit
Anthropic/Bedrock markers; offline serialization tests do not prove a provider's
cache retention, eligibility or billing behavior.

## Implementation and verification

`AgentServerState.temporaryContext` owns the process-local value. The session
operation handlers validate Ent schemas; the prompt handler provides a narrow
getter to `ConversationRunner`. The runner supplies its snapshot through
`RequestOptions.temporaryContext`. The adapters materialize a fresh trailing
message without modifying canonical history. The internal null option retains
stateless Responses mode after a clear; it is not a public lifetime control.

Focused tests cover the RPC boundary and session resets, sticky multi-round and
multi-turn behavior, compaction isolation, actual provider SDK serialization,
explicit cache prefix identity, Responses replacement/clear, local client
boundaries, output-budget fitting and fallback usage.
